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
- **Real MCP integration** via langchain-mcp-adapters:
  - stdio, streamable_http, and sse transports
  - Tool discovery and automatic LangChain tool binding
  - Tools injected into LangGraph ToolNode
  - Discover tools API for the builder UI
- Frontend: Login, Register, Agents list + create (with MCP tools_config JSON + Discover), Agent run page with streaming toggle

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain (with streaming & memory)
- MCP: Official MCP Python SDK + langchain-mcp-adapters
- Database: SQLite (dev) → PostgreSQL ready

## Next Priorities
1. Agent Builder UI improvements (visual MCP server config, memory settings)
2. Marketplace (publish, browse, clone, simple buy/sell)
3. Multi-agent workflows & orchestration
4. Persistent checkpointer (Postgres) + evaluation
5. Advanced memory and versioning

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
