"""
Advanced LangGraph-based agent runtime with streaming, memory, MCP tools,
and multi-agent orchestration (single / sequential / supervisor).
"""
from typing import Any, AsyncGenerator, Dict, List, Optional, TypedDict, Annotated
import operator
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import Command

from app.core.config import settings
from app.services.mcp_service import mcp_service


class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]


# In-memory checkpointer for conversation memory (thread-based)
# Production: switch to PostgresSaver or Redis
checkpointer = MemorySaver()


def get_llm(model_name: str, temperature: float) -> ChatOpenAI:
    return ChatOpenAI(
        model=model_name,
        temperature=temperature,
        api_key=settings.OPENAI_API_KEY or None,
        streaming=True,
    )


def _should_continue(state: AgentState) -> str:
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
        return "tools"
    return END


def build_single_agent_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """Build a standard ReAct-style agent with optional tools."""
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    system_prompt = agent_config.get("system_prompt", "You are a helpful AI assistant.")

    llm = get_llm(model_name, temperature)
    if tools:
        llm = llm.bind_tools(tools)

    def call_model(state: AgentState):
        messages = [SystemMessage(content=system_prompt)] + state["messages"]
        response = llm.invoke(messages)
        return {"messages": [response]}

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", call_model)
    workflow.set_entry_point("agent")

    if tools:
        tool_node = ToolNode(tools)
        workflow.add_node("tools", tool_node)
        workflow.add_conditional_edges("agent", _should_continue, {"tools": "tools", END: END})
        workflow.add_edge("tools", "agent")
    else:
        workflow.add_edge("agent", END)

    return workflow.compile(checkpointer=checkpointer)


def build_sequential_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Sequential multi-agent: sub-agents run in order, each seeing previous output.
    workflow_config example:
    {
      "type": "sequential",
      "sub_agents": [
        {"name": "researcher", "system_prompt": "Research the topic thoroughly."},
        {"name": "writer", "system_prompt": "Write a clear summary based on research."}
      ]
    }
    """
    wf = agent_config.get("workflow_config") or {}
    sub_agents = wf.get("sub_agents") or []
    if not sub_agents:
        return build_single_agent_graph(agent_config, tools)

    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    llm = get_llm(model_name, temperature)
    if tools:
        llm = llm.bind_tools(tools)

    workflow = StateGraph(AgentState)

    def make_agent_node(prompt: str, name: str):
        def node(state: AgentState):
            messages = [SystemMessage(content=prompt)] + state["messages"]
            response = llm.invoke(messages)
            # Tag the response with the agent name for clarity
            response.additional_kwargs = response.additional_kwargs or {}
            response.additional_kwargs["agent"] = name
            return {"messages": [response]}
        return node

    prev = None
    for i, sa in enumerate(sub_agents):
        node_name = sa.get("name", f"agent_{i}")
        prompt = sa.get("system_prompt", "You are a helpful specialist.")
        workflow.add_node(node_name, make_agent_node(prompt, node_name))
        if prev is None:
            workflow.set_entry_point(node_name)
        else:
            workflow.add_edge(prev, node_name)
        prev = node_name

    if tools:
        # Attach tools after the last agent (simple version)
        tool_node = ToolNode(tools)
        workflow.add_node("tools", tool_node)
        workflow.add_conditional_edges(prev, _should_continue, {"tools": "tools", END: END})
        workflow.add_edge("tools", prev)
    else:
        workflow.add_edge(prev, END)

    return workflow.compile(checkpointer=checkpointer)


def build_supervisor_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Supervisor multi-agent: a supervisor routes to specialized workers.
    workflow_config example:
    {
      "type": "supervisor",
      "workers": [
        {"name": "researcher", "description": "Does research", "system_prompt": "..."},
        {"name": "coder", "description": "Writes code", "system_prompt": "..."}
      ]
    }
    """
    wf = agent_config.get("workflow_config") or {}
    workers = wf.get("workers") or wf.get("sub_agents") or []
    if not workers:
        return build_single_agent_graph(agent_config, tools)

    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    base_llm = get_llm(model_name, temperature)

    worker_names = [w.get("name", f"worker_{i}") for i, w in enumerate(workers)]
    worker_desc = "\n".join(
        f"- {w.get('name')}: {w.get('description', 'specialist')}" for w in workers
    )
    supervisor_prompt = (
        agent_config.get("system_prompt", "You are a supervisor.")
        + f"\n\nAvailable workers:\n{worker_desc}\n"
        + "Respond with the name of the next worker to call, or 'FINISH' when done. "
        + "Then provide the task for that worker."
    )

    workflow = StateGraph(AgentState)

    def supervisor_node(state: AgentState):
        messages = [SystemMessage(content=supervisor_prompt)] + state["messages"]
        response = base_llm.invoke(messages)
        content = (response.content or "").strip().lower()
        next_worker = None
        for name in worker_names:
            if name.lower() in content:
                next_worker = name
                break
        if "finish" in content or next_worker is None:
            return {"messages": [response]}
        # Store routing decision in additional_kwargs for the conditional edge
        response.additional_kwargs = response.additional_kwargs or {}
        response.additional_kwargs["next"] = next_worker
        return {"messages": [response]}

    def make_worker(prompt: str, name: str):
        def node(state: AgentState):
            llm = base_llm
            if tools:
                llm = llm.bind_tools(tools)
            messages = [SystemMessage(content=prompt)] + state["messages"]
            response = llm.invoke(messages)
            response.additional_kwargs = response.additional_kwargs or {}
            response.additional_kwargs["agent"] = name
            return {"messages": [response]}
        return node

    workflow.add_node("supervisor", supervisor_node)
    workflow.set_entry_point("supervisor")

    for w in workers:
        name = w.get("name", "worker")
        prompt = w.get("system_prompt", "You are a specialist worker.")
        workflow.add_node(name, make_worker(prompt, name))
        workflow.add_edge(name, "supervisor")

    def route_supervisor(state: AgentState) -> str:
        last = state["messages"][-1]
        next_w = getattr(last, "additional_kwargs", {}).get("next")
        if next_w and next_w in worker_names:
            return next_w
        return END

    workflow.add_conditional_edges("supervisor", route_supervisor, {**{n: n for n in worker_names}, END: END})

    return workflow.compile(checkpointer=checkpointer)


def build_agent_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """Dispatch to the correct graph builder based on workflow_config.type."""
    wf_type = (agent_config.get("workflow_config") or {}).get("type", "single")
    if wf_type == "sequential":
        return build_sequential_graph(agent_config, tools)
    if wf_type == "supervisor":
        return build_supervisor_graph(agent_config, tools)
    return build_single_agent_graph(agent_config, tools)


async def _load_tools(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None) -> Optional[List[Any]]:
    if tools is not None:
        return tools
    tools_config = agent_config.get("tools_config") or []
    if tools_config:
        return await mcp_service.get_tools(tools_config)
    return None


async def run_agent(
    agent_config: Dict[str, Any],
    user_input: str,
    thread_id: Optional[str] = None,
    tools: Optional[List[Any]] = None,
) -> str:
    """Non-streaming agent run (supports multi-agent)."""
    tools = await _load_tools(agent_config, tools)
    graph = build_agent_graph(agent_config, tools)
    config = {"configurable": {"thread_id": thread_id or "default"}}
    initial_state = {"messages": [HumanMessage(content=user_input)]}
    result = await graph.ainvoke(initial_state, config=config)
    last_message = result["messages"][-1]
    return last_message.content if hasattr(last_message, "content") else str(last_message)


async def stream_agent(
    agent_config: Dict[str, Any],
    user_input: str,
    thread_id: Optional[str] = None,
    tools: Optional[List[Any]] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Streaming generator that yields structured events:
    - {"type": "token", "content": "..."}
    - {"type": "tool_call", "name": "...", "args": {...}}
    - {"type": "tool_result", "name": "...", "content": "..."}
    - {"type": "done", "content": full_output}
    - {"type": "error", "content": "..."}
    """
    try:
        tools = await _load_tools(agent_config, tools)
        graph = build_agent_graph(agent_config, tools)
        config = {"configurable": {"thread_id": thread_id or f"run-{hash(user_input)}"}}
        initial_state = {"messages": [HumanMessage(content=user_input)]}

        full_output = ""
        async for event in graph.astream_events(initial_state, config=config, version="v2"):
            kind = event.get("event")
            name = event.get("name", "")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    token = chunk.content
                    full_output += token
                    yield {"type": "token", "content": token}

            elif kind == "on_tool_start":
                yield {
                    "type": "tool_call",
                    "name": event.get("name", "tool"),
                    "args": event.get("data", {}).get("input", {}),
                }

            elif kind == "on_tool_end":
                output = event.get("data", {}).get("output", "")
                yield {
                    "type": "tool_result",
                    "name": event.get("name", "tool"),
                    "content": str(output)[:2000],  # truncate for safety
                }

            elif kind == "on_chain_end" and name in ("agent", "supervisor"):
                output = event.get("data", {}).get("output", {})
                messages = output.get("messages", [])
                if messages:
                    last = messages[-1]
                    content = getattr(last, "content", "") or ""
                    if content and content not in full_output:
                        full_output = content

        yield {"type": "done", "content": full_output}

    except Exception as e:
        yield {"type": "error", "content": str(e)}


def serialize_messages(messages: List[BaseMessage]) -> List[Dict[str, Any]]:
    result = []
    for msg in messages:
        result.append({
            "type": msg.__class__.__name__,
            "content": msg.content,
            "additional_kwargs": getattr(msg, "additional_kwargs", {}),
        })
    return result
