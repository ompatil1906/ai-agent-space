from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agents.runtime import run_agent
from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, User

router = APIRouter()


class RunRequest(BaseModel):
    input: str


class RunResponse(BaseModel):
    output: str
    agent_id: int


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
    }

    try:
        output = await run_agent(agent_config, request.input)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")

    return RunResponse(output=output, agent_id=agent_id)
