"""
Advanced LangGraph-based agent runtime with streaming, memory, and real MCP tool support.
"""
from typing import Any, AsyncGenerator, Dict, List, Optional
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode
from pydantic import BaseModel

from app.core.config import settings
from app.services.mcp_service import mcp_service


class AgentState(BaseModel):
    messages: List[BaseMessage] = []


# In-memory checkpointer for conversation memory (thread-based)
# In production, use Postgres or Redis checkpointer
checkpointer = MemorySaver()


def get_llm(model_name: str, temperature: float) -> ChatOpenAI:
    return ChatOpenAI(
        model=model_name,
        temperature=temperature,
        api_key=settings.OPENAI_API_KEY or None,
        streaming=True,
    )


def build_agent_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Build a LangGraph agent with optional tools (MCP-backed).
    """
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    system_prompt = agent_config.get("system_prompt", "You are a helpful AI assistant.")

    llm = get_llm(model_name, temperature)

    if tools:
        llm = llm.bind_tools(tools)

    def call_model(state: AgentState):
        messages = [SystemMessage(content=system_prompt)] + list(state.messages)
        response = llm.invoke(messages)
        return {"messages": state.messages + [response]}

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", call_model)

    if tools:
        tool_node = ToolNode(tools)
        workflow.add_node("tools", tool_node)
        workflow.add_conditional_edges(
            "agent",
            lambda s: "tools" if getattr(s.messages[-1], "tool_calls", None) else END,
            {"tools": "tools", END: END},
        )
        workflow.add_edge("tools", "agent")
    else:
        workflow.add_edge("agent", END)

    workflow.set_entry_point("agent")

    return workflow.compile(checkpointer=checkpointer)


async def _load_tools(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None) -> Optional[List[Any]]:
    """Load MCP tools from agent config if not already provided."""
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
    """Non-streaming agent run with MCP tool support and memory."""
    tools = await _load_tools(agent_config, tools)
    graph = build_agent_graph(agent_config, tools)
    config = {"configurable": {"thread_id": thread_id or "default"}} if thread_id else {}
    initial_state = AgentState(messages=[HumanMessage(content=user_input)])
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
    Streaming generator that yields events:
    - {"type": "token", "content": "..."}
    - {"type": "done", "content": full_output}
    - {"type": "error", "content": "..."}
    """
    try:
        tools = await _load_tools(agent_config, tools)
        graph = build_agent_graph(agent_config, tools)
        config = {"configurable": {"thread_id": thread_id or f"run-{id(user_input)}"}}
        initial_state = AgentState(messages=[HumanMessage(content=user_input)])

        full_output = ""
        async for event in graph.astream_events(initial_state, config=config, version="v2"):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    token = chunk.content
                    full_output += token
                    yield {"type": "token", "content": token}
            elif kind == "on_chain_end" and event.get("name") == "agent":
                output = event.get("data", {}).get("output", {})
                messages = output.get("messages", [])
                if messages:
                    last = messages[-1]
                    content = getattr(last, "content", str(last))
                    if content and content != full_output:
                        full_output = content

        yield {"type": "done", "content": full_output}
    except Exception as e:
        yield {"type": "error", "content": str(e)}


def serialize_messages(messages: List[BaseMessage]) -> List[Dict[str, Any]]:
    """Helper to persist messages."""
    result = []
    for msg in messages:
        result.append({
            "type": msg.__class__.__name__,
            "content": msg.content,
            "additional_kwargs": getattr(msg, "additional_kwargs", {}),
        })
    return result


# ========== Multi-Agent Support ==========

def build_multi_agent_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Build a multi-agent workflow graph.
    Supports:
    - sequential: run sub-agents in order
    - supervisor: one supervisor routes to workers
    """
    workflow_type = agent_config.get("workflow_config", {}).get("type", "single")
    if workflow_type == "single":
        return build_agent_graph(agent_config, tools)

    # For sequential or supervisor, we build a simple orchestration
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    system_prompt = agent_config.get("system_prompt", "You are a supervisor coordinating agents.")

    llm = get_llm(model_name, temperature)

    def supervisor_node(state: AgentState):
        messages = [SystemMessage(content=system_prompt + "\nDecide the next action or final answer.")] + list(state.messages)
        response = llm.invoke(messages)
        return {"messages": state.messages + [response]}

    workflow = StateGraph(AgentState)
    workflow.add_node("supervisor", supervisor_node)
    workflow.set_entry_point("supervisor")
    workflow.add_edge("supervisor", END)

    # Note: full sub-agent invocation would require recursive graphs or tool-based agents.
    # This provides the foundation; advanced routing can be extended.
    return workflow.compile(checkpointer=checkpointer)


async def run_agent_advanced(
    agent_config: Dict[str, Any],
    user_input: str,
    thread_id: Optional[str] = None,
    tools: Optional[List[Any]] = None,
) -> str:
    """Run agent with multi-agent awareness."""
    tools = await _load_tools(agent_config, tools)
    graph = build_multi_agent_graph(agent_config, tools)
    config = {"configurable": {"thread_id": thread_id or "default"}} if thread_id else {}
    initial_state = AgentState(messages=[HumanMessage(content=user_input)])
    result = await graph.ainvoke(initial_state, config=config)
    last_message = result["messages"][-1]
    return last_message.content if hasattr(last_message, "content") else str(last_message)
