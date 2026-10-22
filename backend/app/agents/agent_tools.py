"""
Agent-as-Tool: allow agents to invoke other agents as tools.

Supports nesting with a hard depth limit to prevent infinite recursion.
Nested runs are isolated (own thread) and return only the final output
to the parent, while still being observable via the parent tool call/result events.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List

from langchain_core.tools import StructuredTool

logger = logging.getLogger(__name__)

MAX_NESTING_DEPTH = 3


def build_nested_agent_tools(
    nested_agents: List[Dict[str, Any]],
    current_depth: int = 0,
) -> List[StructuredTool]:
    """
    Turn a list of pre-resolved agent configs into LangChain tools.
    Each tool runs the target agent to completion and returns its final answer.
    """
    tools: List[StructuredTool] = []
    if current_depth >= MAX_NESTING_DEPTH:
        logger.warning("Max nesting depth reached; no nested agent tools created")
        return tools

    for cfg in nested_agents:
        agent_id = cfg.get("id")
        name = (cfg.get("name") or f"agent_{agent_id}").replace(" ", "_").lower()
        # Sanitize tool name (must be valid identifier-ish)
        tool_name = f"call_agent_{name}"[:60]
        description = (
            f"Invoke the specialized agent '{cfg.get('name', 'unnamed')}' "
            f"(id={agent_id}). Use this when the task matches: {cfg.get('description') or cfg.get('system_prompt', '')[:200]}"
        )

        # Capture config for the closure
        sub_config = dict(cfg)
        # Prevent the sub-agent from calling back into the same tool set infinitely
        sub_config["_depth"] = current_depth + 1
        # Optionally strip nested agents from sub to further limit fan-out
        # (user can re-enable by having them in their own advanced_config)

        async def _invoke(query: str, _cfg=sub_config) -> str:
            from app.agents.runtime import run_agent  # late import to avoid cycles

            if _cfg.get("_depth", 0) > MAX_NESTING_DEPTH:
                return "Error: maximum agent nesting depth exceeded."

            try:
                # Isolated thread so conversation memory of the sub-agent does not leak
                thread_id = f"nested-{_cfg.get('id')}-{uuid.uuid4().hex[:8]}"
                result = await run_agent(
                    _cfg,
                    query,
                    thread_id=thread_id,
                )
                output = result.get("output") or ""
                conf = result.get("confidence")
                suffix = f"\n\n[confidence={conf:.2f}]" if conf is not None else ""
                return (output or "(no output)") + suffix
            except Exception as e:
                logger.exception("Nested agent invocation failed")
                return f"Error invoking nested agent: {e}"

        tool = StructuredTool.from_function(
            coroutine=_invoke,
            name=tool_name,
            description=description,
        )
        tools.append(tool)
        logger.info("Registered nested agent tool: %s -> agent %s", tool_name, agent_id)

    return tools
