from typing import Any, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Agent, AgentVersion, User
from app.schemas import (
    AgentCreate,
    AgentPublic,
    AgentUpdate,
    AgentVersionPublic,
    AgentVersionCreate,
)
from app.services.mcp_service import mcp_service

router = APIRouter()


def _create_version(db: Session, agent: Agent, created_by: Optional[int] = None, change_note: str = "Auto snapshot") -> AgentVersion:
    """Create a new version snapshot of the current agent state."""
    # Determine next version number
    last = (
        db.query(AgentVersion)
        .filter(AgentVersion.agent_id == agent.id)
        .order_by(AgentVersion.version_number.desc())
        .first()
    )
    next_num = (last.version_number + 1) if last else 1

    snapshot = {
        "name": agent.name,
        "description": agent.description,
        "system_prompt": agent.system_prompt,
        "model_name": agent.model_name,
        "temperature": agent.temperature,
        "tools_config": agent.tools_config or [],
        "memory_config": agent.memory_config or {},
        "workflow_config": agent.workflow_config or {},
        "max_steps": agent.max_steps if agent.max_steps is not None else 25,
        "autonomy_level": agent.autonomy_level or "supervised",
        "sandbox_enabled": bool(agent.sandbox_enabled),
        "advanced_config": agent.advanced_config or {},
        "is_public": agent.is_public,
        "is_published": agent.is_published,
        "price": agent.price,
    }

    version = AgentVersion(
        agent_id=agent.id,
        version_number=next_num,
        name=agent.name,
        description=agent.description,
        system_prompt=agent.system_prompt,
        model_name=agent.model_name,
        temperature=agent.temperature,
        tools_config=agent.tools_config or [],
        memory_config=agent.memory_config or {},
        workflow_config=agent.workflow_config or {},
        snapshot=snapshot,
        created_by=created_by,
        change_note=change_note,
    )
    db.add(version)
    return version


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
    # Initial version
    _create_version(db, agent, created_by=current_user.id, change_note="Initial version")
    db.commit()
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
    # Snapshot after update
    _create_version(db, agent, created_by=current_user.id, change_note="Updated agent")
    db.commit()
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


@router.get("/{agent_id}/versions", response_model=List[AgentVersionPublic])
def list_agent_versions(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    versions = (
        db.query(AgentVersion)
        .filter(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version_number.desc())
        .all()
    )
    return versions


@router.post("/{agent_id}/versions/{version_id}/restore", response_model=AgentPublic)
def restore_agent_version(
    agent_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    version = db.query(AgentVersion).filter(
        AgentVersion.id == version_id, AgentVersion.agent_id == agent_id
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    # Restore fields from snapshot
    snap = version.snapshot or {}
    for field in ["name", "description", "system_prompt", "model_name", "temperature",
                  "tools_config", "memory_config", "workflow_config",
                  "max_steps", "autonomy_level", "sandbox_enabled", "advanced_config",
                  "is_public", "is_published", "price"]:
        if field in snap:
            setattr(agent, field, snap[field])
    db.add(agent)
    db.commit()
    db.refresh(agent)
    # Create a new version marking the restore
    _create_version(db, agent, created_by=current_user.id, change_note=f"Restored from version {version.version_number}")
    db.commit()
    return agent


@router.post("/{agent_id}/versions", response_model=AgentVersionPublic, status_code=status.HTTP_201_CREATED)
def create_manual_version(
    agent_id: int,
    body: AgentVersionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    version = _create_version(db, agent, created_by=current_user.id, change_note=body.change_note or "Manual snapshot")
    db.commit()
    db.refresh(version)
    return version


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


@router.post("/discover-resources")
async def discover_mcp_resources(
    tools_config: List[dict],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Discover MCP resources available from the configured servers (for Agent Builder preview)."""
    try:
        resources = await mcp_service.discover_resources(tools_config)
        return {"resources": resources, "count": len(resources)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"MCP resource discovery failed: {str(e)}")


@router.post("/discover-prompts")
async def discover_mcp_prompts(
    tools_config: List[dict],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Discover MCP prompts available from the configured servers."""
    try:
        prompts = await mcp_service.discover_prompts(tools_config)
        return {"prompts": prompts, "count": len(prompts)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"MCP prompt discovery failed: {str(e)}")


@router.post("/mcp/validate")
async def validate_mcp_configs(
    tools_config: List[dict],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Validate MCP server configurations before saving an agent."""
    results = await mcp_service.validate_config(tools_config)
    return {"results": results, "all_valid": all(r["valid"] for r in results)}


@router.post("/mcp/health")
async def mcp_health_check(
    tools_config: List[dict],
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Perform a health check against the configured MCP servers."""
    result = await mcp_service.health_check(tools_config)
    return result


@router.post("/{agent_id}/memory/clear")
def clear_agent_memory(
    agent_id: int,
    shared: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Clear long-term semantic memories for the current user on this agent.
    Pass ?shared=true to clear the multi-agent team shared namespace."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    from app.services.memory_service import get_memory_service
    ns = f"team_{agent_id}" if shared else None
    deleted = get_memory_service().clear_for_agent_user(
        agent_id, current_user.id, shared_namespace=ns
    )
    return {"cleared": deleted, "agent_id": agent_id, "user_id": current_user.id, "shared": shared}


@router.delete("/{agent_id}/memories/{memory_id}")
def delete_agent_memory(
    agent_id: int,
    memory_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Delete a specific long-term memory by ID."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    from app.services.memory_service import get_memory_service
    success = get_memory_service().delete_memory(memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found or could not be deleted")
    return {"deleted": True, "memory_id": memory_id, "agent_id": agent_id}


@router.post("/{agent_id}/memories/consolidate")
def consolidate_agent_memories(
    agent_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Consolidate long-term memories into denser summaries for the current user on this agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.owner_id == current_user.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    mem_cfg = agent.memory_config or {}
    shared = mem_cfg.get("shared")
    shared_ns = mem_cfg.get("shared_namespace") if shared else None
    result = get_memory_service().consolidate(
        agent_id=agent_id,
        user_id=current_user.id,
        shared_namespace=shared_ns,
    )
    return {"ok": True, **result}



@router.post("/{agent_id}/knowledge")
async def add_agent_knowledge(
    agent_id: int,
    payload: dict,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Add a document (raw text) to the agent's knowledge base.
    
    Body: {"text": "...", "source_name": "optional-filename.md"}
    Chunks are embedded and stored for retrieval during agent runs.
    """
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.owner_id == current_user.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    text = (payload.get("text") or "").strip()
    source_name = (payload.get("source_name") or "document").strip() or "document"
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    from app.services.memory_service import get_memory_service
    mem_cfg = agent.memory_config or {}
    shared_ns = f"team_{agent_id}" if mem_cfg.get("shared") else None
    ids = get_memory_service().add_knowledge_document(
        agent_id=agent_id,
        user_id=current_user.id,
        text=text,
        source_name=source_name,
        shared_namespace=shared_ns,
    )
    return {
        "ok": True,
        "agent_id": agent_id,
        "source_name": source_name,
        "chunks_created": len(ids),
        "ids": ids,
    }


@router.get("/{agent_id}/knowledge")
def list_agent_knowledge(
    agent_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """List knowledge-base documents/chunks for this agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    from app.services.memory_service import get_memory_service
    mem_cfg = agent.memory_config or {}
    shared_ns = f"team_{agent_id}" if mem_cfg.get("shared") else None
    items = get_memory_service().list_knowledge(
        agent_id=agent_id,
        user_id=current_user.id,
        shared_namespace=shared_ns,
    )
    # Group by source for nicer UI
    by_source: dict = {}
    for item in items:
        src = item.get("source") or "unknown"
        by_source.setdefault(src, []).append(item)
    return {
        "agent_id": agent_id,
        "sources": [
            {"source": src, "chunk_count": len(chunks), "chunks": chunks}
            for src, chunks in by_source.items()
        ],
        "total_chunks": len(items),
    }


@router.delete("/{agent_id}/knowledge/{source_name}")
def delete_agent_knowledge_source(
    agent_id: int,
    source_name: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Delete all knowledge chunks belonging to a named source."""
    agent = db.query(Agent).filter(Agent.id == agent_id, Agent.owner_id == current_user.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    from app.services.memory_service import get_memory_service
    mem_cfg = agent.memory_config or {}
    shared_ns = f"team_{agent_id}" if mem_cfg.get("shared") else None
    deleted = get_memory_service().delete_knowledge_source(
        agent_id=agent_id,
        user_id=current_user.id,
        source_name=source_name,
        shared_namespace=shared_ns,
    )
    return {"ok": True, "deleted": deleted, "source_name": source_name, "agent_id": agent_id}



@router.get("/{agent_id}/memories")
def list_agent_memories(
    agent_id: int,
    limit: int = 50,
    shared: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """List long-term semantic memories for the current user on this agent.
    Pass ?shared=true to list the multi-agent team shared namespace."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.owner_id != current_user.id and not agent.is_public:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    from app.services.memory_service import get_memory_service
    ns = f"team_{agent_id}" if shared else None
    memories = get_memory_service().list_memories(
        agent_id, current_user.id, limit=limit, shared_namespace=ns
    )
    return {
        "agent_id": agent_id,
        "user_id": current_user.id,
        "shared": shared,
        "count": len(memories),
        "memories": memories,
    }
