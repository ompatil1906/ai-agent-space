"""Devin-style direct automation: background task lifecycle tests.

`run_agent` is monkeypatched so no real LLM/network is involved.
"""
import asyncio
import time

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.v1.runs as runs_mod
from app.models.user import User, Agent


def _register(client: TestClient, email: str) -> dict:
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "testpass123", "full_name": email.split("@")[0]},
    )
    login = client.post("/api/v1/auth/login", data={"username": email, "password": "testpass123"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_automation_task_runs_unattended_and_completes(client: TestClient, db: Session, monkeypatch):
    headers = _register(client, "auto_complete@example.com")
    db.query(User).filter(User.email == "auto_complete@example.com").update({"credits": 100})
    db.commit()
    user = db.query(User).filter(User.email == "auto_complete@example.com").first()
    agent = Agent(
        owner_id=user.id,
        name="auto agent",
        description="",
        system_prompt="You are a meticulous test agent.",
        model_name="gemini-2.5-flash",
        sandbox_enabled=False,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    captured = {}

    async def fake_run_agent(agent_config, user_input, thread_id=None, tools=None):
        captured["prompt"] = agent_config.get("system_prompt", "")
        captured["thread"] = thread_id
        captured["autonomy"] = agent_config.get("autonomy_level")
        assert "DIRECT AUTOMATION" in captured["prompt"]
        assert "DELIVERABLE" in captured["prompt"]
        assert captured["autonomy"] == "autonomous"
        return {
            "output": "OUTCOME: done\nREPORT complete",
            "usage": {"input_tokens": 11, "output_tokens": 7, "total_tokens": 18,
                      "estimated_cost_usd": 0.0002},
        }

    monkeypatch.setattr(runs_mod, "run_agent", fake_run_agent)

    created = client.post(
        f"/api/v1/agents/{agent.id}/tasks",
        headers=headers,
        json={"title": "Dependency audit", "input": "Audit the repo and report risks."},
    )
    assert created.status_code == 202, created.text
    task = created.json()
    assert task["mode"] == "automation"
    assert task["title"] == "Dependency audit"
    assert task["status"] == "running"
    assert task["thread_id"]

    # Background executor finishes on the portal loop — poll the task endpoint
    run_id = task["id"]
    for _ in range(120):
        got = client.get(f"/api/v1/agents/{agent.id}/tasks/{run_id}", headers=headers)
        assert got.status_code == 200
        if got.json()["status"] == "completed":
            break
        time.sleep(0.05)
    final = got.json()
    assert final["status"] == "completed"
    assert final["output"].startswith("OUTCOME: done")
    assert final["total_tokens"] == 18

    # Listing shows it, and chat threads are untouched by mode filtering
    listing = client.get(f"/api/v1/agents/{agent.id}/tasks", headers=headers).json()
    assert [t["id"] for t in listing] == [run_id]
    assert all(t["mode"] == "automation" for t in listing)


def test_automation_task_cancel_keeps_cancelled_status(client: TestClient, db: Session, monkeypatch):
    headers = _register(client, "auto_cancel@example.com")
    db.query(User).filter(User.email == "auto_cancel@example.com").update({"credits": 100})
    db.commit()
    user = db.query(User).filter(User.email == "auto_cancel@example.com").first()
    agent = Agent(
        owner_id=user.id,
        name="auto cancel agent",
        description="",
        system_prompt="x",
        model_name="gemini-2.5-flash",
        sandbox_enabled=False,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    async def slow_fake_run_agent(agent_config, user_input, thread_id=None, tools=None):
        await asyncio.sleep(0.5)  # long enough for the cancel to land mid-run
        return {"output": "should not be recorded as completed", "usage": {}}

    monkeypatch.setattr(runs_mod, "run_agent", slow_fake_run_agent)

    created = client.post(
        f"/api/v1/agents/{agent.id}/tasks",
        headers=headers,
        json={"title": "Long task", "input": "step by step"},
    )
    assert created.status_code == 202
    run_id = created.json()["id"]

    cancel = client.post(f"/api/v1/agents/{agent.id}/tasks/{run_id}/cancel", headers=headers)
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    # Even after the executor returns, the cancel status is preserved
    done = client.get(f"/api/v1/agents/{agent.id}/tasks/{run_id}", headers=headers)
    for _ in range(30):
        if done.json()["status"] != "running":
            break
        time.sleep(0.05)
        done = client.get(f"/api/v1/agents/{agent.id}/tasks/{run_id}", headers=headers)
    assert done.json()["status"] == "cancelled"

    # Cannot create tasks for someone else's agent
    other = _register(client, "auto_other@example.com")
    resp = client.post(
        f"/api/v1/agents/{agent.id}/tasks",
        headers=other,
        json={"title": "nope", "input": "nope"},
    )
    assert resp.status_code == 403
