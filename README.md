# AI Agent Space

**AI Agent Space** is an open-source platform for creating, configuring, running, evaluating, publishing, discovering, buying, and selling powerful autonomous AI agents.

Build Devin-level agents with long-horizon planning, multi-step reasoning, tool use (including full MCP support), code writing & execution in secure sandboxes, self-reflection, multi-agent collaboration, and the ability to complete complex software engineering and general tasks with minimal human intervention.

## Core Vision

The place where the best autonomous agents live and are shared. Users can:

- Build highly capable single-agent or multi-agent systems (crews/swarms)
- Equip them with real tools via the Model Context Protocol (MCP)
- Run them in secure Docker sandboxes
- Observe full traces (thoughts, actions, tool calls, results)
- Publish agents to a marketplace
- Clone, fork, buy, and monetize agents
- Evaluate performance with metrics, human feedback, and LLM-as-judge

## Key Features

### 1. Agent Builder
- Visual + code/YAML editor
- Define: name, description, system prompt, tools, MCP servers, memory type, model, temperature, max steps, autonomy level
- Support for single agents and multi-agent patterns (sequential, supervisor, parallel, debate, hierarchical, ensemble, group chat, swarm, critique-revise, plan-and-execute, and more)
- Agent versioning with full snapshots

### 2. Powerful Agent Runtime (Devin-inspired)
- LangGraph + LangChain orchestration
- Long-horizon planning and task decomposition
- ReAct / Plan-and-Execute / Reflexion style loops
- Full tool calling
- Sandboxed code interpreter + terminal (Docker)
- Browser tool support (optional)
- File system operations
- Self-reflection and error recovery
- Streaming of thoughts, actions, and observations (SSE)
- Persistent short-term + long-term memory
- Confidence estimation and human-in-the-loop escalation/approvals
- Multi-provider LLM support (OpenAI, Anthropic Claude, Google Gemini, compatible endpoints)

### 3. Real MCP Support
- Connect to any MCP server (stdio, SSE, streamable HTTP)
- Auto-discover tools, resources, and prompts
- Seamless use inside agents
- User-managed MCP Server Registry

### 4. Secure Execution Environment
- Docker-based sandbox for each agent run
- Resource limits (CPU, memory, time)
- Network controls
- Safe code execution

### 5. Marketplace
- Publish agents (public / unlisted / private)
- Browse, search, filter
- One-click clone
- Simple credit-based buy/sell system
- Ratings, reviews, usage stats
- Agent versioning and updates

### 6. Observability & Evaluation
- Full run traces with timeline view (including multi-agent)
- Metrics: success rate, steps taken, cost, latency
- Token usage and cost tracking
- Human feedback / rating on runs
- LLM-as-judge evaluations

### 7. User System
- Authentication (email/password + JWT)
- User profiles
- Dashboard (my agents, my runs, earnings, credits)
- API keys and provider keys management

## Tech Stack

**Frontend**
- Next.js 15+ (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Beautiful, modern, dark-mode first UI
- Real-time streaming of agent runs (SSE)

**Backend**
- FastAPI + Python 3.11+
- SQLAlchemy + Alembic
- PostgreSQL (SQLite acceptable for development)
- LangGraph + LangChain as core agent orchestration
- Official MCP Python SDK (`langchain-mcp-adapters`)
- Docker for sandboxed execution
- Redis ready (optional for queues/caching)

## Architecture Principles

- Clean modular design: `API` / `Services` / `Agents` / `Core` / `Models` / `Schemas`
- Models split by domain for maintainability
- Fully typed (Pydantic + TypeScript)
- Easy to extend with new tools and agent patterns
- Production-leaning from the start (Alembic, Docker, security, logging)

## Quick Start

### Using Makefile (recommended for local development)
```bash
make install          # Install all deps
make dev              # Run backend + frontend
# Or separately: make dev-backend ## Quick Start## Quick Start make dev-frontend
```

### Manual

### Prerequisites
- Python 3.11+
- Node.js 18+
- Docker (recommended for sandbox execution)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set a strong SECRET_KEY and at least one LLM key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
# Ensure NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Docker Compose (recommended for full stack)
```bash
docker compose up --build
```

## Development Phases

1. **Foundation** — Project structure, database models (User, Agent, AgentVersion, Run, MarketplaceListing), authentication, basic CRUD for agents ✅
2. **Agent Builder + Runner** — Agent creation API + UI, LangGraph agent with tools, streaming run execution, trace storage and viewing ✅
3. **MCP + Advanced Runtime** — Full MCP integration, sandboxed code execution, improved planning/reflection/long-horizon capabilities, multi-agent support ✅
4. **Marketplace + Polish** — Publish / browse / clone, dashboard, UI/UX polish, evaluation features (ongoing)

## Project Structure

```
ai-agent-space/
├── backend/                 # FastAPI application
│   ├── app/
│   │   ├── api/v1/          # Route handlers
│   │   ├── agents/          # Runtime & graph builders
│   │   ├── core/            # Config, DB, security
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   └── services/        # Business logic (MCP, sandbox, memory, etc.)
│   ├── alembic/             # Migrations
│   └── requirements.txt
├── frontend/                # Next.js App Router
│   └── src/
│       ├── app/             # Pages
│       ├── components/      # UI components (AgentBuilder, etc.)
│       └── lib/             # API client, utils
├── agents/                  # Example agent YAML configs
├── docker-compose.yml
└── README.md
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Open source — see [LICENSE](LICENSE) file (MIT).

---

Built for the future of autonomous AI agents.

## Status

**v1.0.4** — Solid foundation complete with hardened health checks, auth tests, and improved dependency compatibility. Phases 1–3 implemented. Marketplace, dashboard, and evaluation features active. See [CHANGELOG.md](CHANGELOG.md).
