"""User-owned MCP Server Registry.

Allows users to save reusable MCP server configurations and select them
when building agents. Supports full CRUD + connection validation.
"""
from typing import Any, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import User, MCPServer
from app.schemas import MCPServerCreate, MCPServerPublic, MCPServerUpdate, MCPTestResult, MCPTestRequest
from app.services.mcp_service import mcp_service

router = APIRouter()


def _config_identity(config: Optional[dict]) -> str:
    """Stable fingerprint of a server config, ignoring secrets.

    Two configs are 'the same MCP server' when transport + command/args (or
    URL) match — env/token values may legitimately change between attempts.
    """
    cfg = config or {}
    transport = cfg.get("transport") or ("stdio" if cfg.get("command") else "sse")
    if transport == "stdio":
        args = " ".join(str(a) for a in (cfg.get("args") or [])).strip().lower()
        return f"stdio|{(cfg.get('command') or '').strip().lower()}|{args}"
    return f"{transport}|{(cfg.get('url') or '').strip().lower()}"


def _find_duplicate(db: Session, owner_id: int, config: dict, exclude_id: Optional[int] = None):
    identity = _config_identity(config)
    for server in db.query(MCPServer).filter(MCPServer.owner_id == owner_id).all():
        if exclude_id is not None and server.id == exclude_id:
            continue
        if _config_identity(server.config) == identity:
            return server
    return None


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
    # One connection per unique server config: block repeated servers
    duplicate = _find_duplicate(db, current_user.id, payload.config)
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"This MCP server is already connected as “{duplicate.name}” "
                    f"(#{duplicate.id}) — edit that connection instead."),
        )

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
        logo_slug=payload.logo_slug,
        category=payload.category,
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
        duplicate = _find_duplicate(db, current_user.id, update_data["config"], exclude_id=server.id)
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"Another connection (#{duplicate.id} “{duplicate.name}”) "
                        "already uses this exact server config."),
            )
        validation = await mcp_service.validate_config([update_data["config"]])
        if not validation or not validation[0].get("valid", False):
            err = validation[0].get("error") if validation else "Invalid config"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"MCP config validation failed: {err}",
            )
        # A changed config invalidates any previously recorded health status
        server.last_status = None
        server.last_checked_at = None

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


@router.post("/test", response_model=MCPTestResult)
async def test_unsaved_mcp_config(
    payload: MCPTestRequest,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Live-test an UNSAVED config from the connect dialog.

    Registry flow: configure token/secrets → Test → on success enable Connect
    (which then persists the server). Nothing is stored here.
    """
    result = await mcp_service.health_check([payload.config], timeout=20.0)
    return MCPTestResult(
        server_id=0,
        healthy=bool(result.get("healthy")),
        tool_count=int(result.get("tool_count") or 0),
        tools=result.get("tools", []) or [],
        error=result.get("error"),
        checked_at=datetime.utcnow(),
    )


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


@router.post("/{server_id}/test", response_model=MCPTestResult)
async def test_mcp_server_connection(
    server_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Live connection test: actually connect to the MCP server and list its tools.

    Persists the result on the connection so the registry UI can show status.
    """
    server = (
        db.query(MCPServer)
        .filter(MCPServer.id == server_id, MCPServer.owner_id == current_user.id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    result = await mcp_service.health_check([server.config], timeout=20.0)
    checked_at = datetime.utcnow()
    server.last_status = "healthy" if result.get("healthy") else "unreachable"
    server.last_checked_at = checked_at
    db.commit()

    return MCPTestResult(
        server_id=server_id,
        healthy=bool(result.get("healthy")),
        tool_count=int(result.get("tool_count") or 0),
        tools=result.get("tools", []) or [],
        error=result.get("error"),
        checked_at=checked_at,
    )


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
