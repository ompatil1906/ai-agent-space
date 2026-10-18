# AI Agent Space

A modern platform for creating, configuring, running, and sharing AI agents with real tool use (MCP), streaming, and multi-agent workflows.

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
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
- Basic LangGraph agent runtime
- Agent run endpoint
- Frontend: Login, Register, Agents list + create, Agent run page

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain
- MCP: Official MCP Python SDK (integration in progress)

## Next Priorities
1. Streaming responses (SSE)
2. Real MCP tool discovery + execution
3. Agent memory (checkpointer)
4. Marketplace (publish, browse, clone)
5. Multi-agent workflows
