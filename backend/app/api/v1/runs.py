from typing import Any, List, Optional
import asyncio
import uuid
import time
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.agents.runtime import run_agent, stream_agent, now_ms, resolve_approval
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_active_user, get_current_user_flexible
from app.models import Agent, AgentRun, User, AgentEvaluation, CreditTransaction, ToolApproval
from app.schemas import (
    AgentRunPublic,
    RunRequest,
    RunResponse,
    EvaluateRequest,
    EvaluateResponse,
    BatchEvaluateRequest,
    BatchEvaluateResponse,
    AgentEvaluationPublic,
    EvaluationSummary,
    AgentTaskCreate,
)
from app.schemas import AgentRunPublic, RunRequest, RunResponse, EvaluateRequest, EvaluateResponse, BatchEvaluateRequest, BatchEvaluateResponse, AgentEvaluationPublic, EvaluationSummary
from app.services.sandbox_service import sandbox_service
from app.services.mcp_service import mcp_service
from app.services import execution_auth
from app.services.execution_auth import (
    RunDenied,
    RunIdempotentReplay,
    authorize_run,
    bill_run,
    refund_run,
)

router = APIRouter()


def _run_denied_http(exc: RunDenied) -> HTTPException:
    headers = None
    if exc.status_code == 402:
        headers = {"X-Purchase-Required": "true"}
    return HTTPException(status_code=exc.status_code, detail=exc.detail, headers=headers)


def _build_agent_config(agent: Agent, user: User, db: Optional[Session] = None) -> dict:
    """Serialize an Agent model into the runtime configuration dict.

    Resolves the LLM credentials for this user: their own provider key (BYOK)
    when they've added one for the agent's provider, otherwise the platform
    default (Gemini) is applied inside the runtime.
    """
    agent_config = {
        "id": agent.id,
        "user_id": user.id,
        "name": agent.name,
        "model_name": agent.model_name,
        "temperature": agent.temperature,
        "system_prompt": agent.system_prompt,
        "tools_config": agent.tools_config or [],
        "memory_config": agent.memory_config or {},
        "workflow_config": agent.workflow_config or {},
        "max_steps": agent.max_steps or 25,
        "autonomy_level": agent.autonomy_level or "supervised",
        "sandbox_enabled": bool(agent.sandbox_enabled),
        "advanced_config": agent.advanced_config or {},
    }

    # BYOK: user's own key for the agent's provider wins over platform defaults
    if db is not None:
        from app.core.llm_keys import detect_provider
        from app.models import ProviderKey

        provider = detect_provider(agent.model_name)
        key_row = (
            db.query(ProviderKey)
            .filter(ProviderKey.user_id == user.id, ProviderKey.provider == provider)
            .first()
        )
        if key_row:
            agent_config["_llm_api_key"] = key_row.api_key
            if key_row.base_url and not (agent_config.get("base_url") or agent_config.get("openai_base_url")):
                agent_config["_llm_base_url"] = key_row.base_url
    return agent_config


def _resolve_nested_agents(agent_config: dict, db: Session, current_user: User) -> dict:
    """If the agent has agent_tool_ids in advanced_config, load those agents and attach as nested_agents."""
    adv = agent_config.get("advanced_config") or {}
    raw_ids = adv.get("agent_tool_ids") or []
    if not raw_ids:
        return agent_config

    nested: list = []
    seen = set()
    for raw in raw_ids:
        try:
            aid = int(raw)
        except (TypeError, ValueError):
            continue
        if aid in seen or aid == agent_config.get("id"):
            continue
        seen.add(aid)
        sub = db.query(Agent).filter(Agent.id == aid).first()
        if not sub:
            continue
        # Permission: own agents or public
        if sub.owner_id != current_user.id and not getattr(sub, "is_public", False):
            continue
        sub_cfg = _build_agent_config(sub, current_user, db)
        # Prevent immediate re-nesting of the same set unless explicitly desired
        nested.append(sub_cfg)

    if nested:
        agent_config["nested_agents"] = nested
    return agent_config




@router.post("/{agent_id}/run", response_model=RunResponse)
async def run_agent_endpoint(
    agent_id: int,
    request: RunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Money: marketplace authorization + pay-per-execution billing (replaces credits)
    try:
        entitlement = authorize_run(db, agent, current_user, request.client_request_id)
    except RunDenied as e:
        raise _run_denied_http(e)
    except RunIdempotentReplay as replay:
        existing = replay.run
        return RunResponse(
            output=existing.output or "",
            agent_id=existing.agent_id,
            run_id=existing.id,
            thread_id=existing.thread_id,
            latency_ms=existing.latency_ms,
        )

    agent_config = _build_agent_config(agent, current_user, db)
    agent_config = _resolve_nested_agents(agent_config, db, current_user)
    # Resolve any saved MCP server references in tools_config
    try:
        agent_config["tools_config"] = await mcp_service.resolve_tools_config(
            agent_config.get("tools_config") or [], db, current_user.id
        )
    except Exception:
        pass  # fall back to original config on resolution failure
    workspace = None
    if agent_config["sandbox_enabled"]:
        workspace = sandbox_service.create_workspace(f"agent-{agent.id}")
        agent_config["workspace"] = workspace

    started_ms = now_ms()

    # Create run record
    thread_id = request.thread_id or str(uuid.uuid4())
    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        status="running",
        thread_id=thread_id,
        client_request_id=request.client_request_id,
    )
    db.add(run)
    db.commit()
    bill_run(db, run, agent, entitlement)
    db.commit()
    db.refresh(run)

    try:
        result = await run_agent(
            agent_config,
            request.input,
            thread_id=thread_id,
        )
        usage = result.get("usage") or {}
        run.output = result["output"]
        run.status = "completed"
        run.latency_ms = now_ms() - started_ms
        run.input_tokens = usage.get("input_tokens", 0)
        run.output_tokens = usage.get("output_tokens", 0)
        run.total_tokens = usage.get("total_tokens", 0)
        run.estimated_cost_usd = usage.get("estimated_cost_usd", 0.0)
        db.commit()
        return RunResponse(
            output=result["output"],
            agent_id=agent_id,
            run_id=run.id,
            thread_id=thread_id,
            confidence=result.get("confidence"),
            latency_ms=run.latency_ms,
            usage=usage,
        )
    except Exception as e:
        run.status = "error"
        run.error = str(e)
        run.latency_ms = now_ms() - started_ms
        db.commit()
        refund_run(db, run)  # failed executions are never billed
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")
    finally:
        if workspace:
            sandbox_service.cleanup_workspace(workspace)


@router.post("/{agent_id}/run/stream")
async def stream_agent_endpoint(
    agent_id: int,
    request: RunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Money: marketplace authorization + pay-per-execution billing (replaces credits)
    try:
        entitlement = authorize_run(db, agent, current_user, request.client_request_id)
    except RunDenied as e:
        raise _run_denied_http(e)

    agent_config = _build_agent_config(agent, current_user, db)
    agent_config = _resolve_nested_agents(agent_config, db, current_user)
    # Resolve any saved MCP server references in tools_config
    try:
        agent_config["tools_config"] = await mcp_service.resolve_tools_config(
            agent_config.get("tools_config") or [], db, current_user.id
        )
    except Exception:
        pass  # fall back to original config on resolution failure
    workspace = None
    if agent_config["sandbox_enabled"]:
        workspace = sandbox_service.create_workspace(f"agent-{agent.id}")
        agent_config["workspace"] = workspace

    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        status="running",
        thread_id=request.thread_id or str(uuid.uuid4()),
        client_request_id=request.client_request_id,
    )
    db.add(run)
    db.commit()
    bill_run(db, run, agent, entitlement)
    db.commit()
    db.refresh(run)

    thread_id = run.thread_id
    started_ms = now_ms()

    async def event_generator():
        full_output = ""
        collected_events = []
        tool_calls = 0
        try:
            async for event in stream_agent(agent_config, request.input, thread_id=thread_id):
                etype = event.get("type")
                collected_events.append(event)
                if etype == "token":
                    full_output += event["content"]
                    yield {"event": "token", "data": event["content"]}
                elif etype == "tool_call":
                    tool_calls += 1
                    yield {
                        "event": "tool_call",
                        "data": json.dumps({"name": event.get("name"), "args": event.get("args", {})}),
                    }
                elif etype == "tool_result":
                    yield {
                        "event": "tool_result",
                        "data": json.dumps({"name": event.get("name"), "content": event.get("content", "")}),
                    }
                elif etype == "agent_step":
                    yield {
                        "event": "agent_step",
                        "data": json.dumps({"agent": event.get("agent"), "content": event.get("content", "")}),
                    }
                elif etype == "reflection":
                    yield {
                        "event": "reflection",
                        "data": json.dumps({
                            "round": event.get("round", 1),
                            "content": event.get("content", ""),
                        }),
                    }
                elif etype == "confidence":
                    yield {
                        "event": "confidence",
                        "data": json.dumps({
                            "confidence": event.get("content", 0.0),
                            "escalated": event.get("escalated", False),
                        }),
                    }
                elif etype == "done":
                    usage = event.get("usage") or {}
                    run.output = event["content"] or full_output
                    run.messages = collected_events  # persist full event stream for history visualization
                    run.steps_count = tool_calls
                    run.latency_ms = now_ms() - started_ms
                    run.input_tokens = usage.get("input_tokens", 0)
                    run.output_tokens = usage.get("output_tokens", 0)
                    run.total_tokens = usage.get("total_tokens", 0)
                    run.estimated_cost_usd = usage.get("estimated_cost_usd", 0.0)
                    run.status = "completed"
                    db.commit()
                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "output": run.output,
                            "thread_id": thread_id,
                            "run_id": run.id,
                            "confidence": collected_events and next(
                                (e.get("content") for e in reversed(collected_events) if e.get("type") == "confidence"),
                                None,
                            ),
                            "latency_ms": run.latency_ms,
                            "steps_count": tool_calls,
                            "usage": usage,
                        }),
                    }
                elif etype == "error":
                    run.status = "error"
                    run.error = event["content"]
                    run.messages = collected_events
                    run.latency_ms = now_ms() - started_ms
                    db.commit()
                    refund_run(db, run)  # failed executions are never billed
                    yield {"event": "error", "data": event["content"]}
        except Exception as e:
            run.status = "error"
            run.error = str(e)
            run.messages = collected_events
            run.latency_ms = now_ms() - started_ms
            db.commit()
            refund_run(db, run)  # failed executions are never billed
            yield {"event": "error", "data": str(e)}
        finally:
            if workspace:
                sandbox_service.cleanup_workspace(workspace)

    return EventSourceResponse(event_generator())


@router.post("/{agent_id}/evaluate", response_model=EvaluateResponse)
async def evaluate_agent(
    agent_id: int,
    request: EvaluateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> Any:
    """Run the agent then evaluate the output with an LLM-as-judge."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    agent_config = _build_agent_config(agent, current_user, db)

    try:
        result = await run_agent(agent_config, request.input)
        output = result["output"]
        eval_result = await evaluate_output(
            agent_config, request.input, output, criteria=request.criteria or "helpfulness, accuracy, and clarity"
        )
        score = float(eval_result.get("score", 5))
        # Persist evaluation
        evaluation = AgentEvaluation(
            agent_id=agent.id,
            user_id=current_user.id,
            input=request.input,
            agent_output=output,
            score=score,
            explanation=eval_result.get("explanation", ""),
            criteria=request.criteria,
            criteria_scores=eval_result.get("criteria_scores"),
        )
        db.add(evaluation)
        db.commit()
        return EvaluateResponse(
            score=score,
            explanation=eval_result.get("explanation", ""),
            agent_output=output,
            criteria_scores=eval_result.get("criteria_scores"),
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")


@router.post("/{agent_id}/evaluate/batch", response_model=BatchEvaluateResponse)
async def batch_evaluate_agent(
    agent_id: int,
    request: BatchEvaluateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> Any:
    """Batch evaluation harness: run the agent on multiple inputs and score each with LLM-as-judge."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    agent_config = _build_agent_config(agent, current_user, db)

    results = []
    scores = []
    criteria = request.criteria or "helpfulness, accuracy, and clarity"

    for user_input in request.inputs[:10]:  # safety cap
        try:
            result = await run_agent(agent_config, user_input)
            output = result["output"]
            eval_result = await evaluate_output(agent_config, user_input, output, criteria=criteria)
            score = float(eval_result.get("score", 5))
            results.append({
                "input": user_input,
                "score": score,
                "explanation": eval_result.get("explanation", ""),
                "agent_output": output,
            })
            scores.append(score)
            # Persist each evaluation
            evaluation = AgentEvaluation(
                agent_id=agent.id,
                user_id=current_user.id,
                input=user_input,
                agent_output=output,
                score=score,
                explanation=eval_result.get("explanation", ""),
                criteria=criteria,
                criteria_scores=eval_result.get("criteria_scores"),
            )
            db.add(evaluation)
        except Exception as e:
            db.rollback()
            results.append({
                "input": user_input,
                "score": 0.0,
                "explanation": f"Error: {str(e)}",
                "agent_output": "",
            })
            scores.append(0.0)

    db.commit()
    avg = sum(scores) / len(scores) if scores else 0.0
    return BatchEvaluateResponse(results=results, average_score=round(avg, 2), count=len(results))


@router.get("/{agent_id}/runs", response_model=List[AgentRunPublic])
async def list_agent_runs(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
    skip: int = 0,
    limit: int = 50,
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or (agent.owner_id != current_user.id and not agent.is_public):
        raise HTTPException(status_code=404, detail="Agent not found or access denied")

    runs = (
        db.query(AgentRun)
        .filter(AgentRun.agent_id == agent_id, AgentRun.user_id == current_user.id)
        .order_by(AgentRun.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return runs


@router.get("/{agent_id}/threads")
async def list_agent_threads(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
    limit: int = 30,
):
    """List distinct conversation threads for this agent (grouped by thread_id), newest first."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or (agent.owner_id != current_user.id and not agent.is_public):
        raise HTTPException(status_code=404, detail="Agent not found or access denied")

    from sqlalchemy import func
    # Get latest run per thread_id
    subq = (
        db.query(
            AgentRun.thread_id,
            func.max(AgentRun.created_at).label("last_at"),
        )
        .filter(
            AgentRun.agent_id == agent_id,
            AgentRun.user_id == current_user.id,
            AgentRun.thread_id.isnot(None),
        )
        .group_by(AgentRun.thread_id)
        .subquery()
    )
    rows = (
        db.query(AgentRun)
        .join(subq, (AgentRun.thread_id == subq.c.thread_id) & (AgentRun.created_at == subq.c.last_at))
        .order_by(AgentRun.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "thread_id": r.thread_id,
            "last_input": r.input[:120] + ("…" if len(r.input) > 120 else ""),
            "last_output": (r.output or "")[:200] + ("…" if r.output and len(r.output) > 200 else ""),
            "updated_at": r.created_at.isoformat(),
            "run_count": db.query(func.count(AgentRun.id)).filter(
                AgentRun.thread_id == r.thread_id, AgentRun.user_id == current_user.id
            ).scalar() or 0,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Devin-style DIRECT AUTOMATION: unattended background task runs
# ---------------------------------------------------------------------------

_AUTOMATION_DIRECTIVE = (
    "\n\nOPERATING MODE: DIRECT AUTOMATION (unattended task)."
    " Work fully autonomously — there is no user available to answer questions mid-run."
    " Never ask for confirmation; make reasonable decisions guided by the task."
    " Use available tools to gather facts and verify your results."
    " If a step is blocked, record the blocker and continue with the best alternative path."
    " Finish with a final DELIVERABLE report with exactly these sections:"
    " Outcome (done / partial / failed); What was done; Results & artifacts (key data inline);"
    " Verification performed; Caveats & next steps. Do not end with a question."
)

# Keep references so created tasks are not garbage-collected mid-run
_BACKGROUND_TASKS: set = set()


async def _execute_automation_task(run_id: int, agent_id: int, user_id: int) -> None:
    """Background executor for a direct-automation run. Uses its own DB session."""
    from app.core.database import SessionLocal

    db = SessionLocal()
    workspace = None
    started_ms = now_ms()
    try:
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        user = db.query(User).filter(User.id == user_id).first()
        if run is None or agent is None or user is None:
            return
        if run.status == "cancelled":
            return

        agent_config = _build_agent_config(agent, user, db)
        agent_config = _resolve_nested_agents(agent_config, db, user)
        try:
            agent_config["tools_config"] = await mcp_service.resolve_tools_config(
                agent_config.get("tools_config") or [], db, user.id
            )
        except Exception:
            pass
        # Autonomous operation: autonomy directive + generous step budget
        agent_config["system_prompt"] = (agent_config.get("system_prompt") or "") + _AUTOMATION_DIRECTIVE
        agent_config["max_steps"] = max(int(agent_config.get("max_steps") or 25) or 25, 50)
        # Run without approval gates: unattended by definition
        if "autonomy_level" in agent_config:
            agent_config["autonomy_level"] = "autonomous"
        if agent_config.get("sandbox_enabled"):
            workspace = sandbox_service.create_workspace(f"task-{run_id}")
            agent_config["workspace"] = workspace

        result = await run_agent(agent_config, run.input, thread_id=run.thread_id)
        usage = result.get("usage") or {}

        db.refresh(run)  # pick up a cancel that may have happened mid-run
        run.output = result["output"]
        run.latency_ms = now_ms() - started_ms
        run.input_tokens = usage.get("input_tokens", 0)
        run.output_tokens = usage.get("output_tokens", 0)
        run.total_tokens = usage.get("total_tokens", 0)
        run.estimated_cost_usd = usage.get("estimated_cost_usd", 0.0)
        if run.status != "cancelled":
            run.status = "completed"
        db.commit()
    except Exception as e:
        db.rollback()
        run = db.query(AgentRun).filter(AgentRun.id == run_id).first()
        if run is not None:
            if run.status != "cancelled":
                run.status = "error"
                run.error = str(e)[:2000]
            run.latency_ms = now_ms() - started_ms
            db.commit()
            refund_run(db, run)  # failed executions are never billed
    finally:
        if workspace:
            sandbox_service.cleanup_workspace(workspace)
        db.close()


def _spawn_automation_task(run: AgentRun, agent: Agent, user: User) -> None:
    task = asyncio.create_task(_execute_automation_task(run.id, agent.id, user.id))
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


@router.post("/{agent_id}/tasks", response_model=AgentRunPublic, status_code=status.HTTP_202_ACCEPTED)
async def create_agent_task(
    agent_id: int,
    request: AgentTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> Any:
    """Create a DIRECT AUTOMATION task: the agent runs it unattended in the background."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Money: marketplace authorization + pay-per-execution billing (replaces credits)
    try:
        entitlement = authorize_run(db, agent, current_user, request.client_request_id)
    except RunDenied as e:
        raise _run_denied_http(e)
    except RunIdempotentReplay as replay:
        existing = replay.run
        return AgentRunPublic.model_validate(existing)

    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        title=request.title.strip()[:200] or "Automation task",
        status="running",
        mode="automation",
        thread_id=str(uuid.uuid4()),  # isolated session: try it in chat later
        client_request_id=request.client_request_id,
    )
    db.add(run)
    db.commit()
    bill_run(db, run, agent, entitlement)
    db.commit()
    db.refresh(run)
    _spawn_automation_task(run, agent, current_user)
    return run


@router.get("/{agent_id}/tasks", response_model=List[AgentRunPublic])
async def list_agent_tasks(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
    limit: int = 50,
) -> Any:
    """List this agent's DIRECT AUTOMATION tasks (mode=automation), newest first."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or (agent.owner_id != current_user.id and not agent.is_public):
        raise HTTPException(status_code=404, detail="Agent not found or access denied")
    return (
        db.query(AgentRun)
        .filter(AgentRun.agent_id == agent_id, AgentRun.user_id == current_user.id,
                AgentRun.mode == "automation")
        .order_by(AgentRun.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/{agent_id}/tasks/{run_id}", response_model=AgentRunPublic)
async def get_agent_task(
    agent_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> Any:
    run = (
        db.query(AgentRun)
        .filter(AgentRun.id == run_id, AgentRun.agent_id == agent_id,
                AgentRun.user_id == current_user.id, AgentRun.mode == "automation")
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Task not found")
    return run


@router.post("/{agent_id}/tasks/{run_id}/cancel", response_model=AgentRunPublic)
async def cancel_agent_task(
    agent_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
) -> Any:
    """Cooperative cancel: marks the task cancelled; the executor preserves that status."""
    from fastapi import status as http_status

    run = (
        db.query(AgentRun)
        .filter(AgentRun.id == run_id, AgentRun.agent_id == agent_id,
                AgentRun.user_id == current_user.id, AgentRun.mode == "automation")
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Task not found")
    if run.status in ("pending", "running"):
        run.status = "cancelled"
        db.commit()
    db.refresh(run)
    return run


@router.get("/runs/all", response_model=List[AgentRunPublic])
async def list_all_my_runs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
    skip: int = 0,
    limit: int = 50,
):
    """All runs made by the current user across their agents (dashboard feed)."""
    return (
        db.query(AgentRun)
        .filter(AgentRun.user_id == current_user.id)
        .order_by(AgentRun.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{agent_id}/evaluations", response_model=List[AgentEvaluationPublic])
def list_evaluations(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
    skip: int = 0,
    limit: int = 50,
):
    """List persisted evaluation results for an agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or (agent.owner_id != current_user.id and not agent.is_public):
        raise HTTPException(status_code=404, detail="Agent not found or access denied")

    evals = (
        db.query(AgentEvaluation)
        .filter(AgentEvaluation.agent_id == agent_id)
        .order_by(AgentEvaluation.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return evals


@router.get("/{agent_id}/evaluations/summary", response_model=EvaluationSummary)
def evaluation_summary(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_flexible),
):
    """Summary statistics and recent evaluations for dashboard charts."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or (agent.owner_id != current_user.id and not agent.is_public):
        raise HTTPException(status_code=404, detail="Agent not found or access denied")

    from sqlalchemy import func
    stats = (
        db.query(func.count(AgentEvaluation.id), func.avg(AgentEvaluation.score))
        .filter(AgentEvaluation.agent_id == agent_id)
        .first()
    )
    count = stats[0] or 0
    avg = float(stats[1] or 0.0)

    recent = (
        db.query(AgentEvaluation)
        .filter(AgentEvaluation.agent_id == agent_id)
        .order_by(AgentEvaluation.created_at.desc())
        .limit(20)
        .all()
    )
    return EvaluationSummary(count=count, average_score=round(avg, 2), recent=recent)


from pydantic import BaseModel

class ApprovalRequest(BaseModel):
    request_id: str
    approved: bool

@router.post("/approval")
async def resolve_tool_approval(
    body: ApprovalRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: Session = Depends(get_db),
):
    """Resolve a pending human-in-the-loop tool approval.
    Called by the frontend when the user approves or denies a tool call.
    """
    # Verify ownership via the request_id record when possible
    approval = db.query(ToolApproval).filter(ToolApproval.request_id == body.request_id).first()
    if approval and approval.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to resolve this approval")
    success = resolve_approval(body.request_id, body.approved)
    if not success:
        raise HTTPException(status_code=404, detail="Approval request not found or already resolved")
    return {"status": "ok", "request_id": body.request_id, "approved": body.approved}


@router.get("/approvals/pending")
async def list_pending_approvals(
    current_user: User = Depends(get_current_user_flexible),
    db: Session = Depends(get_db),
):
    """List all pending tool approval requests for the current user.
    Useful for reconnecting clients or a dedicated approvals inbox.
    """
    rows = (
        db.query(ToolApproval)
        .filter(ToolApproval.user_id == current_user.id, ToolApproval.status == "pending")
        .order_by(ToolApproval.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "request_id": r.request_id,
            "agent_id": r.agent_id,
            "thread_id": r.thread_id,
            "tool_name": r.tool_name,
            "tool_args": r.tool_args,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]

