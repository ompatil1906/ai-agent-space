# AI Agent Space

A modern, advanced platform for creating, configuring, running, and sharing AI agents with real tool use (MCP), streaming, memory, and multi-agent workflows.

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
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
- Multi-agent foundation (workflow_config: single / sequential / supervisor) with proper graph builders
- Frontend: Login, Register, Agents (with publish/clone), Marketplace page, Agent runner with streaming

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain (with streaming & memory)
- MCP: Official MCP Python SDK + langchain-mcp-adapters
- Database: SQLite (dev) → PostgreSQL ready

## Recent Updates
- Added Agent Versioning (auto-snapshots on create/update, list versions, restore, manual snapshot endpoints)
- Enhanced Agent Runner UI: live token streaming, tool call / tool result visualization, optional thread_id for conversation memory

## Next Priorities
1. Visual Agent Builder (drag-drop MCP config, memory settings UI)
2. Persistent checkpointer (PostgresSaver) + evaluation harness
3. Agent versioning, ratings, and advanced marketplace features
4. Deeper tool-call visualization + conversation history UI
5. Parallel multi-agent and richer supervisor routing

## Architecture Notes
- Clean modular design: models / schemas / api / agents / services
- Streaming via SSE using sse-starlette
- Memory via LangGraph checkpointer (thread_id)
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
New fields (credits, workflow_config) were added. For existing SQLite DBs, delete `backend/*.db` (or the app.db) and restart the backend so create_all rebuilds tables. Fresh installs work immediately.
