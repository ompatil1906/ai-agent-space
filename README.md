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

## Features Implemented
- JWT Auth (register / login / me)
- Agent CRUD (create, list, get, update, delete)
- Agent run history persistence
- LangGraph agent runtime with **streaming (SSE)** and conversation memory (MemorySaver checkpointer)
- MCP service foundation (tool discovery/execution ready)
- Frontend: Login, Register, Agents list + create, Agent run page with streaming toggle

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain (with streaming & memory)
- MCP: Official MCP Python SDK (integration foundation ready)
- Database: SQLite (dev) → PostgreSQL ready

## Next Priorities
1. Full real MCP tool discovery + execution (stdio/HTTP transports)
2. Agent Builder UI improvements (tools config, memory settings)
3. Marketplace (publish, browse, clone, simple buy/sell)
4. Multi-agent workflows & orchestration
5. Persistent checkpointer (Postgres) + evaluation

## Architecture Notes
- Clean modular design: models / schemas / api / agents / services
- Streaming via SSE using sse-starlette
- Memory via LangGraph checkpointer (thread_id)
- MCP tools will be injected into LangGraph ToolNode
