# Changelog

## [1.0.0] - 2026-10-24

### Added
- Solid foundation: modular project structure, domain-split SQLAlchemy models, JWT authentication, basic agent CRUD
- Agent Builder with visual + YAML support and multi-agent workflow patterns
- LangGraph-based runtime with ReAct, Plan-and-Execute, Reflexion, and advanced multi-agent graphs
- Full MCP integration (stdio, SSE, streamable HTTP) with tool/resource/prompt discovery
- Docker-based sandboxed code execution with resource limits
- Marketplace (publish, browse, clone, ratings, credits)
- Observability: run traces, token/cost tracking, evaluations, dashboard
- Streaming agent runs via SSE
- Provider keys and API key management

### Changed
- Professionalized README with clear architecture, phases, and setup instructions
- Improved API root and health endpoints with versioning
- Cleaner logging configuration

### Fixed
- Various stability and typing improvements across models and services

## [0.x] - Earlier
- Initial scaffolding and iterative feature development

## [1.0.1] - 2026-10-24
### Added
- Basic pytest suite for authentication foundation (register, login, me, health)
- Improved testability for Phase 1
