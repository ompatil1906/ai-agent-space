"""
Advanced LangGraph-based agent runtime with streaming, memory, MCP tools,
sandboxed execution tools, long-horizon planning, Reflexion-style
self-correction with confidence estimation, and multi-agent orchestration
(single / sequential / supervisor / parallel / debate / map_reduce).

Memory: Uses MemorySaver by default. Switches to PostgresSaver when
DATABASE_URL is PostgreSQL and the package is installed (production-ready).
"""
from typing import Any, AsyncGenerator, Dict, List, Optional, TypedDict, Annotated
import operator
import json
import logging
import time
import asyncio

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import Send
from langgraph.prebuilt import ToolNode

from app.services.approval_service import (
    create_approval_request,
    wait_for_approval_db,
    resolve_approval_in_db,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Human-in-the-Loop tool approval (persistent, multi-process safe)
# ---------------------------------------------------------------------------
# In-memory futures are kept as a fast path for single-process, but the
# source of truth is the database via approval_service.

_approval_futures: Dict[str, asyncio.Future] = {}


def request_tool_approval(
    tool_name: str,
    args: dict,
    thread_id: str,
    user_id: Optional[int] = None,
    agent_id: Optional[int] = None,
) -> str:
    """Create a pending approval (DB + optional future) and return its request_id."""
    request_id = f"{thread_id}:{tool_name}:{int(time.time() * 1000)}"
    # Persist first
    if user_id and agent_id:
        create_approval_request(
            request_id=request_id,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            tool_name=tool_name,
            tool_args=args,
        )
    # Optional in-process future for low-latency single-worker
    try:
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        _approval_futures[request_id] = future
    except RuntimeError:
        pass
    logger.info(f"Approval requested: {request_id} for {tool_name}")
    return request_id


async def wait_for_approval(request_id: str, timeout: float = 300.0) -> bool:
    """Wait for approval. Prefers in-process future, falls back to DB polling."""
    future = _approval_futures.get(request_id)
    if future is not None:
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f"In-process approval timed out: {request_id}")
        finally:
            _approval_futures.pop(request_id, None)
    # Always also check / wait on DB (covers multi-process and restarts)
    return await wait_for_approval_db(request_id, timeout=timeout)


def resolve_approval(request_id: str, approved: bool) -> bool:
    """Resolve a pending approval in DB and any in-process future."""
    db_ok = resolve_approval_in_db(request_id, approved)
    future = _approval_futures.get(request_id)
    if future and not future.done():
        future.set_result(approved)
        _approval_futures.pop(request_id, None)
        return True
    return db_ok

def _needs_approval(agent_config: Dict[str, Any], tool_name: str) -> bool:
    autonomy = (agent_config.get("autonomy_level") or "supervised").lower()
    if autonomy != "supervised":
        return False
    # Optional per-tool override in tools_config
    for tc in agent_config.get("tools_config") or []:
        if tc.get("name") == tool_name and "requires_approval" in tc:
            return bool(tc["requires_approval"])
    return True  # default for supervised

def wrap_tools_for_approval(tools: List[Any], agent_config: Dict[str, Any], thread_id: str) -> List[Any]:
    """Wrap tools so supervised agents pause for user approval before execution."""
    from langchain_core.tools import StructuredTool
    wrapped = []
    for tool in tools:
        if not _needs_approval(agent_config, getattr(tool, "name", "")):
            wrapped.append(tool)
            continue

        original_coroutine = getattr(tool, "coroutine", None)
        original_func = getattr(tool, "func", None)
        tool_name = tool.name

        async def make_approved_run(name=tool_name, orig_coro=original_coroutine, orig_func=original_func):
            async def approved_run(**kwargs):
                request_id = request_tool_approval(
                    name, kwargs, thread_id,
                    user_id=agent_config.get("user_id"),
                    agent_id=agent_config.get("id"),
                )
                # Attach to the tool instance that will be in the list
                # We set it on a shared holder that the stream loop can see
                if not hasattr(wrap_tools_for_approval, "_pending"):
                    wrap_tools_for_approval._pending = {}
                wrap_tools_for_approval._pending[name] = request_id
                approved = await wait_for_approval(request_id)
                wrap_tools_for_approval._pending.pop(name, None)
                if not approved:
                    return f"Tool call '{name}' was denied by the user."
                if orig_coro:
                    return await orig_coro(**kwargs)
                if orig_func:
                    return orig_func(**kwargs)
                return "Tool execution failed: no callable found."
            return approved_run

        # Build the tool with a stable closure
        async def approved_run(**kwargs):
            request_id = request_tool_approval(
                tool_name, kwargs, thread_id,
                user_id=agent_config.get("user_id"),
                agent_id=agent_config.get("id"),
            )
            if not hasattr(wrap_tools_for_approval, "_pending"):
                wrap_tools_for_approval._pending = {}
            wrap_tools_for_approval._pending[tool_name] = request_id
            approved = await wait_for_approval(request_id)
            wrap_tools_for_approval._pending.pop(tool_name, None)
            if not approved:
                return f"Tool call '{tool_name}' was denied by the user."
            if original_coroutine:
                return await original_coroutine(**kwargs)
            if original_func:
                return original_func(**kwargs)
            return "Tool execution failed: no callable found."

        new_tool = StructuredTool.from_function(
            coroutine=approved_run,
            name=tool.name,
            description=tool.description or "",
            args_schema=getattr(tool, "args_schema", None),
        )
        wrapped.append(new_tool)
    return wrapped



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


def get_llm(model_name: str, temperature: float, base_url: Optional[str] = None) -> ChatOpenAI:
    """Create an OpenAI-compatible chat model. Supports local endpoints via base_url."""
    kwargs = {
        "model": model_name,
        "temperature": temperature,
        "api_key": settings.OPENAI_API_KEY or "sk-local",  # dummy key for local servers that ignore it
        "streaming": True,
    }
    effective_base = base_url or settings.OPENAI_BASE_URL or None
    if effective_base:
        kwargs["base_url"] = effective_base
    return ChatOpenAI(**kwargs)


def apply_memory_window(messages: List[BaseMessage], memory_config: Dict[str, Any]) -> List[BaseMessage]:
    """Apply simple memory windowing based on memory_config.

    Supported keys:
    - enabled: bool
    - max_messages: int (keep last N messages, default 20)
    - type: "buffer" | "window" (window is default when max_messages set)
    """
    if not memory_config or not memory_config.get("enabled", True):
        return messages
    max_msgs = memory_config.get("max_messages")
    if not max_msgs or not isinstance(max_msgs, int) or max_msgs <= 0:
        return messages
    # Always keep the newest messages
    if len(messages) <= max_msgs:
        return messages
    return messages[-max_msgs:]


def _should_continue(state: AgentState) -> str:
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
        return "tools"
    return "agent_done"


PLANNING_DIRECTIVE = (
    "\n\n# Operating procedure\n"
    "1. PLAN: Before acting, silently outline the full sequence of steps needed to complete the task. "
    "Then state the plan briefly in your first reply under a 'Plan:' line.\n"
    "2. EXECUTE: Work through steps with tools. Prefer the smallest action that yields information.\n"
    "3. OBSERVE: After each tool result, explicitly evaluate: did it succeed? Does the plan change?\n"
    "4. DEBUG: When something fails, read the error carefully, form a hypothesis, and test the fix — "
    "do not simply repeat the same failing action.\n"
    "5. FINISH: Only conclude when every plan step is verifiably done. "
    "If you cannot proceed (missing access, impossible requirement, repeated failure), reply with a "
    "line starting 'NEEDS HELP:' followed by the specific reason, and provide your best partial result."
)


def _base_system_prompt(base_prompt: str, agent_config: Dict[str, Any]) -> str:
    """Compose the effective system prompt: planning directive + autonomy escalation rules."""
    advanced = agent_config.get("advanced_config") or {}
    autonomy = (agent_config.get("autonomy_level") or "supervised").lower()
    prompt = base_prompt

    if advanced.get("planning_enabled") or autonomy in ("semi_autonomous", "autonomous"):
        prompt += PLANNING_DIRECTIVE

    if autonomy == "supervised":
        prompt += (
            "\n\nAutonomy policy: You are operating under supervision. If the task requires actions "
            "you are not explicitly authorized for, or you are below 70% confidence in any destructive "
            "or irreversible action, stop and output 'NEEDS HELP: <reason>' instead of acting."
        )
    return prompt


def _reflection_config(agent_config: Dict[str, Any]) -> Dict[str, Any]:
    advanced = agent_config.get("advanced_config") or {}
    return {
        "enabled": bool(advanced.get("reflection_enabled")),
        "max_rounds": int(advanced.get("max_reflections", 2) or 0),
    }


def get_enhanced_system_prompt(
    base_prompt: str,
    agent_config: Dict[str, Any],
    state: AgentState,
) -> str:
    """Inject relevant long-term memories into the system prompt when enabled."""
    prompt = _base_system_prompt(base_prompt, agent_config)

    mem_cfg = agent_config.get("memory_config") or {}
    if not mem_cfg.get("longterm_enabled"):
        return prompt

    agent_id = agent_config.get("id")
    user_id = agent_config.get("user_id")
    if not agent_id or not user_id:
        return prompt

    # Use the most recent human message as the retrieval query
    query = ""
    for msg in reversed(state.get("messages", [])):
        if isinstance(msg, HumanMessage):
            query = getattr(msg, "content", "") or ""
            break
    if not query:
        return prompt

    try:
        from app.services.memory_service import get_memory_service
        k = int(mem_cfg.get("longterm_k", 5))
        memories = get_memory_service().retrieve(int(agent_id), int(user_id), query, k=k)
        if not memories:
            return prompt
        mem_block = "\n".join(f"- {m}" for m in memories)
        return f"{prompt}\n\nRelevant long-term memories (use if helpful):\n{mem_block}"
    except Exception as e:
        logger.debug("Long-term memory retrieval skipped: %s", e)
        return prompt


def store_interaction_memory(
    agent_config: Dict[str, Any],
    user_input: str,
    agent_output: str,
) -> None:
    """Persist a short interaction summary as long-term memory."""
    mem_cfg = agent_config.get("memory_config") or {}
    if not mem_cfg.get("longterm_enabled"):
        return
    agent_id = agent_config.get("id")
    user_id = agent_config.get("user_id")
    if not agent_id or not user_id or not user_input or not agent_output:
        return
    try:
        from app.services.memory_service import get_memory_service
        text = f"User: {user_input[:800]}\nAssistant: {agent_output[:1500]}"
        svc = get_memory_service()
        if len(text) > 600 and hasattr(svc, "summarize_and_store"):
            svc.summarize_and_store(int(agent_id), int(user_id), text)
        else:
            svc.add_memory(int(agent_id), int(user_id), text, metadata={"source": "interaction"})
    except Exception as e:
        logger.debug("Failed to store long-term memory: %s", e)



def _get_structured_config(agent_config: Dict[str, Any]) -> Dict[str, Any]:
    """Extract structured output settings from advanced_config."""
    adv = agent_config.get("advanced_config") or {}
    return {
        "enabled": bool(adv.get("structured_output_enabled")),
        "schema": adv.get("output_schema"),
        "tool_choice": adv.get("tool_choice", "auto"),
        "max_tool_retries": int(adv.get("max_tool_retries", 1)),
    }


def _make_reliable_tool_node(tools: List[Any], max_retries: int = 1):
    """ToolNode wrapper that catches errors and returns them as ToolMessages so the LLM can recover."""
    base_tool_node = ToolNode(tools)

    def reliable_tools(state: AgentState):
        try:
            result = base_tool_node.invoke(state)
            return result
        except Exception as e:
            logger.warning("Tool execution failed: %s", e)
            # Build error ToolMessages for any pending tool calls
            last = state["messages"][-1] if state.get("messages") else None
            tool_calls = getattr(last, "tool_calls", None) or []
            error_msgs = []
            for tc in tool_calls:
                error_msgs.append(
                    ToolMessage(
                        content=f"Tool error (retryable): {type(e).__name__}: {str(e)[:500]}. Please try a different approach or fix the inputs.",
                        tool_call_id=tc.get("id") or tc.get("tool_call_id") or "unknown",
                    )
                )
            if not error_msgs:
                error_msgs = [AIMessage(content=f"[Tool execution error: {e}]")]
            return {"messages": error_msgs}

    return reliable_tools


def _make_structured_finalizer(agent_config: Dict[str, Any], base_llm):
    """Final node that enforces JSON Schema structured output on the agent's answer."""
    struct_cfg = _get_structured_config(agent_config)
    schema = struct_cfg["schema"]

    def finalize(state: AgentState):
        if not struct_cfg["enabled"] or not schema:
            return {}
        try:
            structured_llm = base_llm.with_structured_output(schema, method="json_schema")
            # Use conversation history for extraction
            messages = state.get("messages", [])
            # Prefer last AI message content as candidate
            last_ai = None
            for m in reversed(messages):
                if isinstance(m, AIMessage) and m.content:
                    last_ai = m.content
                    break
            extract_prompt = (
                "Extract or generate a final answer that strictly conforms to the provided JSON schema. "
                "Use the conversation history. Output ONLY valid structured data."
            )
            if last_ai:
                extract_prompt += f"\n\nPrevious draft answer:\n{last_ai[:4000]}"
            response = structured_llm.invoke(
                [SystemMessage(content=extract_prompt)] + messages[-12:]
            )
            # response is usually a dict when using with_structured_output
            content = json.dumps(response) if isinstance(response, dict) else str(response)
            final_msg = AIMessage(
                content=content,
                additional_kwargs={"structured": True, "schema_enforced": True, "agent": agent_config.get("name", "agent")},
            )
            return {"messages": [final_msg]}
        except Exception as e:
            logger.warning("Structured output finalization failed: %s", e)
            # Fall back gracefully
            fallback = AIMessage(
                content=f"[Structured output failed: {e}. Raw conversation continues.]",
                additional_kwargs={"structured": False, "error": str(e)},
            )
            return {"messages": [fallback]}

    return finalize


def _build_node_call_model(llm, agent_config, fallback_prompt: str, node_label: str):
    """Standard model-calling node used across graph builders."""
    def call_model(state: AgentState):
        mem_cfg = agent_config.get("memory_config") or {}
        history = apply_memory_window(state["messages"], mem_cfg)
        enhanced = get_enhanced_system_prompt(fallback_prompt, agent_config, state)
        messages = [SystemMessage(content=enhanced)] + history
        response = llm.invoke(messages)
        response.additional_kwargs = response.additional_kwargs or {}
        response.additional_kwargs["agent"] = agent_config.get("name", "agent")
        if node_label:
            response.additional_kwargs["node"] = node_label
        return {"messages": [response]}

    return call_model


def build_single_agent_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """ReAct agent with optional tools, reflection, and structured output finalization."""
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    system_prompt = agent_config.get("system_prompt", "You are a helpful AI assistant.")
    base_url = agent_config.get("base_url") or agent_config.get("openai_base_url")

    base_llm = get_llm(model_name, temperature, base_url)
    struct_cfg = _get_structured_config(agent_config)
    llm = base_llm
    if tools:
        tool_choice = struct_cfg.get("tool_choice", "auto")
        if tool_choice == "required":
            llm = base_llm.bind_tools(tools, tool_choice="required")
        elif tool_choice == "none":
            llm = base_llm  # no tools
        else:
            llm = base_llm.bind_tools(tools)

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", _build_node_call_model(llm, agent_config, system_prompt, "agent"))
    workflow.set_entry_point("agent")

    reflect_cfg = _reflection_config(agent_config)
    has_struct = struct_cfg["enabled"] and struct_cfg["schema"]

    # Structured finalizer node (runs once at the end)
    if has_struct:
        workflow.add_node("finalize", _make_structured_finalizer(agent_config, base_llm))

    if tools and struct_cfg.get("tool_choice") != "none":
        tool_node = _make_reliable_tool_node(tools, struct_cfg["max_tool_retries"])
        workflow.add_node("tools", tool_node)

        def route_after_agent(state: AgentState):
            last = state["messages"][-1] if state.get("messages") else None
            if last and getattr(last, "tool_calls", None):
                return "tools"
            return "finalize" if has_struct else "agent_done"

        if reflect_cfg["enabled"] and reflect_cfg["max_rounds"] > 0:
            workflow.add_conditional_edges(
                "agent",
                route_after_agent,
                {"tools": "tools", "finalize": "finalize", "agent_done": "reflect"},
            )
            workflow.add_node("reflect", _make_reflect_node(agent_config, reflect_cfg["max_rounds"]))
            workflow.add_edge("reflect", "agent")
        else:
            workflow.add_conditional_edges(
                "agent",
                route_after_agent,
                {"tools": "tools", "finalize": "finalize", "agent_done": END},
            )
        workflow.add_edge("tools", "agent")
        if has_struct:
            workflow.add_edge("finalize", END)
    else:
        if reflect_cfg["enabled"] and reflect_cfg["max_rounds"] > 0:
            workflow.add_conditional_edges("agent", lambda s: "reflect", {"reflect": "reflect"})
            workflow.add_node("reflect", _make_reflect_node(agent_config, reflect_cfg["max_rounds"]))
            workflow.add_edge("reflect", "agent")
        elif has_struct:
            workflow.add_edge("agent", "finalize")
            workflow.add_edge("finalize", END)
        else:
            workflow.add_edge("agent", END)

    return workflow.compile(checkpointer=checkpointer)


def build_worker_subgraph(
    agent_config: Dict[str, Any],
    system_prompt: str,
    tools: Optional[List[Any]] = None,
    node_label: str = "worker",
):
    """
    Build a full ReAct subgraph for a multi-agent worker/specialist.
    Shares the parent AgentState so messages, memory, and tools compose cleanly.
    Each worker gets its own system prompt, optional tool binding, ToolNode loop,
    and the same reflection / planning enhancements as a single agent.
    """
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    base_url = agent_config.get("base_url") or agent_config.get("openai_base_url")

    llm = get_llm(model_name, temperature, base_url)
    struct_cfg = _get_structured_config(agent_config)
    if tools:
        tool_choice = struct_cfg.get("tool_choice", "auto")
        if tool_choice == "required":
            llm = llm.bind_tools(tools, tool_choice="required")
        elif tool_choice != "none":
            llm = llm.bind_tools(tools)

    # Temporarily override system prompt for this worker while reusing helpers
    worker_config = {**agent_config, "system_prompt": system_prompt}

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", _build_node_call_model(llm, worker_config, system_prompt, node_label))
    workflow.set_entry_point("agent")

    reflect_cfg = _reflection_config(worker_config)

    if tools and struct_cfg.get("tool_choice") != "none":
        tool_node = _make_reliable_tool_node(tools, struct_cfg["max_tool_retries"])
        workflow.add_node("tools", tool_node)
        if reflect_cfg["enabled"] and reflect_cfg["max_rounds"] > 0:
            workflow.add_conditional_edges(
                "agent",
                _should_continue,
                {"tools": "tools", "agent_done": "reflect"},
            )
            workflow.add_node("reflect", _make_reflect_node(worker_config, reflect_cfg["max_rounds"]))
            workflow.add_edge("reflect", "agent")
        else:
            workflow.add_conditional_edges("agent", _should_continue, {"tools": "tools", "agent_done": END})
        workflow.add_edge("tools", "agent")
    else:
        if reflect_cfg["enabled"] and reflect_cfg["max_rounds"] > 0:
            workflow.add_conditional_edges("agent", _should_continue, {"tools": "tools", "agent_done": "reflect"})
            workflow.add_node("reflect", _make_reflect_node(worker_config, reflect_cfg["max_rounds"]))
            workflow.add_edge("reflect", "agent")
        else:
            workflow.add_edge("agent", END)

    return workflow.compile()



def _make_reflect_node(agent_config: Dict[str, Any], max_rounds: int):
    """
    Reflexion-style self-assessment node: the model judges whether the task
    is fully complete, outputs structured JSON, and either accepts the answer
    or injects a critique back into the loop.
    """
    proceed_llm = get_llm(
        agent_config.get("model_name", "gpt-4o-mini"),
        max(0.0, min(0.2, agent_config.get("temperature", 0.7))),
        agent_config.get("base_url") or agent_config.get("openai_base_url"),
    )

    def reflect(state: AgentState):
        messages = state.get("messages", [])

        def _content(msg) -> str:
            return getattr(msg, "content", "") or ""

        task = next((_content(m) for m in messages if isinstance(m, HumanMessage)), "")
        last = next((_content(m) for m in reversed(messages) if isinstance(m, AIMessage)), "")

        judge_prompt = (
            "You are the self-check module of an autonomous agent. Decide whether the draft answer "
            "fully completes the user's task with no significant gaps, errors, or unverified claims.\n"
            "Reply ONLY with JSON:\n"
            '{"complete": true/false, "confidence": <float 0-1>, "critique": "<what is missing or wrong>", '
            '"needs_help": true/false, "help_reason": "<why human help is required or empty>"}\n\n'
            f"USER TASK:\n{task[:4000]}\n\n"
            f"DRAFT ANSWER:\n{last[:4000]}"
        )
        verdict = {"complete": True, "confidence": 0.6, "critique": "", "needs_help": False, "help_reason": ""}
        try:
            raw = proceed_llm.invoke([HumanMessage(content=judge_prompt)]).content or ""
            start, end = raw.find("{"), raw.rfind("}") + 1
            if start >= 0 and end > start:
                verdict.update(json.loads(raw[start:end]))
        except Exception as e:
            logger.debug("Reflection judge parse failed: %s", e)

        confidence = max(0.0, min(1.0, float(verdict.get("confidence", 0.5) or 0.5)))
        attempts = int(state.get("attempts", 0))
        needs_help = bool(verdict.get("needs_help", False))

        if verdict.get("complete", True) or attempts >= max_rounds:
            update: Dict[str, Any] = {"confidence": confidence, "attempts": attempts + 1}
            if needs_help or confidence < 0.35:
                update["escalated"] = needs_help or confidence < 0.35
            last_msg = messages[-1]
            if isinstance(last_msg, AIMessage):
                kw = last_msg.additional_kwargs or {}
                kw["confidence"] = confidence
                kw["escalated"] = update.get("escalated", False)
                if needs_help and verdict.get("help_reason"):
                    kw["help_reason"] = str(verdict["help_reason"])[:500]
            return update

        critique = str(verdict.get("critique") or "The answer is incomplete; identify the gaps and finish them.")
        critique_msg = HumanMessage(
            content=(
                f"[Self-check feedback, round {attempts + 1}/{max_rounds}] Your previous answer did not fully "
                f"complete the task: {critique}\n"
                "Fix the specific problems now. Do not repeat the same work; continue from where you left off "
                "and verify your result."
            )
        )
        return {"messages": [critique_msg], "attempts": attempts + 1, "confidence": confidence}

    return reflect


def build_sequential_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Sequential multi-agent: each specialist is a full ReAct subgraph (tools + optional reflection).
    Output of one becomes context for the next.
    """
    wf = agent_config.get("workflow_config") or {}
    sub_agents = wf.get("sub_agents") or []
    if not sub_agents:
        return build_single_agent_graph(agent_config, tools)

    workflow = StateGraph(AgentState)

    prev = None
    for i, sa in enumerate(sub_agents):
        node_name = sa.get("name", f"agent_{i}")
        prompt = sa.get("system_prompt", "You are a helpful specialist.")
        # Full tool-using subgraph per specialist
        worker_graph = build_worker_subgraph(agent_config, prompt, tools, node_name)
        workflow.add_node(node_name, worker_graph)
        if prev is None:
            workflow.set_entry_point(node_name)
        else:
            workflow.add_edge(prev, node_name)
        prev = node_name

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
    base_llm = get_llm(model_name, temperature, agent_config.get("base_url") or agent_config.get("openai_base_url"))

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
        enhanced = get_enhanced_system_prompt(supervisor_prompt, agent_config, state)
        messages = [SystemMessage(content=enhanced)] + state["messages"]
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

    workflow.add_node("supervisor", supervisor_node)
    workflow.set_entry_point("supervisor")

    for w in workers:
        name = w.get("name", "worker")
        prompt = w.get("system_prompt", "You are a specialist worker.")
        # Full ReAct tool-using subgraph for each worker
        worker_graph = build_worker_subgraph(agent_config, prompt, tools, name)
        workflow.add_node(name, worker_graph)
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
    base_url = agent_config.get("base_url") or agent_config.get("openai_base_url")
    llm = get_llm(model_name, temperature, base_url)
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
            enhanced = get_enhanced_system_prompt(prompt, agent_config, state)
            messages = [SystemMessage(content=enhanced)] + state["messages"]
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
        enhanced = get_enhanced_system_prompt(synth_prompt, agent_config, state)
        messages = [SystemMessage(content=enhanced)] + [
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
    base_url = agent_config.get("base_url") or agent_config.get("openai_base_url")
    llm = get_llm(model_name, temperature, base_url)

    workflow = StateGraph(AgentState)

    def make_debater(prompt: str, name: str):
        def node(state: AgentState):
            enhanced = get_enhanced_system_prompt(prompt, agent_config, state)
            messages = [SystemMessage(content=enhanced)] + state["messages"]
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
        enhanced = get_enhanced_system_prompt(judge_prompt, agent_config, state)
        messages = [SystemMessage(content=enhanced)] + [
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


def build_map_reduce_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Map-Reduce multi-agent pattern.
    Map: fan-out to multiple specialist workers on the same input (or chunks).
    Reduce: a synthesizer aggregates all worker outputs into a final answer.
    """
    wf = agent_config.get("workflow_config") or {}
    mappers = wf.get("mappers") or wf.get("sub_agents") or []
    if not mappers:
        return build_single_agent_graph(agent_config, tools)

    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    base_url = agent_config.get("base_url") or agent_config.get("openai_base_url")
    base_llm = get_llm(model_name, temperature, base_url)
    if tools:
        base_llm = base_llm.bind_tools(tools)

    reducer_prompt = wf.get(
        "reducer_prompt",
        "You are a synthesizer. Combine the specialist outputs into one coherent, high-quality final answer. "
        "Cite key points from each specialist where relevant.",
    )

    workflow = StateGraph(AgentState)

    def make_mapper(prompt: str, name: str):
        def node(state: AgentState):
            enhanced = get_enhanced_system_prompt(prompt, agent_config, state)
            messages = [SystemMessage(content=enhanced)] + state["messages"]
            response = base_llm.invoke(messages)
            response.additional_kwargs = response.additional_kwargs or {}
            response.additional_kwargs["agent"] = name
            response.additional_kwargs["role"] = "mapper"
            return {"messages": [response]}
        return node

    def reducer_node(state: AgentState):
        # Collect recent mapper outputs (last N messages that are from mappers)
        mapper_outputs = []
        for msg in reversed(state["messages"]):
            if isinstance(msg, AIMessage) and msg.additional_kwargs.get("role") == "mapper":
                mapper_outputs.append(msg)
            if len(mapper_outputs) >= len(mappers):
                break
        mapper_outputs.reverse()
        context = "\n\n".join(
            f"[{m.additional_kwargs.get('agent', 'mapper')}]: {m.content}" for m in mapper_outputs
        )
        messages = [
            SystemMessage(content=get_enhanced_system_prompt(reducer_prompt, agent_config, state)),
            HumanMessage(content=f"Specialist outputs:\n{context}\n\nOriginal request context is in prior messages."),
        ] + state["messages"][-1:]  # include latest user message if needed
        response = base_llm.invoke(messages)
        response.additional_kwargs = response.additional_kwargs or {}
        response.additional_kwargs["agent"] = "reducer"
        return {"messages": [response]}

    # True parallel map-reduce using LangGraph Send API for concurrent fan-out
    mapper_names = []
    for i, m in enumerate(mappers):
        name = m.get("name", f"mapper_{i}")
        prompt = m.get("system_prompt", "You are a specialist mapper.")
        worker_graph = build_worker_subgraph(agent_config, prompt, tools, name)
        workflow.add_node(name, worker_graph)
        mapper_names.append(name)

    workflow.add_node("reducer", reducer_node)

    def fan_out(state: AgentState):
        """Fan-out to all mappers in parallel via Send."""
        return [Send(name, state) for name in mapper_names]

    # Lightweight dispatcher node
    def dispatcher(state: AgentState):
        return {}

    workflow.add_node("dispatcher", dispatcher)
    workflow.set_entry_point("dispatcher")
    workflow.add_conditional_edges("dispatcher", fan_out, mapper_names)

    for name in mapper_names:
        workflow.add_edge(name, "reducer")

    workflow.add_edge("reducer", END)

    return workflow.compile(checkpointer=checkpointer)


def build_hierarchical_graph(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None):
    """
    Hierarchical multi-agent: top-level manager delegates to teams.
    Each team is itself a supervisor (or single) subgraph.
    workflow_config example:
    {
      "type": "hierarchical",
      "teams": [
        {
          "name": "research_team",
          "description": "Handles research and fact-finding",
          "workflow": {"type": "supervisor", "sub_agents": [...]},
          "system_prompt": "You lead the research team."
        },
        ...
      ]
    }
    Falls back to supervisor if no teams defined.
    """
    wf = agent_config.get("workflow_config") or {}
    teams = wf.get("teams") or wf.get("sub_agents") or []
    if not teams:
        return build_supervisor_graph(agent_config, tools)

    # Reuse supervisor routing logic but each "worker" is a team subgraph
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    base_url = agent_config.get("base_url") or agent_config.get("openai_base_url")
    base_llm = get_llm(model_name, temperature, base_url)

    team_names = [t.get("name", f"team_{i}") for i, t in enumerate(teams)]
    team_desc = "\n".join(
        f"- {t.get('name')}: {t.get('description', 'team')}" for t in teams
    )
    manager_prompt = (
        agent_config.get("system_prompt", "You are a hierarchical manager coordinating teams.")
        + f"\n\nAvailable teams:\n{team_desc}\n"
        + "Decide the next step. You MUST reply with EXACTLY one of the following on its own line:\n"
        + "\n".join(f"TEAM: {name}" for name in team_names)
        + "\nFINISH\n"
        + "Do not add any other text."
    )

    workflow = StateGraph(AgentState)

    def manager_node(state: AgentState):
        enhanced = get_enhanced_system_prompt(manager_prompt, agent_config, state)
        messages = [SystemMessage(content=enhanced)] + state["messages"]
        response = base_llm.invoke(messages)
        content = (response.content or "").strip().upper()
        next_team = None
        for name in team_names:
            if f"TEAM: {name.upper()}" in content or name.upper() in content:
                next_team = name
                break
        if "FINISH" in content or next_team is None:
            return {"messages": [response]}
        response.additional_kwargs = response.additional_kwargs or {}
        response.additional_kwargs["next"] = next_team
        return {"messages": [response]}

    workflow.add_node("manager", manager_node)
    workflow.set_entry_point("manager")

    for t in teams:
        name = t.get("name", "team")
        # Build nested workflow config for the team
        team_cfg = {**agent_config, "workflow_config": t.get("workflow") or {"type": "single"}, "system_prompt": t.get("system_prompt", agent_config.get("system_prompt"))}
        team_graph = build_agent_graph(team_cfg, tools)
        workflow.add_node(name, team_graph)
        workflow.add_edge(name, "manager")

    def route_manager(state: AgentState) -> str:
        last = state["messages"][-1] if state["messages"] else None
        if not last:
            return END
        nxt = getattr(last, "additional_kwargs", {}).get("next")
        if nxt and nxt in team_names:
            return nxt
        return END

    workflow.add_conditional_edges(
        "manager", route_manager, {**{n: n for n in team_names}, END: END}
    )

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
    if wf_type == "map_reduce":
        return build_map_reduce_graph(agent_config, tools)
    if wf_type == "hierarchical":
        return build_hierarchical_graph(agent_config, tools)
    return build_single_agent_graph(agent_config, tools)


async def _load_tools(agent_config: Dict[str, Any], tools: Optional[List[Any]] = None) -> Optional[List[Any]]:
    """
    Assemble the tool belt: any pre-supplied tools + MCP tools + sandbox tools
    (when the agent opts into sandbox execution) + MCP resource/prompt meta-tools.
    """
    if tools is not None:
        return tools

    agent_tools: List[Any] = []

    mcp_config = agent_config.get("tools_config") or []
    if mcp_config:
        agent_tools.extend(await mcp_service.get_tools(mcp_config) or [])
        # Add live MCP resource & prompt tools so agents can discover and read context
        from app.agents.tools import build_mcp_meta_tools
        agent_tools.extend(build_mcp_meta_tools(mcp_config))

    if agent_config.get("sandbox_enabled"):
        from app.agents.tools import build_sandbox_tools

        workspace = agent_config.get("workspace")
        if workspace:
            agent_tools.extend(build_sandbox_tools(str(workspace)))

    return agent_tools or None


def _extract_usage(event: Dict[str, Any]) -> Dict[str, int]:
    """Extract token usage from a LangChain chat model event when available."""
    data = event.get("data", {}) or {}
    # Newer LangChain puts usage on the output AIMessage or in response_metadata
    output = data.get("output")
    usage = {}
    if isinstance(output, AIMessage):
        meta = getattr(output, "response_metadata", {}) or {}
        usage = meta.get("token_usage") or meta.get("usage") or {}
    if not usage:
        # Fallback for some streaming end events
        usage = data.get("usage") or data.get("token_usage") or {}
    return {
        "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
    }


def _estimate_cost(model_name: str, input_tokens: int, output_tokens: int) -> float:
    """Rough USD cost estimate. Update pricing as needed; defaults to gpt-4o-mini rates."""
    # Approximate prices per 1M tokens (input / output) as of late 2025/2026
    pricing = {
        "gpt-4o": (2.50, 10.00),
        "gpt-4o-mini": (0.15, 0.60),
        "gpt-4.1": (2.00, 8.00),
        "gpt-4.1-mini": (0.40, 1.60),
        "o1": (15.00, 60.00),
        "o1-mini": (3.00, 12.00),
        "claude-3-5-sonnet": (3.00, 15.00),
        "claude-3-5-haiku": (0.80, 4.00),
    }
    # Normalize model name
    key = (model_name or "").lower().split("/")[-1]
    in_price, out_price = pricing.get(key, (0.15, 0.60))  # default mini
    return round((input_tokens * in_price + output_tokens * out_price) / 1_000_000, 6)


async def run_agent(
    agent_config: Dict[str, Any],
    user_input: str,
    thread_id: Optional[str] = None,
    tools: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """
    Non-streaming agent run (supports multi-agent).
    Returns {"output", "confidence", "escalated"}.
    """
    tools = await _load_tools(agent_config, tools)
    graph = build_agent_graph(agent_config, tools)
    config = {
        "configurable": {"thread_id": thread_id or "default"},
        "recursion_limit": max(10, int(agent_config.get("max_steps") or 25)),
    }
    initial_state: AgentState = {"messages": [HumanMessage(content=user_input)], "attempts": 0}

    # Use streaming events internally so we can capture token usage consistently
    full_output = ""
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    confidence = 0.0
    escalated = False

    async for event in graph.astream_events(initial_state, config=config, version="v2"):
        kind = event.get("event")
        if kind == "on_chat_model_end":
            usage = _extract_usage(event)
            input_tokens += usage["input_tokens"]
            output_tokens += usage["output_tokens"]
            total_tokens += usage["total_tokens"] or (usage["input_tokens"] + usage["output_tokens"])
        elif kind == "on_chain_end" and event.get("name") == "reflect":
            out = event.get("data", {}).get("output", {}) or {}
            confidence = float(out.get("confidence", confidence) or 0.0)
            escalated = bool(out.get("escalated", escalated))

    # Final state
    result = await graph.aget_state(config)
    messages = result.values.get("messages", []) if result else []
    last_message = messages[-1] if messages else None
    output = getattr(last_message, "content", "") if last_message else ""
    if not output:
        output = full_output

    store_interaction_memory(agent_config, user_input, output)
    cost = _estimate_cost(model_name, input_tokens, output_tokens)
    return {
        "output": output,
        "confidence": confidence,
        "escalated": escalated,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens or (input_tokens + output_tokens),
            "estimated_cost_usd": cost,
        },
    }


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
    - {"type": "agent_step", "agent": "...", "content": "..."}
    - {"type": "reflection", "content": critique, "round": n}
    - {"type": "confidence", "content": 0.87, "escalated": bool}
    - {"type": "done", "content": full_output, "confidence": ...}
    - {"type": "error", "content": "..."}
    """
    try:
        tools = await _load_tools(agent_config, tools)
        # Human-in-the-loop wrapping for supervised agents
        if tools and (agent_config.get("autonomy_level") or "supervised").lower() == "supervised":
            tools = wrap_tools_for_approval(tools, agent_config, thread_id or "default")
        graph = build_agent_graph(agent_config, tools)
        config = {
            "configurable": {"thread_id": thread_id or f"run-{hash(user_input)}"},
            "recursion_limit": max(10, int(agent_config.get("max_steps") or 25)),
        }
        initial_state: AgentState = {"messages": [HumanMessage(content=user_input)], "attempts": 0}

        full_output = ""
        input_tokens = 0
        output_tokens = 0
        total_tokens = 0
        model_name = agent_config.get("model_name", "gpt-4o-mini")

        async for event in graph.astream_events(initial_state, config=config, version="v2"):
            kind = event.get("event")
            name = event.get("name", "")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    token = chunk.content
                    full_output += token
                    yield {"type": "token", "content": token}

            elif kind == "on_chat_model_end":
                usage = _extract_usage(event)
                input_tokens += usage["input_tokens"]
                output_tokens += usage["output_tokens"]
                total_tokens += usage["total_tokens"] or (usage["input_tokens"] + usage["output_tokens"])

            elif kind == "on_chain_start":
                # Emit step start for multi-agent nodes (skip internal)
                if name and name not in ("LangGraph", "__start__", "tools", "agent", "RunnableSequence"):
                    yield {
                        "type": "agent_step",
                        "agent": name,
                        "content": f"Running {name}...",
                    }

            elif kind == "on_tool_start":
                tool_name = event.get("name", "tool")
                tool_args = event.get("data", {}).get("input", {})
                yield {
                    "type": "tool_call",
                    "name": tool_name,
                    "args": tool_args,
                }
                # If this tool is awaiting approval, emit the request so the UI can respond
                pending = getattr(wrap_tools_for_approval, "_pending", {})
                rid = pending.get(tool_name)
                if rid:
                    yield {
                        "type": "approval_required",
                        "request_id": rid,
                        "name": tool_name,
                        "args": tool_args,
                    }
                    # Clear so we don't re-emit
                    pending.pop(tool_name, None)

            elif kind == "on_tool_end":
                output = event.get("data", {}).get("output", "")
                yield {
                    "type": "tool_result",
                    "name": event.get("name", "tool"),
                    "content": str(output)[:2000],
                }

            elif kind == "on_chain_end" and name == "reflect":
                output = event.get("data", {}).get("output", {}) or {}
                if isinstance(output, dict) and output.get("messages"):
                    for msg in output["messages"]:
                        if isinstance(msg, HumanMessage) and "Self-check feedback" in str(getattr(msg, "content", "")):
                            yield {
                                "type": "reflection",
                                "round": int(output.get("attempts", 1)),
                                "content": str(msg.content)[:1500],
                            }
                if isinstance(output, dict) and "confidence" in output:
                    yield {
                        "type": "confidence",
                        "content": float(output.get("confidence", 0.0) or 0.0),
                        "escalated": bool(output.get("escalated", False)),
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

        store_interaction_memory(agent_config, user_input, full_output)
        cost = _estimate_cost(model_name, input_tokens, output_tokens)
        yield {
            "type": "done",
            "content": full_output,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens or (input_tokens + output_tokens),
                "estimated_cost_usd": cost,
            },
        }

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


def now_ms() -> int:
    return int(time.monotonic() * 1000)
