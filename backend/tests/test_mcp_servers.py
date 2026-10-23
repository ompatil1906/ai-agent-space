"""MCP Server Registry tests: CRUD isolation, live connection test, run-time expansion."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import MCPServer
from app.services.mcp_service import mcp_service


def _register(client: TestClient, email: str) -> dict:
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "testpass123", "full_name": email.split("@")[0]},
    )
    if resp.status_code not in (200, 201):
        assert "already" in str(resp.json().get("detail", "")).lower(), resp.text
    login = client.post("/api/v1/auth/login", data={"username": email, "password": "testpass123"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


_STDIO_CONFIG = {
    "name": "filesystem",
    "transport": "stdio",
    "command": "python",
    "args": ["-c", "print('placeholder')"],
}


def test_create_list_and_isolation(client: TestClient, db: Session):
    headers = _register(client, "mcp_owner@example.com")
    created = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={
            "name": "Filesystem",
            "description": "Local file access",
            "config": _STDIO_CONFIG,
            "logo_slug": "filesystem",
            "category": "dev-tools",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["config"]["transport"] == "stdio"
    assert body["last_status"] is None

    # Another user sees nothing (owner isolation)
    other = _register(client, "mcp_intruder@example.com")
    listing = client.get("/api/v1/mcp-servers/", headers=other).json()
    assert all(s["id"] != body["id"] for s in listing)

    listing = client.get("/api/v1/mcp-servers/", headers=headers).json()
    assert any(s["id"] == body["id"] for s in listing)


def test_create_rejects_invalid_config(client: TestClient):
    headers = _register(client, "mcp_bad@example.com")
    resp = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={"name": "broken", "config": {"transport": "stdio"}, "is_public": False},
    )
    assert resp.status_code == 400
    assert "validation failed" in resp.json()["detail"].lower()


def test_live_connection_test_unreachable_persists_status(client: TestClient, db: Session):
    headers = _register(client, "mcp_tester@example.com")
    dead = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={
            "name": "dead server",
            "config": {"name": "dead", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": []},
        },
    )
    assert dead.status_code == 201, dead.text
    server_id = dead.json()["id"]

    test = client.post(f"/api/v1/mcp-servers/{server_id}/test", headers=headers)
    assert test.status_code == 200, test.text
    body = test.json()
    assert body["healthy"] is False
    assert body["tool_count"] == 0
    assert body["server_id"] == server_id
    assert body["checked_at"]

    # Status persisted and returned by the listing
    listing = client.get("/api/v1/mcp-servers/", headers=headers).json()
    entry = next(s for s in listing if s["id"] == server_id)
    assert entry["last_status"] == "unreachable"
    assert entry["last_checked_at"] is not None


def test_adhoc_test_endpoint_does_not_persist(client: TestClient, db: Session):
    """POST /mcp-servers/test tests an UNSAVED config without storing anything."""
    headers = _register(client, "mcp_adhoc@example.com")
    before = client.get("/api/v1/mcp-servers/", headers=headers).json()
    assert before == []

    test = client.post(
        "/api/v1/mcp-servers/test",
        headers=headers,
        json={"config": {"name": "adhoc", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": []}},
    )
    assert test.status_code == 200, test.text
    body = test.json()
    assert body["healthy"] is False
    assert body["server_id"] == 0

    # Nothing was persisted by the ad-hoc test
    after = client.get("/api/v1/mcp-servers/", headers=headers).json()
    assert after == []


def test_duplicate_registration_blocked(client: TestClient, db: Session):
    """Same server config twice → 409, regardless of the name used."""
    import json as jsonlib

    headers = _register(client, "mcp_dup@example.com")
    first = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={
            "name": "first",
            "config": {"name": "dup", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": ["x"]},
        },
    )
    assert first.status_code == 201, first.text

    # Different name, same command/args → duplicate
    again = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={
            "name": "second",
            "config": {"name": "dup", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": ["x"]},
        },
    )
    assert again.status_code == 409, again.text
    assert "already connected" in again.json()["detail"].lower()

    # Different config (different arg) is allowed
    other = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={
            "name": "other",
            "config": {"name": "dup", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": ["y"]},
        },
    )
    assert other.status_code == 201, other.text

    # Editing one connection to duplicate the other's config → 409
    other_id = other.json()["id"]
    edit = client.put(
        f"/api/v1/mcp-servers/{other_id}",
        headers=headers,
        json={"config": {"name": "dup", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": ["x"]}},
    )
    assert edit.status_code == 409, edit.text
    assert "another connection" in edit.json()["detail"].lower()

    # Different user is unaffected by someone else's connections
    other_user = _register(client, "mcp_dup2@example.com")
    free = client.post(
        "/api/v1/mcp-servers/",
        headers=other_user,
        json={
            "name": "mine",
            "config": {"name": "dup", "transport": "stdio", "command": "/nonexistent-mcp-binary-xyz", "args": ["x"]},
        },
    )
    assert free.status_code == 201, free.text


def test_resolve_tools_config_expands_saved_servers(db: Session):
    """server_id references get expanded to the stored config at run time."""
    import asyncio

    from app.models.user import User
    from app.core.security import get_password_hash

    user = User(email="resolver@example.com", hashed_password=get_password_hash("x" + "y" * 7))
    db.add(user)
    db.commit()
    db.refresh(user)

    cfg = {"name": "git-mcp", "transport": "stdio", "command": "python", "args": ["-c", "x"]}
    server = MCPServer(owner_id=user.id, name="git", config=cfg)
    db.add(server)
    db.commit()
    db.refresh(server)

    resolved = asyncio.run(
        mcp_service.resolve_tools_config(
            [{"name": "git", "server_id": server.id}, {"name": "inline", "transport": "sse", "url": "http://x/y"}],
            db,
            user.id,
        )
    )
    assert resolved[0] == cfg  # expanded
    assert resolved[1]["transport"] == "sse"  # inline passthrough

    # A server_id owned by someone else is dropped (isolation)
    resolved2 = asyncio.run(
        mcp_service.resolve_tools_config([{"name": "steal", "server_id": server.id}], db, 999999)
    )
    assert resolved2 == []


def test_update_config_clears_stale_status(client: TestClient):
    headers = _register(client, "mcp_updater@example.com")
    created = client.post(
        "/api/v1/mcp-servers/",
        headers=headers,
        json={"name": "flaky", "config": _STDIO_CONFIG},
    )
    assert created.status_code == 201
    sid = created.json()["id"]

    # Mark it healthy via a live test (will be unreachable here)…
    client.post(f"/api/v1/mcp-servers/{sid}/test", headers=headers)
    listing = client.get("/api/v1/mcp-servers/", headers=headers).json()
    entry = next(s for s in listing if s["id"] == sid)
    assert entry["last_status"] == "unreachable"

    # …then editing the config invalidates the recorded status
    updated = client.put(
        f"/api/v1/mcp-servers/{sid}",
        headers=headers,
        json={"config": {"name": "fixed", "transport": "sse", "url": "http://localhost:9999/mcp"}},
    )
    assert updated.status_code == 200, updated.text
    entry = updated.json()
    assert entry["last_status"] is None
    assert entry["last_checked_at"] is None
