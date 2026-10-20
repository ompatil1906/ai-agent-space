# AI Agent Space

A modern, advanced platform for creating, configuring, running, and sharing AI agents with real tool use (MCP), streaming, memory, and multi-agent workflows.


## Advanced Features

- **Local / Open-Source Models**: Set `OPENAI_BASE_URL` (or per-agent `base_url`) to any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, etc.). Dummy API key works for local servers.
- **Memory Windowing**: `memory_config.max_messages` trims conversation history before each LLM call (default 20).
- **Multi-Agent Patterns**: single, sequential, supervisor, parallel, debate.
- **Streaming Events**: tokens, tool calls/results, and multi-agent step progress.
- **MCP Tool Discovery & Execution**: Real tool use via official MCP SDK + adapters.
- **Versioning, Evaluation, Marketplace**: Snapshots, LLM-as-judge, ratings, publish/clone/buy.

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\\Scripts\\activate` on Windows
pip install -r requirements.txt
cp .env.example .env  # set OPENAI_API_KEY and SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local  # set NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open http://localhost:3000

## Features
- **Auth**: JWT registration / login
- **Agent CRUD**: create, list, update, delete agents with system prompt, model, temperature
- **Agent Runner**: non-streaming and SSE streaming runs with tool-call events
- **MCP Integration**: discover and execute tools from real MCP servers (stdio / streamable_http / sse)
- **Marketplace**: publish, browse, search, clone, credit-based purchase (auto-clone)
- Multi-agent foundation (workflow_config: single / sequential / supervisor / **parallel**) with proper graph builders
- **Debate multi-agent**: Pro/Con specialists + impartial Judge for balanced analysis
- **Batch Evaluation**: `POST /api/v1/agents/{id}/evaluate/batch` with list of inputs
- Improved supervisor routing with stricter decision format for reliability
- **MCP Tool Preview**: Discover and preview available tools from MCP configs directly in the Agent Builder UI
- **Marketplace Ratings**: Rate published agents (1-5 + review), list ratings, average score
- Frontend: Login, Register, Agents (with publish/clone), Marketplace page, Agent runner with streaming
- **Versioning**: auto-snapshots on create/update, list, restore, manual snapshot
- **Evaluation Harness**: LLM-as-judge scoring endpoint (`POST /api/v1/agents/{id}/evaluate`)
- **Memory**: Thread-based conversation memory via LangGraph checkpointer (MemorySaver; PostgresSaver when DATABASE_URL is PostgreSQL)

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain (with streaming & memory)
- MCP: Official MCP Python SDK + langchain-mcp-adapters
- Database: SQLite (dev) → PostgreSQL ready
- Checkpointer: MemorySaver (dev) / PostgresSaver (prod)

## Recent Updates
- Enhanced Agent Runner: persistent event stream (tool calls, agent steps) stored in AgentRun.messages; richer live visualization with color-coded tool cards and multi-agent badges; conversation history dialog with full event inspection and thread continue
- Marketplace UI: ratings display (stars + avg + count), advanced filters (min rating, free/paid, sort by rating/price/name), and in-place rating modal
- Added **parallel multi-agent** workflow (concurrent specialists + synthesizer)
- Improved supervisor routing reliability with structured decision format
- Added marketplace **ratings** (1-5 stars + reviews, summary endpoint)
- Added production-ready checkpointer support (PostgresSaver fallback to MemorySaver)
- Added evaluation endpoint with LLM-as-judge
- Agent Versioning (auto-snapshots on create/update, list versions, restore, manual snapshot endpoints)
- **Agent Builder**: Structured visual builder for MCP tools (add/remove servers), memory settings, and multi-agent workflows (sequential / supervisor / parallel with dynamic sub-agents)
- Enhanced Agent Runner UI: live token streaming, tool call / tool result visualization, optional thread_id for conversation memory, conversation history list with one-click thread resume

## Next Priorities
1. ~~Ratings display in marketplace UI + advanced marketplace filters~~ (Done)
2. ~~Evaluation dashboard and batch evaluation harness~~ (Done: batch endpoint + basic)
3. ~~Agent editing UI with version restore in builder~~ (Done: Edit button + Versions dialog with restore)
4. Richer parallel patterns (map-reduce, debate) — Debate pattern added
5. ~~Conversation history UI improvements + deeper tool-call visualization~~ (Done: persisted event stream in runs + rich live + history dialog with tool activity)
6. Evaluation results persistence + dashboard charts
7. Structured outputs / function calling reliability improvements

## Architecture Notes
- Clean modular design: models / schemas / api / agents / services
- Streaming via SSE using sse-starlette
- Memory via LangGraph checkpointer (thread_id); switches to PostgresSaver for PostgreSQL DATABASE_URL
- MCP tools loaded dynamically and bound via ToolNode
- tools_config format example:
  ```json
  [
    {
      "name": "example",
      "transport": "stdio",
      "command": "python",
      "args": ["examples/example_mcp_server.py"]
    },
    {
      "name": "remote",
      "transport": "streamable_http",
      "url": "http://localhost:8001/mcp"
    }
  ]
  ```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for step-by-step instructions:
- **Frontend on Vercel**: Connect repo, set root directory to `frontend`, set `NEXT_PUBLIC_API_URL`.
- **Backend on Render**: 1-click deploy via [`render.yaml`](render.yaml) (FastAPI + PostgreSQL).
- **Backend on Railway**: Deploy via [`railway.json`](railway.json) & [`backend/Dockerfile`](backend/Dockerfile).
- **Self-Hosted / Local Docker**: Run `docker compose up --build`.
- **CI/CD**: Automated GitHub Actions workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Database Schema Note
New fields (credits, workflow_config, versions) were added. For existing SQLite DBs, delete `backend/*.db` (or the app.db) and restart the backend so create_all rebuilds tables. Fresh installs work immediately.

## Advanced Enhancements (Latest)

- **Alembic Migrations**: Production-ready schema management. See `backend/alembic/`.
  - Generate: `cd backend && alembic revision --autogenerate -m "description"`
  - Apply: `alembic upgrade head`
- **MCP Depth**: 
  - `/api/v1/agents/mcp/validate` — validate configs
  - `/api/v1/agents/mcp/health` — health check against MCP servers
  - Richer tool discovery with input schemas
- **Usage Metering**: 1 credit deducted per agent run (non-stream and stream).
- **Test Suite**: `cd backend && pytest tests/`
- Multi-agent streaming events, memory windowing, and versioning remain fully supported.

## Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

## Migrations

For existing deployments, run migrations instead of deleting the DB:

```bash
cd backend
alembic upgrade head
```
