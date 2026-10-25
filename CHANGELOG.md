# Changelog
## [1.0.6] - 2026-10-25
### Added
- Complete Phase 1 foundation solidification: robust database models (User, Agent, AgentVersion, Run, MarketplaceListing), JWT authentication, Alembic-ready migrations, and professional project structure
- Enhanced health check and logging for production readiness
- Full support for Next.js 15+ App Router frontend skeleton with Tailwind + shadcn/ui

### Changed
- Bumped API version to 1.0.6
- Improved overall foundation quality for autonomous agent platform
## [1.0.5] - 2026-10-25
### Changed
- Bumped API version to 1.0.5 for continued foundation polish
- Enhanced readiness for production deployment of Phase 1 foundation


## [1.0.4] - 2026-10-25
### Changed
- Bumped API version to 1.0.4
- Strengthened foundation documentation and versioning for production readiness
- Ensured clean project structure alignment with Phase 1 requirements

## [1.0.3] - 2026-10-24
### Added
- Professional Makefile for easy foundation setup, install, dev, test, and Docker commands
- Improved developer experience for Phase 1 onboarding

### Changed
- README Quick Start now highlights Makefile as recommended path

## [1.0.2] - 2026-10-24
### Added
- Professional .env.example with all required configuration variables for backend, LLM providers, CORS, sandbox, and frontend
- Clear documentation for environment setup to make the foundation easier to run locally or deploy

### Fixed
- Relaxed ormsgpack pin to >=1.12.2 to support Python 3.10/3.11 environments (1.13.0 dropped 3.10 support)
- Improved dependency installability for the foundation

### Changed
- Foundation strengthened for broader compatibility and easier onboarding/production readiness

## [1.0.1] - 2026-10-24
### Added
- Basic pytest suite for authentication foundation (register, login, me, health)
- Improved testability for Phase 1
- Database connectivity verification in `/health` endpoint

### Changed
- Foundation hardened for reliability

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

## [1.0.7] - 2026-10-25
### Enhanced
- Strengthened PLANNING_DIRECTIVE in agent runtime for better long-horizon planning, reflection, and Devin-inspired operating procedure
- Improved default system prompt guidance for autonomy levels
- Minor documentation and version consistency updates
