from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.agents.runtime import run_agent, stream_agent
from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, AgentRun, User
from app.schemas import AgentRunPublic, RunRequest, RunResponse

router = APIRouter()


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

    agent_config = {
        "model_name": agent.model_name,
        "temperature": agent.temperature,
        "system_prompt": agent.system_prompt,
        "tools_config": agent.tools_config or [],
        "memory_config": agent.memory_config or {},
        "workflow_config": agent.workflow_config or {},
    }

    # Create run record
    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        output = await run_agent(
            agent_config,
            request.input,
            thread_id=request.thread_id or str(run.id),
        )
        run.output = output
        run.status = "completed"
        db.commit()
    except Exception as e:
        run.status = "error"
        run.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")

    return RunResponse(output=output, agent_id=agent_id, run_id=run.id)


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

    agent_config = {
        "model_name": agent.model_name,
        "temperature": agent.temperature,
        "system_prompt": agent.system_prompt,
        "tools_config": agent.tools_config or [],
        "memory_config": agent.memory_config or {},
        "workflow_config": agent.workflow_config or {},
    }

    run = AgentRun(
        agent_id=agent_id,
        user_id=current_user.id,
        input=request.input,
        status="running",
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    thread_id = request.thread_id or str(run.id)

    async def event_generator():
        full_output = ""
        try:
            async for event in stream_agent(agent_config, request.input, thread_id=thread_id):
                etype = event.get("type")
                if etype == "token":
                    full_output += event["content"]
                    yield {"event": "token", "data": event["content"]}
                elif etype == "tool_call":
                    import json
                    yield {
                        "event": "tool_call",
                        "data": json.dumps({"name": event.get("name"), "args": event.get("args", {})}),
                    }
                elif etype == "tool_result":
                    import json
                    yield {
                        "event": "tool_result",
                        "data": json.dumps({"name": event.get("name"), "content": event.get("content", "")}),
                    }
                elif etype == "done":
                    run.output = event["content"] or full_output
                    run.status = "completed"
                    db.commit()
                    yield {"event": "done", "data": run.output}
                elif etype == "error":
                    run.status = "error"
                    run.error = event["content"]
                    db.commit()
                    yield {"event": "error", "data": event["content"]}
        except Exception as e:
            run.status = "error"
            run.error = str(e)
            db.commit()
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(event_generator())


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
