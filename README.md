# AI Agent Space

**AI Agent Space** is an open-source platform for creating, configuring, running, evaluating, publishing, discovering, and sharing powerful autonomous AI agents.

Build Devin-level agents with long-horizon planning, multi-step reasoning, tool use (including full MCP support), code execution in secure sandboxes, self-reflection, multi-agent collaboration, and more.

## Core Vision

The place where the best autonomous agents live and are shared. Users can:

- Build highly capable single-agent or multi-agent systems
- Equip them with real tools via the Model Context Protocol (MCP)
- Run them in secure Docker sandboxes
- Observe full traces (thoughts, actions, tool calls, results)
- Publish agents to a marketplace
- Clone, fork, rate, and monetize agents
- Evaluate performance with LLM-as-judge and metrics

## Key Features

### Agent Builder
- Visual + code/YAML configuration
- Define name, description, system prompt, tools, MCP servers, memory, model, temperature, max steps, autonomy level
- Support for single agents and multi-agent patterns: sequential, supervisor, parallel, debate, hierarchical, ensemble, group chat, swarm, critique-revise, plan-and-execute, and more
- Agent versioning with snapshots

### Powerful Agent Runtime
- LangGraph + LangChain orchestration
- ReAct, Plan-and-Execute, Reflexion-style loops
- Full tool calling with MCP tools, resources, and prompts
- Sandboxed code interpreter + terminal (Docker)
- File system operations
- Self-reflection and error recovery
- Streaming of thoughts, actions, and observations (SSE)
- Short-term and long-term memory (with shared team memory)
- Confidence estimation and human-in-the-loop approvals
- Multi-provider LLM support (OpenAI, Anthropic Claude, Google Gemini, and compatible endpoints)

### Real MCP Support
- Connect to any MCP server (stdio, SSE, streamable HTTP)
- Auto-discover tools, resources, and prompts
- Seamless use inside agents
- MCP Server Registry for reusable configurations

### Secure Execution
- Docker-based sandbox per run
- CPU/memory/time limits
- Network controls
- Safe code execution

### Marketplace
- Publish agents (public / unlisted / private)
- Browse, search, and filter
- One-click clone
- Ratings, reviews, usage stats
- Credit system foundation
- Versioning and updates

### Observability & Evaluation
- Full run traces and timeline views (including multi-agent)
- Token usage and cost tracking
- Metrics: success, steps, latency, cost
- LLM-as-judge evaluations
- Human feedback

### User System
- Email/password authentication with JWT
- User profiles and dashboard
- API keys and provider keys management
- Credits and transaction history

## Tech Stack

**Frontend**
- Next.js 15+ (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Dark-mode first, modern UI
- Real-time streaming of agent runs

**Backend**
- FastAPI + Python 3.11+
- SQLAlchemy + Alembic
- PostgreSQL (SQLite for development)
- LangGraph + LangChain
- Official MCP Python SDK
- Docker for sandboxed execution
- Redis ready (optional)

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Docker (recommended for sandbox)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set SECRET_KEY, and at least one of OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Docker Compose (optional)
See `docker-compose.yml` for a full stack including database.

## Development Phases

1. **Foundation** — Project structure, models, auth, basic CRUD ✅
2. **Agent Builder + Runner** — Creation UI, LangGraph runtime, streaming, traces ✅
3. **MCP + Advanced Runtime** — Full MCP, sandboxed execution, planning/reflection, multi-agent ✅
4. **Marketplace + Polish** — Publish/browse/clone, dashboard, evaluation, UI polish (ongoing)

## Architecture

- Clean modular design: API / Services / Agents / Core / Models
- Models split by domain (user, agent, run, marketplace, mcp) for maintainability
- Fully typed with Pydantic schemas
- Easy to extend with new tools and agent patterns
- Production-leaning with Alembic migrations, Docker Compose, and security best practices

## Contributing

Contributions are welcome! Please open an issue or pull request.

## License

Open source — see [LICENSE](LICENSE) file.

---

Built for the future of autonomous AI agents.
