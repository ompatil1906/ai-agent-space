# AI Agent Space

A modern, advanced platform for creating, configuring, running, and sharing AI agents with real tool use (MCP), streaming, memory, and multi-agent workflows.

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set OPENAI_API_KEY (and SECRET_KEY)
uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### Example MCP Server
```bash
cd backend
python examples/example_mcp_server.py
# Or use it via stdio in agent tools_config
```

## Features Implemented
- JWT Auth (register / login / me)
- Agent CRUD (create, list, get, update, delete)
- Agent run history persistence
- LangGraph agent runtime with **streaming (SSE)** and conversation memory (MemorySaver checkpointer)
- **Real MCP integration** via langchain-mcp-adapters (stdio / http / sse)
- **Marketplace**: publish, browse, search, clone, credit-based purchase (auto-clone)
- Multi-agent foundation (workflow_config: single / sequential / supervisor) with proper graph builders
- Frontend: Login, Register, Agents (with publish/clone), Marketplace page, Agent runner with streaming

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain (with streaming & memory)
- MCP: Official MCP Python SDK + langchain-mcp-adapters
- Database: SQLite (dev) → PostgreSQL ready

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

See [DEPLOYMENT.md](file:///Users/ompatil/Om/Projects/ai-agent-space/DEPLOYMENT.md) for step-by-step instructions:
- **Frontend on Vercel**: Connect repo, set root directory to `frontend`, set `NEXT_PUBLIC_API_URL`.
- **Backend on Render**: 1-click deploy via [`render.yaml`](file:///Users/ompatil/Om/Projects/ai-agent-space/render.yaml) (FastAPI + PostgreSQL).
- **Backend on Railway**: Deploy via [`railway.json`](file:///Users/ompatil/Om/Projects/ai-agent-space/railway.json) & [`backend/Dockerfile`](file:///Users/ompatil/Om/Projects/ai-agent-space/backend/Dockerfile).
- **Self-Hosted / Local Docker**: Run `docker compose up --build`.
- **CI/CD**: Automated GitHub Actions workflow in [`.github/workflows/ci.yml`](file:///Users/ompatil/Om/Projects/ai-agent-space/.github/workflows/ci.yml).

## Database Schema Note
New fields (credits, workflow_config) were added. For existing SQLite DBs, delete `backend/*.db` (or the app.db) and restart the backend so create_all rebuilds tables. Fresh installs work immediately.
