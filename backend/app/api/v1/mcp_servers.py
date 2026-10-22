"""User-owned MCP Server Registry.

Allows users to save reusable MCP server configurations and select them
when building agents. Supports full CRUD + connection validation.
"""
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import User, MCPServer
from app.schemas import MCPServerCreate, MCPServerPublic, MCPServerUpdate
from app.services.mcp_service import mcp_service

router = APIRouter()


@router.get("/", response_model=List[MCPServerPublic])
def list_mcp_servers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """List the current user's registered MCP servers."""
    servers = (
        db.query(MCPServer)
        .filter(MCPServer.owner_id == current_user.id)
        .order_by(MCPServer.created_at.desc())
        .all()
    )
    return servers


@router.post("/", response_model=MCPServerPublic, status_code=status.HTTP_201_CREATED)
async def create_mcp_server(
    payload: MCPServerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Register a new MCP server configuration. Validates the config first."""
    # Basic validation via MCP service
    validation = await mcp_service.validate_config([payload.config])
    if not validation or not validation[0].get("valid", False):
        err = validation[0].get("error") if validation else "Invalid config"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"MCP config validation failed: {err}",
        )

    server = MCPServer(
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
        config=payload.config,
        is_public=payload.is_public,
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@router.get("/{server_id}", response_model=MCPServerPublic)
def get_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    server = (
        db.query(MCPServer)
        .filter(MCPServer.id == server_id, MCPServer.owner_id == current_user.id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return server


@router.put("/{server_id}", response_model=MCPServerPublic)
async def update_mcp_server(
    server_id: int,
    payload: MCPServerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    server = (
        db.query(MCPServer)
        .filter(MCPServer.id == server_id, MCPServer.owner_id == current_user.id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "config" in update_data and update_data["config"] is not None:
        validation = await mcp_service.validate_config([update_data["config"]])
        if not validation or not validation[0].get("valid", False):
            err = validation[0].get("error") if validation else "Invalid config"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"MCP config validation failed: {err}",
            )

    for field, value in update_data.items():
        setattr(server, field, value)

    db.commit()
    db.refresh(server)
    return server


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    server = (
        db.query(MCPServer)
        .filter(MCPServer.id == server_id, MCPServer.owner_id == current_user.id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    db.delete(server)
    db.commit()


@router.post("/{server_id}/validate")
async def validate_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Re-validate a saved MCP server configuration."""
    server = (
        db.query(MCPServer)
        .filter(MCPServer.id == server_id, MCPServer.owner_id == current_user.id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    results = await mcp_service.validate_config([server.config])
    return {"server_id": server_id, "results": results}


@router.post("/{server_id}/discover")
async def discover_mcp_server(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Discover tools, resources, and prompts from a saved MCP server."""
    server = (
        db.query(MCPServer)
        .filter(MCPServer.id == server_id, MCPServer.owner_id == current_user.id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    tools = await mcp_service.discover_tools([server.config])
    resources = await mcp_service.discover_resources([server.config])
    prompts = await mcp_service.discover_prompts([server.config])
    return {
        "server_id": server_id,
        "tools": tools,
        "resources": resources,
        "prompts": prompts,
    }
