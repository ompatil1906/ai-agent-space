# Agents

Example agent configurations and marketplace-ready agents.

## Multi-Agent Workflow Example

Set `workflow_config` on an agent:

```json
{
  "type": "supervisor",
  "sub_agents": [
    {"name": "researcher", "system_prompt": "You research topics thoroughly."},
    {"name": "writer", "system_prompt": "You write clear, engaging content."}
  ]
}
```

Supported types: `single` (default), `sequential`, `supervisor`, `parallel`, `debate`, `map_reduce`, `hierarchical`.

All specialist workers are full tool-using ReAct agents (they can call MCP tools, sandbox, and use reflection when configured).

Full orchestration (routing to actual sub-agents) can be extended in `backend/app/agents/runtime.py`.
