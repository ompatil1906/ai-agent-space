"""
Seed real, marketplace-ready agents under a specific user profile — Gemini + real MCP.

What it does (idempotent — safe to re-run):
  1. Ensures the target user exists.
  2. Registers REAL working MCP servers in the user's MCP Server Registry
     (official npm servers run via npx + the repo's FastMCP example):
       - Filesystem            read/write/edit real files in ~/ai-agent-workspace
       - Everything            official MCP test server (echo, resources, ...)
       - Sequential Thinking   structured step-by-step reasoning tool
       - Memory                knowledge-graph persistent memory server
       - Demo Tools (FastMCP)  repo's example server (add/multiply/get_weather)
     Each is health-checked once (best effort) and the status persisted.
  3. Creates production-grade agents (Gemini models, real system prompts, memory
     configs, multi-agent workflows) whose tools_config references the registered
     servers via {"name": ..., "server_id": <id>} (resolved at runtime).
  4. For agents that already exist, refreshes tools_config and snapshots versions.
  5. Publishes every agent to the marketplace (is_published=True, is_public=True).

Agents run on the platform Gemini key (GEMINI_API_KEY) through Google's
OpenAI-compatible endpoint — verified live, including function calling.

Usage (from backend/):
    venv/bin/python scripts/seed_marketplace_agents.py
Optionally override the target user:
    venv/bin/python scripts/seed_marketplace_agents.py --email you@example.com
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMPLE_SERVER = os.path.join(BACKEND_DIR, "examples", "example_mcp_server.py")
VENV_PYTHON = os.path.join(BACKEND_DIR, "venv", "bin", "python")
HOME = os.path.expanduser("~")
WORKSPACE_DIR = os.path.join(HOME, "ai-agent-workspace")

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models import Agent, User, MCPServer
from app.api.v1.agents import _create_version
from app.services.mcp_service import mcp_service

OWNER_EMAIL = "patilom1906@gmail.com"
OWNER_NAME = "Om Patil"

# Free-Tier quota-aware defaults: lite models have the highest daily request
# allowance, so lite is used for every agent (per-model daily caps exhausted
# quickly otherwise). "Strong" models are intentionally NOT used.
GEMINI_FAST = "gemini-3.5-flash-lite"
GEMINI_PRO = GEMINI_FAST

# --- Real, health-checked MCP servers registered under the owner profile -----
MCP_SERVERS = [
    {
        "name": "Filesystem Workspace",
        "description": "Official MCP filesystem server scoped to ~/ai-agent-workspace — read, write, edit, search and organize real files.",
        "category": "dev-tools",
        "config": {
            "name": "filesystem",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", WORKSPACE_DIR],
        },
    },
    {
        "name": "Everything Server",
        "description": "Official MCP 'Everything' server — echo, structured content, resources, resource subscriptions and prompt capabilities.",
        "category": "dev-tools",
        "config": {
            "name": "everything",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-everything"],
        },
    },
    {
        "name": "Sequential Thinking",
        "description": "Official MCP sequential-thinking server — dynamic, revisable step-by-step reasoning for complex analysis and planning.",
        "category": "productivity",
        "config": {
            "name": "sequential-thinking",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        },
    },
    {
        "name": "Memory Knowledge Graph",
        "description": "Official MCP memory server — persistent knowledge graph (entities, relations, observations) the agent builds and queries across runs.",
        "category": "data",
        "config": {
            "name": "memory",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-memory"],
        },
    },
    {
        "name": "Demo Tools (FastMCP)",
        "description": "Bundled FastMCP server exposing add, multiply and get_weather tools (repo example server, runs on the backend venv Python).",
        "category": "dev-tools",
        "config": {
            "name": "demo-tools",
            "transport": "stdio",
            "command": VENV_PYTHON,
            "args": [EXAMPLE_SERVER],
        },
    },
]

# Map agent -> MCP servers to attach (by MCP_SERVERS name)
AGENT_MCP = {
    "Workspace File Steward": ["Filesystem Workspace"],
    "Memory Journal Companion": ["Memory Knowledge Graph"],
    "Structured Thinker": ["Sequential Thinking"],
    "Everything Explorer": ["Everything Server"],
    "Workspace Research Team": ["Filesystem Workspace", "Memory Knowledge Graph", "Sequential Thinking"],
    "Deep Think Debate": ["Sequential Thinking", "Memory Knowledge Graph"],
    "Consensus Forecaster": ["Filesystem Workspace", "Everything Server"],
}

# --- Production-grade agent configuration (prices in marketplace credits) ----
AGENTS = [
    {
        "name": "Workspace File Steward",
        "description": "A file-ops agent with real disk access: reads, writes, edits, searches and organizes files in your AI Agent Space workspace directory using the official MCP filesystem server.",
        "system_prompt": (
            "You are Workspace File Steward, an agent with real access to files in "
            "~/ai-agent-workspace via the filesystem MCP server. "
            "Prefer actual tool calls over inventing content: list, read, write, edit and search real files. "
            "When the user asks to create or change something, do it on disk and confirm the exact file paths. "
            "Keep files well formatted, add helpful headers, and summarize what you changed. "
            "Be careful and idempotent: don't overwrite content without checking it first."
        ),
        "model_name": GEMINI_FAST,
        "temperature": 0.3,
        "memory_config": {"enabled": True, "max_messages": 20},
        "workflow_config": {"type": "single"},
        "max_steps": 30,
        "autonomy_level": "semi_autonomous",
        "sandbox_enabled": False,
        "advanced_config": {"planning_enabled": True},
        "price": 0,
    },
    {
        "name": "Memory Journal Companion",
        "description": "A personal knowledge companion backed by a real MCP knowledge-graph server: it stores entities, relations and observations across conversations, and remembers you over time.",
        "system_prompt": (
            "You are Memory Journal Companion. You maintain a live knowledge graph through the memory MCP server "
            "(create_entities, create_relations, add_observations, search_nodes, read_graph). "
            "Whenever the user shares durable facts — people, projects, preferences, decisions — store them as entities "
            "and relations in the graph, and read the graph before answering to stay consistent. "
            "Your goal: short-term helpfulness, long-term memory."
        ),
        "model_name": GEMINI_FAST,
        "temperature": 0.5,
        "memory_config": {
            "enabled": True,
            "max_messages": 20,
            "longterm_enabled": True,
            "longterm_k": 5,
        },
        "workflow_config": {"type": "single"},
        "max_steps": 30,
        "autonomy_level": "semi_autonomous",
        "sandbox_enabled": False,
        "advanced_config": {"planning_enabled": False},
        "price": 15,
    },
    {
        "name": "Structured Thinker",
        "description": "A deliberate reasoning agent powered by the official MCP sequential-thinking server: it plans, revises and branches its thinking before answering hard questions.",
        "system_prompt": (
            "You are Structured Thinker. For any non-trivial question, use the sequentialthinking MCP tool: "
            "plan the problem into explicit steps, revise them when assumptions break, and branch to explore alternatives. "
            "Only produce your final answer after the chain of thought converges. "
            "Always show a condensed version of your final reasoning path — numbered steps, assumptions, conclusion."
        ),
        "model_name": GEMINI_FAST,
        "temperature": 0.4,
        "memory_config": {"enabled": True, "max_messages": 20},
        "workflow_config": {"type": "single"},
        "max_steps": 40,
        "autonomy_level": "supervised",
        "sandbox_enabled": False,
        "advanced_config": {"planning_enabled": True, "reflection_enabled": True, "max_reflections": 2},
        "price": 25,
    },
    {
        "name": "Everything Explorer",
        "description": "A hands-on demo agent wired to the official MCP 'Everything' server: exercising echo, structured content, resources and prompt discovery — ideal for exploring what MCP can do.",
        "system_prompt": (
            "You are Everything Explorer, the friendly guided tour of the MCP 'Everything' server. "
            "When asked to demonstrate a capability, actually call the relevant tool: echo, structured content, "
            "resource links, long-running operations, logging or image tools. "
            "Explain briefly what each tool call did and what it proves about MCP. "
            "Keep the tour energetic but precise."
        ),
        "model_name": GEMINI_FAST,
        "temperature": 0.6,
        "memory_config": {"enabled": True, "max_messages": 20},
        "workflow_config": {"type": "single"},
        "max_steps": 25,
        "autonomy_level": "supervised",
        "sandbox_enabled": False,
        "advanced_config": {},
        "price": 0,
    },
    {
        "name": "Workspace Research Team",
        "description": "A supervisor-led research team with real tools: a file analyst (filesystem MCP), a knowledge keeper (memory MCP) and a structured planner (sequential-thinking MCP), coordinated into a single research brief.",
        "system_prompt": (
            "You are the supervisor of a research team. Route work between specialists: "
            "file_analyst reads and writes real files in ~/ai-agent-workspace via the filesystem MCP server; "
            "knowledge_keeper stores and retrieves findings in the memory knowledge graph; "
            "structured_planner organizes the investigation with the sequential-thinking server. "
            "Deliver a final research brief: findings with file references, saved knowledge-graph entries, and clear next steps."
        ),
        "model_name": GEMINI_FAST,
        "temperature": 0.4,
        "memory_config": {"enabled": True, "max_messages": 20},
        "workflow_config": {
            "type": "supervisor",
            "sub_agents": [
                {
                    "name": "file_analyst",
                    "description": "Reads and writes real workspace files via filesystem MCP",
                    "system_prompt": "You are a meticulous file analyst. Use filesystem tools to gather raw material from ~/ai-agent-workspace and save intermediate evidence files when useful.",
                },
                {
                    "name": "knowledge_keeper",
                    "description": "Persists and recalls findings via the MCP knowledge graph",
                    "system_prompt": "You are the team's knowledge keeper. Record confirmed findings as entities and relations in the memory knowledge graph and retrieve them when needed.",
                },
                {
                    "name": "structured_planner",
                    "description": "Sequences the investigation via sequential thinking",
                    "system_prompt": "You are the structured planner. Break the research question into explicit, revisable steps with the sequentialthinking tool and hand a clear plan to the team.",
                },
            ],
        },
        "max_steps": 40,
        "autonomy_level": "supervised",
        "sandbox_enabled": False,
        "advanced_config": {"planning_enabled": True},
        "price": 49,
    },
    {
        "name": "Deep Think Debate",
        "description": "Pro and con specialists debate with real reasoning tool support (sequential thinking), while the knowledge graph keeps track of recurring arguments — and an impartial judge rules.",
        "system_prompt": (
            "You are the moderator of a rigorous debate. Ensure the advocates ground their cases in step-by-step reasoning "
            "and that the judge delivers a balanced verdict that names the strongest argument on each side."
        ),
        "model_name": GEMINI_FAST,
        "temperature": 0.6,
        "memory_config": {"enabled": True, "max_messages": 20},
        "workflow_config": {
            "type": "debate",
            "sub_agents": [
                {
                    "name": "proponent",
                    "description": "Argues the strongest case in favor",
                    "system_prompt": "You are a passionate but rigorous advocate. Use step-by-step reasoning to build the strongest case for the proposition, acknowledging objections.",
                },
                {
                    "name": "opponent",
                    "description": "Argues the strongest case against",
                    "system_prompt": "You are a sharp critic. Use step-by-step reasoning to expose flaws, risks and counterexamples to the proposition.",
                },
                {
                    "name": "judge",
                    "description": "Weighs both sides impartially",
                    "system_prompt": "You are an impartial judge. Weigh both cases and deliver a balanced verdict: the strongest argument on each side, then your ruling with confidence.",
                },
            ],
        },
        "max_steps": 35,
        "autonomy_level": "supervised",
        "sandbox_enabled": False,
        "advanced_config": {},
        "price": 29,
    },
    {
        "name": "Consensus Forecaster",
        "description": "Three independent analysts (pragmatist, risk analyst, strategist) forecast in parallel using real tools, and an ensemble synthesizer reconciles them into a confidence-weighted outlook.",
        "system_prompt": (
            "You are a forecasting ensemble. Each specialist analyses independently with the team's tools; "
            "then you reconcile their readings into one outlook, weighted by their confidence, and flag real disagreements."
        ),
        "model_name": GEMINI_PRO,
        "temperature": 0.3,
        "memory_config": {"enabled": True, "max_messages": 20},
        "workflow_config": {
            "type": "ensemble",
            "sub_agents": [
                {
                    "name": "pragmatist",
                    "description": "Practical near-term lens grounded in workspace files",
                    "system_prompt": "You are a pragmatic analyst. Ground your forecast in concrete, practical factors and check any referenced files with the filesystem tools.",
                },
                {
                    "name": "risk_analyst",
                    "description": "Failure modes and downside scenarios",
                    "system_prompt": "You are a risk analyst. Map failure modes and downside scenarios for the question at hand, and quantify them where possible.",
                },
                {
                    "name": "strategist",
                    "description": "Upside and long-range positioning",
                    "system_prompt": "You are a strategic analyst. Highlight upside scenarios and long-range positioning; be specific about leading indicators.",
                },
            ],
        },
        "max_steps": 45,
        "autonomy_level": "supervised",
        "sandbox_enabled": False,
        "advanced_config": {"planning_enabled": True},
        "price": 35,
    },
]


def ensure_user(db, email: str, full_name: str) -> User:
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Dev-only fallback so the script is self-sufficient on a fresh DB.
        user = User(
            email=email,
            hashed_password=get_password_hash("changeme123"),
            full_name=full_name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"Created user {email} (dev password: changeme123)")
    return user


def ensure_mcp_servers(db, owner: User) -> dict:
    """Register the real MCP servers (by name), refresh configs, health check."""
    registry: dict = {}
    for spec in MCP_SERVERS:
        server = (
            db.query(MCPServer)
            .filter(MCPServer.owner_id == owner.id, MCPServer.name == spec["name"])
            .first()
        )
        if server:
            # Keep the registry config in sync with this script (paths, etc.)
            if server.config != spec["config"]:
                server.config = spec["config"]
                server.last_status = None
                server.last_checked_at = None
            server.description = spec["description"]
            db.commit()
        else:
            server = MCPServer(
                owner_id=owner.id,
                name=spec["name"],
                description=spec["description"],
                config=spec["config"],
                category=spec.get("category"),
                is_public=False,
            )
            db.add(server)
            db.commit()
            db.refresh(server)
            print(f"Registered MCP server [{server.id}] {server.name}")
        registry[spec["name"]] = server

    # Best-effort live health check for new/never-checked/stale servers
    to_check = [s for s in registry.values() if s.last_checked_at is None and s.last_status != "healthy"]
    if to_check:
        async def check_all():
            results = []
            for server in to_check:
                try:
                    results.append(await mcp_service.health_check([server.config], timeout=90.0))
                except Exception as exc:  # never fail the seed on a bad connection
                    results.append({"healthy": False, "error": str(exc), "tools": []})
            return results

        try:
            results = asyncio.run(check_all())
        except Exception as exc:
            print(f"Health check skipped: {exc}")
            results = [{}] * len(to_check)
        for server, result in zip(to_check, results):
            server.last_status = "healthy" if result.get("healthy") else "unreachable"
            server.last_checked_at = datetime.now(timezone.utc)
            db.commit()
            if server.last_status == "healthy":
                tools = result.get("tools") or []
                names = [t for t in tools if isinstance(t, str)] or [getattr(t, "name", "?") for t in tools]
                print(f"  Health [{server.name}]: healthy — {result.get('tool_count', 0)} tools: {', '.join(map(str, names[:5]))}{' ...' if len(names) > 5 else ''}")
            else:
                print(f"  Health [{server.name}]: {server.last_status}"
                      + (f" — {result.get('error')}" if result.get("error") else ""))
    return registry


def tools_config_for(spec: dict, registry: dict) -> list:
    """Build tools_config as server_id references (resolved at runtime)."""
    refs = []
    for name in AGENT_MCP.get(spec["name"], []):
        server = registry.get(name)
        if server:
            refs.append({"name": server.config.get("name", "mcp"), "server_id": server.id})
    return refs


def snapshot_version(db, agent: Agent, owner_id: int, note: str) -> None:
    _create_version(db, agent, created_by=owner_id, change_note=note)
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed real Gemini + MCP marketplace agents")
    parser.add_argument("--email", default=OWNER_EMAIL)
    args = parser.parse_args()

    os.makedirs(WORKSPACE_DIR, exist_ok=True)

    db = SessionLocal()
    try:
        owner = ensure_user(db, args.email, OWNER_NAME)
        print(f"Seeding for {owner.email} (user_id={owner.id})")

        registry = ensure_mcp_servers(db, owner)

        created, updated, unchanged = [], [], 0
        for spec in AGENTS:
            tools_config = tools_config_for(spec, registry)
            agent = (
                db.query(Agent)
                .filter(Agent.owner_id == owner.id, Agent.name == spec["name"])
                .first()
            )
            if agent:
                changed = (agent.tools_config or []) != tools_config or agent.model_name != spec["model_name"]
                for field in ("description", "system_prompt", "model_name", "temperature", "memory_config",
                              "workflow_config", "max_steps", "autonomy_level", "advanced_config", "price"):
                    if getattr(agent, field) != spec[field]:
                        changed = True
                        setattr(agent, field, spec[field])
                if changed:
                    agent.tools_config = tools_config
                    agent.is_published = True
                    agent.is_public = True
                    db.commit()
                    db.refresh(agent)
                    snapshot_version(db, agent, owner.id, "Rebuild: Gemini + real MCP servers")
                    updated.append((agent.id, agent.name, agent.price))
                else:
                    if not agent.is_published or not agent.is_public:
                        agent.is_published = True
                        agent.is_public = True
                        db.commit()
                    unchanged += 1
                continue

            agent = Agent(
                name=spec["name"],
                description=spec["description"],
                system_prompt=spec["system_prompt"],
                model_name=spec["model_name"],
                temperature=spec["temperature"],
                tools_config=tools_config,
                memory_config=spec["memory_config"],
                workflow_config=spec["workflow_config"],
                max_steps=spec["max_steps"],
                autonomy_level=spec["autonomy_level"],
                sandbox_enabled=spec["sandbox_enabled"],
                advanced_config=spec["advanced_config"],
                is_public=True,
                is_published=True,
                price=spec["price"],
                owner_id=owner.id,
            )
            db.add(agent)
            db.commit()
            db.refresh(agent)
            snapshot_version(db, agent, owner.id, "Initial version (Gemini + real MCP)")
            created.append((agent.id, agent.name, agent.price))

        for label, found in (("Created", created), ("Updated", updated)):
            if found:
                print(f"{label} {len(found)} agent(s):")
                for agent_id, name, price in found:
                    spec = next(s for s in AGENTS if s["name"] == name)
                    servers = AGENT_MCP.get(name, [])
                    print(f"  [{agent_id}] {name}  price={price}  model={spec['model_name']}  PUBLISHED  mcp={servers}")
        if unchanged:
            print(f"Already up to date ({unchanged})")

        # Final marketplace verification
        published = (
            db.query(Agent)
            .filter(Agent.owner_id == owner.id, Agent.is_published == True, Agent.is_public == True)  # noqa: E712
            .order_by(Agent.id)
            .all()
        )
        print(f"\nMarketplace listing for {owner.email}: {len(published)} published agent(s)")
        for a in published:
            print(f"  [{a.id}] {a.name}  model={a.model_name}  price={a.price}  mcp={[r.get('name') for r in (a.tools_config or [])]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
