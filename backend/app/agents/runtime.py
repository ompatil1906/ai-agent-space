from typing import Any, Dict, List, Optional
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode
from pydantic import BaseModel

# Simple state for the agent
class AgentState(BaseModel):
    messages: List[Any] = []
    # Future: memory, tool results, etc.


def build_agent_graph(agent_config: Dict[str, Any]):
    """
    Build a LangGraph for the agent based on config.
    For now, simple LLM node. Tools/MCP to be added.
    """
    model_name = agent_config.get("model_name", "gpt-4o-mini")
    temperature = agent_config.get("temperature", 0.7)
    system_prompt = agent_config.get("system_prompt", "You are a helpful AI assistant.")

    llm = ChatOpenAI(model=model_name, temperature=temperature)

    def call_model(state: AgentState):
        messages = [SystemMessage(content=system_prompt)] + state.messages
        response = llm.invoke(messages)
        return {"messages": state.messages + [response]}

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", call_model)
    workflow.set_entry_point("agent")
    workflow.add_edge("agent", END)

    return workflow.compile()


async def run_agent(agent_config: Dict[str, Any], user_input: str) -> str:
    graph = build_agent_graph(agent_config)
    initial_state = AgentState(messages=[HumanMessage(content=user_input)])
    result = await graph.ainvoke(initial_state)
    # Return the last AI message content
    last_message = result["messages"][-1]
    return last_message.content if hasattr(last_message, "content") else str(last_message)
