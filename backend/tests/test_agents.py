def test_create_and_list_agents(client, auth_headers):
    payload = {
        "name": "Test Agent",
        "description": "A test agent",
        "system_prompt": "You are a test assistant.",
        "model_name": "gpt-4o-mini",
        "temperature": 0.5,
        "tools_config": [],
        "memory_config": {"enabled": True, "max_messages": 10},
        "workflow_config": {"type": "single"},
    }
    resp = client.post("/api/v1/agents/", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    agent = resp.json()
    assert agent["name"] == "Test Agent"
    assert agent["id"]

    # List
    resp = client.get("/api/v1/agents/", headers=auth_headers)
    assert resp.status_code == 200
    agents = resp.json()
    assert len(agents) == 1
    assert agents[0]["name"] == "Test Agent"


def test_mcp_validate_endpoint(client, auth_headers):
    configs = [
        {"name": "calc", "transport": "stdio", "command": "python", "args": ["examples/example_mcp_server.py"]},
        {"name": "bad", "transport": "stdio"},  # missing command
    ]
    resp = client.post("/api/v1/agents/mcp/validate", json=configs, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert data["results"][0]["valid"] is True
    assert data["results"][1]["valid"] is False
