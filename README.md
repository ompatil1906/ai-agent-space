## Latest Observability Enhancement
- **Live Token & Cost Tracking in Agent Runner**: During and after streaming runs, the agent page now displays exact input/output/total tokens and estimated USD cost (from the `done` event usage payload). Falls back to approximate token count from output length while streaming. Complements the dashboard cost analytics.
- **Richer Multi-Agent Timeline**: Timeline now groups tool calls, tool results, confidence, and reflections per agent (or tools bucket), with clearer icons and more context.


## Latest Observability Enhancement
- **Token Usage & Cost Analytics**: Dashboard now aggregates total input/output tokens, estimated USD cost, and average cost per run from all AgentRun records. Provides clear cost visibility for multi-agent and long-running workflows.

## Advanced Session Update (Agent Builder Polish)
## Latest Session Progress
- Added MultiAgentTimeline component for clearer live multi-agent activity visualization during runs.
- Integrated into agent run page to show per-agent steps alongside the existing event stream.
- Improves observability for supervisor, hierarchical, debate, plan-execute, and other multi-agent patterns.

- Fixed critical JSX syntax error in AgentBuilder workflow type Select (plan_execute item was nested incorrectly).
- Expanded starter templates: added Plan-Execute Researcher and Hierarchical Research Team with pre-filled sub-agents/teams.
- Template selector now correctly applies sub-agents / specialists for multi-agent workflows.
- **Agent Knowledge Base / Document RAG**: Users can upload text documents to an agent's knowledge base. Documents are chunked, embedded (Chroma + OpenAI embeddings), and stored with type=knowledge.
- New endpoints:
  - `POST /api/v1/agents/{id}/knowledge` — add document text
  - `GET /api/v1/agents/{id}/knowledge` — list sources and chunks
  - `DELETE /api/v1/agents/{id}/knowledge/{source_name}` — remove a source
- Knowledge excerpts are automatically retrieved and injected into the system prompt (alongside long-term memories) when `memory_config.longterm_enabled` is true.
- Frontend: Knowledge Base card on the agent run page with paste-to-add UI, source listing, and delete.
- Fixed duplicate `store_interaction_memory` definition in the agent runtime.


## Advanced Session Update (Memory Consolidation)
- **Long-term Memory Consolidation**: New `POST /api/v1/agents/{id}/memories/consolidate` endpoint. Summarizes raw memories into denser consolidated entries using the LLM. UI button available on the agent run page. Helps keep retrieval focused and token-efficient for long-running agents.
- Fixed critical bug in `LongTermMemoryService.delete_memory` (method was incorrectly placed outside the class).

## Critical Fix (2026-10-22)
- Fixed missing `CreditTransaction` SQLAlchemy model class (was causing import/relationship errors).
- Added `GET /api/v1/marketplace/me/transactions` for credit ledger history.


- **Human-in-the-Loop Tool Approval**: Supervised agents pause on tool calls and emit `approval_required` events. Approvals are persisted in the `tool_approvals` table (multi-process and restart-safe). The UI shows Approve/Deny; the backend polls the DB and resumes. `GET /api/v1/agents/approvals/pending` lists open requests.
- **API Keys for Programmatic Access**: Create scoped API keys (`ask_...`) via `/api/v1/api-keys`. Use them as Bearer tokens to invoke agents (run / stream) without a user JWT. Keys can be optionally restricted to a single agent, have expiration, and are revocable. Raw key is shown only once on creation. Dashboard includes a management UI.
- **Multi-turn Conversations**: Persistent thread_id on runs, automatic thread continuity via LangGraph checkpointer, chat UI with history, New Chat / load previous threads.

- **Structured Outputs & Reliable Function Calling**: Optional JSON Schema enforcement on final answers via `advanced_config.structured_output_enabled` + `output_schema`. Tool errors are caught and returned to the LLM for recovery. `tool_choice` (auto/required/none) supported.
- **Token Usage & Cost Tracking**: Every agent run (streaming and non-streaming) records `input_tokens`, `output_tokens`, `total_tokens`, and an estimated USD cost based on model pricing. Available on the run record, streaming `done` event, and user dashboard recent runs.\n# AI Agent Space

A modern, advanced platform for creating, configuring, running, and sharing AI agents with real tool use (MCP), streaming, memory, and multi-agent workflows.



## Recent Enhancements (Advanced Session)

- **MCP Server Registry**: Users can register reusable MCP server configurations (stdio / HTTP / SSE). Agents can reference them by `server_id` (resolved at runtime) or via the builder UI. Full CRUD + validate/discover endpoints at `/api/v1/mcp-servers`. Dedicated management page at `/mcp-servers`.


- **Workflow Visualizer**: Interactive tree/card view of multi-agent workflows (supervisor, hierarchical, parallel, debate, consensus, map-reduce, sequential) directly on the agent run page. Supports nested teams.
- **Granular Memory Management**: Individual long-term memory deletion via `DELETE /api/v1/agents/{id}/memories/{memory_id}` plus UI delete buttons. Complements existing list/clear endpoints.

## Advanced Features

- **Local / Open-Source Models**: Set `OPENAI_BASE_URL` (or per-agent `base_url`) to any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, etc.). Dummy API key works for local servers.
- **Memory Windowing**: `memory_config.max_messages` trims conversation history before each LLM call (default 20).
- **Long-Term Semantic Memory**: Optional vector-store memory (ChromaDB + embeddings). Set `memory_config.longterm_enabled=true` and `longterm_k` (default 5). Relevant past interactions are retrieved and injected into the system prompt. Interactions are automatically stored after each run.\n- **Shared Multi-Agent Memory**: Set `memory_config.shared=true` (requires long-term memory) to store/retrieve memories under a team namespace (`team_{agent_id}`). All specialists in hierarchical/supervisor workflows can read and write the same memory. Dedicated tools `store_shared_memory` / `retrieve_shared_memory` are automatically available.
- **Long-Term Memory Management**: `GET /api/v1/agents/{id}/memories` to list stored semantic memories; existing clear endpoint for cleanup. Memories are scoped per user+agent.
- **Multi-Agent Patterns**: single, sequential, supervisor, parallel, debate, map-reduce, hierarchical (manager → teams with nested workflows), and consensus (independent specialists + consensus synthesizer). All workers/specialists are full ReAct tool-using subgraphs (MCP + sandbox + optional reflection). Visual builder supports nested teams for hierarchical.
- **Streaming Events**: tokens, thoughts (planning/reasoning), tool calls/results, and multi-agent step progress.
- **MCP Tool, Resource & Prompt Discovery**: Real tool use via official MCP SDK + adapters. Agents also receive live `list_mcp_resources`, `read_mcp_resource`, `list_mcp_prompts`, and `get_mcp_prompt` tools. Builder UI can preview tools, resources, and prompts.
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
- **MCP Integration**: discover and execute tools from real MCP servers (stdio / streamable_http / sse). Agents automatically receive meta-tools to list/read MCP resources and prompts at runtime. Builder supports preview of tools, resources, and prompts.
- **Marketplace**: publish, browse, search, clone, credit-based purchase (auto-clone)
- Multi-agent foundation (workflow_config: single / sequential / supervisor / parallel / debate / map_reduce / hierarchical) with proper graph builders. Hierarchical visual editor supports nested team workflows.
- **Debate multi-agent**: Pro/Con specialists + impartial Judge for balanced analysis
- **Batch Evaluation**: `POST /api/v1/agents/{id}/evaluate/batch` with list of inputs
- Improved supervisor routing with stricter decision format for reliability
- **MCP Tool Preview**: Discover and preview available tools from MCP configs directly in the Agent Builder UI
- **Marketplace Ratings**: Rate published agents (1-5 + review), list ratings, average score
- Frontend: Login, Register, Agents (with publish/clone), Marketplace page, Agent runner with streaming
- **Versioning**: auto-snapshots on create/update, list, restore, manual snapshot. Dedicated UI at `/agents/[id]/versions` for history, details, and restore.
- **Evaluation Harness**: LLM-as-judge scoring endpoint (`POST /api/v1/agents/{id}/evaluate`)
- **Memory**: Thread-based conversation memory via LangGraph checkpointer (MemorySaver; PostgresSaver when DATABASE_URL is PostgreSQL)


## Multi-Provider LLM Support
- Agents can use OpenAI models (gpt-*) by default.
- Claude models (claude-*) are supported when `ANTHROPIC_API_KEY` is set (requires `langchain-anthropic`).
- Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, Together, etc.) via `OPENAI_BASE_URL` or per-agent `base_url`.
- Provider is auto-detected from the model name prefix.

## Tech Stack
- Frontend: Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Backend: FastAPI + SQLAlchemy + Pydantic
- Agent Runtime: LangGraph + LangChain (with streaming & memory)
- MCP: Official MCP Python SDK + langchain-mcp-adapters
- Database: SQLite (dev) → PostgreSQL ready
- Checkpointer: MemorySaver (dev) / PostgresSaver (prod)

## Recent Updates
- **API Keys**: Programmatic access to agents via revocable Bearer keys (ask_...). Managed in dashboard.

- **Map-Reduce multi-agent**: Fan-out to specialist mappers then reduce/synthesize (workflow_config.type = "map_reduce")
- **Evaluation Persistence**: All evaluate / batch results stored in agent_evaluations; summary + history endpoints
- **Evaluation Dashboard**: Frontend page at /agents/[id]/evaluations with average score, trend bars, and run-new form
- Marketplace UI: ratings display (stars + avg + count), advanced filters (min rating, free/paid, sort by rating/price/name), and in-place rating modal
- Added **parallel multi-agent** workflow (concurrent specialists + synthesizer)
- Improved supervisor routing reliability with structured decision format
- Added marketplace **ratings** (1-5 stars + reviews, summary endpoint)
- Added production-ready checkpointer support (PostgresSaver fallback to MemorySaver)
- Added evaluation endpoint with LLM-as-judge
- Agent Versioning (auto-snapshots on create/update, list versions, restore, manual snapshot endpoints)
- **Agent Builder**: Structured visual builder for MCP tools (add/remove servers), memory settings, and multi-agent workflows (sequential / supervisor / parallel with dynamic sub-agents)
- Enhanced Agent Runner UI: live token streaming, tool call / tool result visualization, optional thread_id for conversation memory, conversation history list with one-click thread resume

## Agent-as-Tool (Nested Agent Invocation)
- Agents can bind other owned or public agents as callable tools via `advanced_config.agent_tool_ids`.
- In the Agent Builder, select agents under "Agent-as-Tool".
- Runtime creates LangChain tools that invoke the target agent (isolated thread, final output only).
- Hard nesting depth limit of 3 to prevent infinite recursion.
- Nested runs appear as normal tool calls / results in the parent stream.

## Next Priorities
1. ~~Ratings display in marketplace UI + advanced marketplace filters~~ (Done)
2. ~~Evaluation dashboard and batch evaluation harness~~ (Done: batch endpoint + basic)
3. ~~Agent editing UI with version restore in builder~~ (Done: Edit button + Versions dialog with restore)
4. ~~Richer parallel patterns (map-reduce, debate)~~ (Done: debate + map-reduce)
5. ~~Conversation history UI improvements + deeper tool-call visualization~~ (Done: persisted event stream in runs + rich live + history dialog with tool activity)
6. ~~Evaluation results persistence + dashboard charts~~ (Done: AgentEvaluation model, summary endpoint, dashboard with trend bars)
7. ~~Structured outputs / function calling reliability improvements~~ (Done: JSON Schema finalizer + reliable tool error recovery + tool_choice)
8. ~~True parallel map-reduce with LangGraph Send API~~ (Done: Send-based concurrent fan-out + reducer)
9. ~~Advanced memory (vector store / long-term)~~ (Done: ChromaDB semantic memory with retrieval + auto-store)

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
