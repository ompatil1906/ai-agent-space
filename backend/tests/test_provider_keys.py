"""Provider key (BYOK) tests: CRUD isolation, masking, and Gemini-default resolution."""
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core import llm_keys

PLATFORM_GEMINI_KEY = settings.GEMINI_API_KEY or "test-platform-gemini-key"


def _register(client: TestClient, email: str) -> dict:
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "testpass123", "full_name": email.split("@")[0]},
    )
    if resp.status_code not in (200, 201):
        assert "already" in str(resp.json().get("detail", "")).lower(), resp.text
    login = client.post("/api/v1/auth/login", data={"username": email, "password": "testpass123"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_provider_key_crud_masking_and_isolation(client: TestClient):
    headers = _register(client, "byok_owner@example.com")
    created = client.post(
        "/api/v1/provider-keys/",
        headers=headers,
        json={"provider": "openai", "api_key": "sk-my-very-secret-openai-key-123"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["provider"] == "openai"
    assert "sk-my-very-secret-openai-key-123" not in body["api_key_masked"]
    assert body["api_key_masked"].startswith("sk-my-") and body["api_key_masked"].endswith("-123")

    # Another user sees nothing
    other = _register(client, "byok_other@example.com")
    listing = client.get("/api/v1/provider-keys/", headers=other).json()
    assert listing == []

    # Same provider re-add replaces (one key per provider)
    client.post(
        "/api/v1/provider-keys/",
        headers=headers,
        json={"provider": "openai", "api_key": "sk-replacement-key-abcd-9876"},
    )
    listing = client.get("/api/v1/provider-keys/", headers=headers).json()
    assert len(listing) == 1
    masked = listing[0]["api_key_masked"]
    assert masked.startswith("sk-rep") and masked.endswith("9876")
    assert "sk-replacement-key-abcd-9876" not in masked  # full secret never returned

    # Delete
    deleted = client.delete(f"/api/v1/provider-keys/{listing[0]['id']}", headers=headers)
    assert deleted.status_code == 204
    assert client.get("/api/v1/provider-keys/", headers=headers).json() == []


def test_custom_provider_requires_base_url(client: TestClient):
    headers = _register(client, "byok_custom@example.com")
    bad = client.post(
        "/api/v1/provider-keys/", headers=headers, json={"provider": "custom", "api_key": "sk-1234567890abc"}
    )
    assert bad.status_code == 400


def test_resolve_llm_gemini_default_for_openai_models(monkeypatch):
    """No OpenAI/Anthropic keys configured → everything maps to platform Gemini."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", PLATFORM_GEMINI_KEY)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    r = llm_keys.resolve_llm("gpt-4o-mini")
    assert r == {"provider": "gemini", "api_key": PLATFORM_GEMINI_KEY,
                 "model": llm_keys.GEMINI_FAST, "compat_base_url": llm_keys.GEMINI_BASE_URL}

    r = llm_keys.resolve_llm("gpt-4o")
    assert r["model"] == llm_keys.GEMINI_STRONG

    r = llm_keys.resolve_llm("claude-3-5-sonnet-20241022")
    assert r["provider"] == "gemini"
    assert r["model"] == llm_keys.GEMINI_STRONG

    r = llm_keys.resolve_llm("gemini-2.5-flash")
    assert r["model"] == "gemini-2.5-flash"
    assert r["compat_base_url"] == llm_keys.GEMINI_BASE_URL


def test_resolve_llm_user_key_wins(monkeypatch):
    """A user key (BYOK) overrides everything for that provider."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    r = llm_keys.resolve_llm("gpt-4o-mini", api_key="sk-user-key")
    assert r["provider"] == "openai"
    assert r["api_key"] == "sk-user-key"
    assert r["model"] == "gpt-4o-mini"  # no remap when a real key exists

    r = llm_keys.resolve_llm("claude-3-5-sonnet", api_key="sk-anthropic-user")
    assert r["provider"] == "anthropic"
    assert r["model"] == "claude-3-5-sonnet"


def test_platform_gemini_beats_provider_settings(monkeypatch):
    """Platform directive: the Gemini key runs every model — even when an
    OPENAI/ANTHROPIC key exists in settings (e.g. a stale OS-env key). Only a
    user's own BYOK key may reroute away from the platform default."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-stale-openai-key")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", PLATFORM_GEMINI_KEY)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-stale-anthropic")

    r = llm_keys.resolve_llm("gpt-4o-mini")
    assert r["provider"] == "gemini"
    assert r["api_key"] == PLATFORM_GEMINI_KEY
    assert r["model"] == llm_keys.GEMINI_FAST

    r = llm_keys.resolve_llm("claude-3-5-sonnet")
    assert r["provider"] == "gemini"

    # ...but a user key still wins
    r = llm_keys.resolve_llm("gpt-4o-mini", api_key="sk-user-openai")
    assert r["provider"] == "openai"


def test_resolve_embeddings_gemini_default(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", PLATFORM_GEMINI_KEY)
    r = llm_keys.resolve_embeddings()
    assert r["model"] == llm_keys.GEMINI_EMBEDDING
    assert r["api_key"] == PLATFORM_GEMINI_KEY
    assert r["base_url"] == llm_keys.GEMINI_BASE_URL

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-openai")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    r = llm_keys.resolve_embeddings()
    assert r["model"] == "text-embedding-3-small"


def test_build_agent_config_injects_user_key(client: TestClient, db: Session):
    import asyncio
    import json as jsonlib

    from app.api.v1.runs import _build_agent_config
    from app.models.user import User, Agent
    from app.core.security import get_password_hash

    headers = _register(client, "byok_run@example.com")
    client.post(
        "/api/v1/provider-keys/",
        headers=headers,
        json={"provider": "gemini", "api_key": "AQ.user-gemini-key-123456"},
    )

    # Find the user + create an agent directly (avoids agent API surface)
    emails = [u for u in db.query(User).all() if u.email == "byok_run@example.com"]
    assert emails
    user = emails[0]
    agent = Agent(
        owner_id=user.id,
        name="fixture",
        description="",
        system_prompt="p",
        model_name="gemini-2.5-flash",
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    cfg = _build_agent_config(agent, user, db)
    assert cfg["_llm_api_key"] == "AQ.user-gemini-key-123456"
