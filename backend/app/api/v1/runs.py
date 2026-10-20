from typing import Any, List, Optional
import uuid
import time
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.agents.runtime import run_agent, stream_agent, now_ms
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, AgentRun, User, AgentEvaluation, CreditTransaction
from app.schemas import AgentRunPublic, RunRequest, RunResponse, EvaluateRequest, EvaluateResponse, BatchEvaluateRequest, BatchEvaluateResponse, AgentEvaluationPublic, EvaluationSummary
from app.services.sandbox_service import sandbox_service

router = APIRouter()


def _build_agent_config(agent: Agent, user: User) -> dict:
    """Serialize an Agent model into the runtime configuration dict."""
    return {
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


@router.post("/{agent_id}/run", response_model=RunResponse)
async def run_agent_endpoint(
    agent_id: int,
    request: RunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    # Credit check (simple usage metering)
    if current_user.credits < 1:
        raise HTTPException(status_code=402, detail="Insufficient credits to run agent")

    agent_config = _build_agent_config(agent, current_user)
    workspace = None
    if agent_config["sandbox_enabled"]:
        workspace = sandbox_service.create_workspace(f"agent-{agent.id}")
        agent_config["workspace"] = workspace

    started_ms = now_ms()

    # Create run record
    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        status="running",
    )
    db.add(run)
    # Deduct 1 credit for the run
    current_user.credits -= 1
    db.add(CreditTransaction(
        user_id=current_user.id,
        amount=-1,
        balance_after=current_user.credits,
        reason="run_meter",
        agent_id=agent.id,
    ))
    db.commit()
    db.refresh(run)

    try:
        result = await run_agent(
            agent_config,
            request.input,
            thread_id=request.thread_id or str(run.id),
        )
        run.output = result["output"]
        run.status = "completed"
        run.latency_ms = now_ms() - started_ms
        db.commit()
        return RunResponse(
            output=result["output"],
            agent_id=agent_id,
            run_id=run.id,
            confidence=result.get("confidence"),
            latency_ms=run.latency_ms,
        )
    except Exception as e:
        run.status = "error"
        run.error = str(e)
        run.latency_ms = now_ms() - started_ms
        db.commit()
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")
    finally:
        if workspace:
            sandbox_service.cleanup_workspace(workspace)


@router.post("/{agent_id}/run/stream")
async def stream_agent_endpoint(
    agent_id: int,
    request: RunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    if current_user.credits < 1:
        raise HTTPException(status_code=402, detail="Insufficient credits to run agent")

    agent_config = _build_agent_config(agent, current_user)
    workspace = None
    if agent_config["sandbox_enabled"]:
        workspace = sandbox_service.create_workspace(f"agent-{agent.id}")
        agent_config["workspace"] = workspace

    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        status="running",
    )
    db.add(run)
    current_user.credits -= 1
    db.add(CreditTransaction(
        user_id=current_user.id,
        amount=-1,
        balance_after=current_user.credits,
        reason="run_meter",
        agent_id=agent.id,
    ))
    db.commit()
    db.refresh(run)

    thread_id = request.thread_id or str(run.id)
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
                    run.output = event["content"] or full_output
                    run.messages = collected_events  # persist full event stream for history visualization
                    run.steps_count = tool_calls
                    run.latency_ms = now_ms() - started_ms
                    run.status = "completed"
                    db.commit()
                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "output": run.output,
                            "confidence": collected_events and next(
                                (e.get("content") for e in reversed(collected_events) if e.get("type") == "confidence"),
                                None,
                            ),
                            "latency_ms": run.latency_ms,
                            "steps_count": tool_calls,
                        }),
                    }
                elif etype == "error":
                    run.status = "error"
                    run.error = event["content"]
                    run.messages = collected_events
                    run.latency_ms = now_ms() - started_ms
                    db.commit()
                    yield {"event": "error", "data": event["content"]}
        except Exception as e:
            run.status = "error"
            run.error = str(e)
            run.messages = collected_events
            run.latency_ms = now_ms() - started_ms
            db.commit()
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
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Run the agent then evaluate the output with an LLM-as-judge."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    agent_config = _build_agent_config(agent, current_user)

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
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Batch evaluation harness: run the agent on multiple inputs and score each with LLM-as-judge."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    agent_config = _build_agent_config(agent, current_user)

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
    current_user: User = Depends(get_current_active_user),
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


@router.get("/runs/all", response_model=List[AgentRunPublic])
async def list_all_my_runs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
    current_user: User = Depends(get_current_active_user),
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
    current_user: User = Depends(get_current_active_user),
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
