from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, User
from app.schemas import AgentCreate, AgentPublic, AgentUpdate
from app.services.mcp_service import mcp_service

router = APIRouter()


@router.get("/", response_model=List[AgentPublic])
def read_agents(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agents = (
        db.query(Agent)
        .filter(Agent.owner_id == current_user.id)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return agents


@router.post("/", response_model=AgentPublic, status_code=status.HTTP_201_CREATED)
def create_agent(
    *,
    db: Session = Depends(get_db),
    agent_in: AgentCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = Agent(
        **agent_in.model_dump(),
        owner_id=current_user.id,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


@router.get("/{agent_id}", response_model=AgentPublic)
def read_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return agent


@router.put("/{agent_id}", response_model=AgentPublic)
def update_agent(
    agent_id: int,
    agent_in: AgentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    update_data = agent_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(agent, field, value)
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    db.delete(agent)
    db.commit()


@router.post("/discover-tools")
async def discover_mcp_tools(
    tools_config: List[dict],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    Discover tools available from the provided MCP server configurations.
    Useful for the Agent Builder UI to preview tools before saving.
    """
    try:
        tools = await mcp_service.discover_tools(tools_config)
        return {"tools": tools, "count": len(tools)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"MCP discovery failed: {str(e)}")
