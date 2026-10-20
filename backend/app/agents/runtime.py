"""
Advanced LangGraph-based agent runtime with streaming, memory, MCP tools,
and multi-agent orchestration (single / sequential / supervisor).

Memory: Uses MemorySaver by default. Switches to PostgresSaver when
DATABASE_URL is PostgreSQL and the package is installed (production-ready).
"""
from typing import Any, AsyncGenerator, Dict, List, Optional, TypedDict, Annotated
import operator
import logging

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from app.core.config import settings
from app.services.mcp_service import mcp_service

logger = logging.getLogger(__name__)

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]


def get_checkpointer():
    """Return the appropriate checkpointer. Postgres for production DB, else MemorySaver."""
    db_url = settings.DATABASE_URL or ""
    if db_url.startswith("postgresql") or db_url.startswith("postgres"):
        try:
            from langgraph.checkpoint.postgres import PostgresSaver
            # Note: PostgresSaver.from_conn_string creates a context-managed saver.
            # For long-lived use, prefer a pool. This is the simple production path.
            return PostgresSaver.from_conn_string(db_url)
        except ImportError:
            logger.warning("langgraph-checkpoint-postgres not installed; falling back to MemorySaver")
        except Exception as e:
            logger.warning(f"PostgresSaver init failed ({e}); falling back to MemorySaver")
    return MemorySaver()


# Global checkpointer instance (created once)
checkpointer = get_checkpointer()


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
        tool_node = ToolNode(tools)
        workflow.add_node("tools", tool_node)
        workflow.add_conditional_edges(prev, _should_continue, {"tools": "tools", END: END})
        workflow.add_edge("tools", prev)
    else:
        workflow.add_edge(prev, END)

    return workflow.compile(checkpointer=checkpointer)


def build_supervisor_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Supervisor multi-agent with structured routing for reliability.
    Uses a clear decision format and fallback matching.
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
        agent_config.get("system_prompt", "You are a supervisor coordinating specialist workers.")
        + f"\n\nAvailable workers:\n{worker_desc}\n"
        + "Decide the next step. You MUST reply with EXACTLY one of the following on its own line:\n"
        + "\n".join(f"WORKER: {name}" for name in worker_names)
        + "\nFINISH\n"
        + "Do not add any other text."
    )

    workflow = StateGraph(AgentState)

    def supervisor_node(state: AgentState):
        messages = [SystemMessage(content=supervisor_prompt)] + state["messages"]
        response = base_llm.invoke(messages)
        content = (response.content or "").strip().upper()
        next_worker = None
        for name in worker_names:
            if f"WORKER: {name.upper()}" in content or name.upper() in content:
                next_worker = name
                break
        if "FINISH" in content or next_worker is None:
            # Final answer from supervisor
            return {"messages": [response]}
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

    workflow.add_conditional_edges(
        "supervisor", route_supervisor, {**{n: n for n in worker_names}, END: END}
    )

    return workflow.compile(checkpointer=checkpointer)


def build_parallel_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Parallel multi-agent: all sub-agents run (concurrently where possible), then a synthesizer combines outputs.
    Advanced pattern for independent specialist analysis.
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

    async def parallel_node(state: AgentState):
        """Run all sub-agents concurrently using asyncio."""
        import asyncio
        results = []

        async def run_one(sa: Dict[str, Any]):
            name = sa.get("name", "specialist")
            prompt = sa.get("system_prompt", "You are a specialist.")
            messages = [SystemMessage(content=prompt)] + state["messages"]
            try:
                response = await llm.ainvoke(messages)
                response.additional_kwargs = response.additional_kwargs or {}
                response.additional_kwargs["agent"] = name
                return response
            except Exception as e:
                logger.warning(f"Parallel worker {name} failed: {e}")
                err_msg = AIMessage(content=f"Error in {name}: {str(e)}")
                err_msg.additional_kwargs = {"agent": name}
                return err_msg

        tasks = [run_one(sa) for sa in sub_agents]
        results = await asyncio.gather(*tasks, return_exceptions=False)
        return {"messages": results}

    def synthesizer_node(state: AgentState):
        """Combine all specialist outputs into a final answer."""
        specialist_outputs = [
            f"[{getattr(m, 'additional_kwargs', {}).get('agent', 'specialist')}]: {m.content}"
            for m in state["messages"]
            if isinstance(m, AIMessage) and getattr(m, "additional_kwargs", {}).get("agent")
        ]
        synth_prompt = (
            "You are a synthesizer. Combine the following specialist analyses into a coherent, "
            "complete final answer for the user. Be concise and accurate.\n\n"
            + "\n\n".join(specialist_outputs)
        )
        messages = [SystemMessage(content=synth_prompt)] + [
            m for m in state["messages"] if not getattr(m, "additional_kwargs", {}).get("agent")
        ]
        response = llm.invoke(messages)
        response.additional_kwargs = response.additional_kwargs or {}
        response.additional_kwargs["agent"] = "synthesizer"
        return {"messages": [response]}

    workflow.add_node("parallel", parallel_node)
    workflow.add_node("synthesizer", synthesizer_node)
    workflow.set_entry_point("parallel")
    workflow.add_edge("parallel", "synthesizer")
    workflow.add_edge("synthesizer", END)

    return workflow.compile(checkpointer=checkpointer)


def build_debate_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Debate multi-agent: Pro and Con specialists argue, then a Judge synthesizes a balanced conclusion.
    Classic advanced pattern for critical analysis.
    """
    wf = agent_config.get("workflow_config") or {}
    # Expect at least pro/con; fall back to defaults if not provided
    sub_agents = wf.get("sub_agents") or [
        {"name": "pro", "system_prompt": "You are the PRO side. Argue strongly in favor of the user's position or topic. Use evidence and logic."},
        {"name": "con", "system_prompt": "You are the CON side. Argue strongly against the user's position or topic. Challenge assumptions and point out risks."},
    ]
    if len(sub_agents) < 2:
        sub_agents = sub_agents + [
            {"name": "con", "system_prompt": "You are the CON side. Argue strongly against."}
        ]

    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    llm = get_llm(model_name, temperature)

    workflow = StateGraph(AgentState)

    def make_debater(prompt: str, name: str):
        def node(state: AgentState):
            messages = [SystemMessage(content=prompt)] + state["messages"]
            response = llm.invoke(messages)
            response.additional_kwargs = response.additional_kwargs or {}
            response.additional_kwargs["agent"] = name
            return {"messages": [response]}
        return node

    # Add pro and con (first two)
    pro = sub_agents[0]
    con = sub_agents[1]
    workflow.add_node("pro", make_debater(pro.get("system_prompt", ""), pro.get("name", "pro")))
    workflow.add_node("con", make_debater(con.get("system_prompt", ""), con.get("name", "con")))

    def judge_node(state: AgentState):
        pro_out = next((m.content for m in state["messages"] if getattr(m, "additional_kwargs", {}).get("agent") == "pro"), "")
        con_out = next((m.content for m in state["messages"] if getattr(m, "additional_kwargs", {}).get("agent") == "con"), "")
        judge_prompt = (
            "You are an impartial Judge. Review the PRO and CON arguments below. "
            "Provide a balanced, nuanced conclusion that synthesizes both sides, notes strengths/weaknesses, "
            "and gives a clear recommendation or final answer.\n\n"
            f"PRO:\n{pro_out}\n\nCON:\n{con_out}"
        )
        messages = [SystemMessage(content=judge_prompt)] + [
            m for m in state["messages"] if not getattr(m, "additional_kwargs", {}).get("agent")
        ]
        response = llm.invoke(messages)
        response.additional_kwargs = response.additional_kwargs or {}
        response.additional_kwargs["agent"] = "judge"
        return {"messages": [response]}

    workflow.add_node("judge", judge_node)
    workflow.set_entry_point("pro")
    workflow.add_edge("pro", "con")
    workflow.add_edge("con", "judge")
    workflow.add_edge("judge", END)

    return workflow.compile(checkpointer=checkpointer)


def build_agent_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """Dispatch to the correct graph builder based on workflow_config.type."""
    wf_type = (agent_config.get("workflow_config") or {}).get("type", "single")
    if wf_type == "sequential":
        return build_sequential_graph(agent_config, tools)
    if wf_type == "supervisor":
        return build_supervisor_graph(agent_config, tools)
    if wf_type == "parallel":
        return build_parallel_graph(agent_config, tools)
    if wf_type == "debate":
        return build_debate_graph(agent_config, tools)
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
                    "content": str(output)[:2000],
                }

            elif kind == "on_chain_end":
                output = event.get("data", {}).get("output", {})
                messages = output.get("messages", []) if isinstance(output, dict) else []
                if messages:
                    last = messages[-1]
                    content = getattr(last, "content", "") or ""
                    agent_name = getattr(last, "additional_kwargs", {}).get("agent") or name or "agent"
                    if content and content not in full_output:
                        full_output = content
                    # Emit structured agent step for multi-agent visibility
                    if agent_name and content:
                        yield {
                            "type": "agent_step",
                            "agent": agent_name,
                            "content": content[:1000],
                        }

        yield {"type": "done", "content": full_output}

    except Exception as e:
        yield {"type": "error", "content": str(e)}


async def evaluate_output(
    agent_config: Dict[str, Any],
    user_input: str,
    agent_output: str,
    criteria: str = "helpfulness, accuracy, and clarity",
) -> Dict[str, Any]:
    """Simple LLM-as-judge evaluation harness."""
    judge_prompt = (
        "You are an expert evaluator of AI agent responses. "
        f"Score the following response on a scale of 1-10 for: {criteria}. "
        "Provide a short explanation and an overall score.\n\n"
        f"User input: {user_input}\n\n"
        f"Agent output: {agent_output}\n\n"
        "Reply in JSON: {\"score\": number, \"explanation\": \"string\", \"criteria_scores\": {}}"
    )
    llm = get_llm("gpt-4o-mini", 0.0)
    response = llm.invoke([HumanMessage(content=judge_prompt)])
    content = response.content or "{}"
    try:
        import json
        # Extract JSON if wrapped
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(content[start:end])
            return parsed
    except Exception:
        pass
    return {"score": 5, "explanation": content, "raw": content}


def serialize_messages(messages: List[BaseMessage]) -> List[Dict[str, Any]]:
    result = []
    for msg in messages:
        result.append({
            "type": msg.__class__.__name__,
            "content": msg.content,
            "additional_kwargs": getattr(msg, "additional_kwargs", {}),
        })
    return result
