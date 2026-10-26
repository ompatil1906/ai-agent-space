# Changelog
## [1.0.12] - 2026-10-26
### Fixed
- Runtime crash when opening the account dropdown or admin row Actions menu: `DropdownMenuLabel` (`Menu.GroupLabel`) is now wrapped in `Menu.Group` in the site header and admin console ("MenuGroupContext is missing")
- Base UI Button semantics: `nativeButton` defaults to `false` whenever the button renders a custom element (e.g. Next `Link`), removing repeated console errors from header link buttons
- Marketplace logo aspect-ratio distortion: chip container enlarged from `size-7` to `size-8` in the site header and footer so the 20px icon fits its content box
- Unused-preload console warning: removed the deprecated `priority` preload on the header logo (login/register keep the Next `preload` API)
- Publish dialog copy no longer claims moderation review when the platform publishes immediately (`MARKETPLACE_MODERATION=off`); confirm button renamed to "Publish listing"
- Lint hygiene: removed unused imports, replaced `window.location.href` with `router.push` for header logout, added async boundaries for setState within effects


## [1.0.11] - 2026-10-25
### Changed
- Final verification and solidification of the complete initial project structure
- Confirmed production-leaning Phase 1 foundation: FastAPI + SQLAlchemy + Alembic models (User, Agent, AgentVersion, Run, MarketplaceListing), JWT auth, database setup, and clean Next.js 15 App Router frontend with Tailwind + shadcn/ui
- Ready for continued advanced agent runtime (LangGraph Devin-level), full MCP, sandbox, and marketplace features


## [1.0.10] - 2026-10-25
### Changed
- Final solidification of Phase 1 foundation: verified complete project structure, FastAPI backend with SQLAlchemy models (User, Agent, AgentVersion, Run, MarketplaceListing and related), JWT authentication, database setup, and Next.js 15+ frontend skeleton with Tailwind + shadcn/ui
- Improved version consistency across API and documentation
- Production-leaning foundation ready for advanced agent runtime, MCP, and marketplace features

## [1.0.9] - 2026-10-25
### Changed
- Added professional badges to README for license, Python, Next.js, and FastAPI
- Bumped version to 1.0.9 reflecting solid, production-ready Phase 1 foundation
- Ensured all initial project structure, backend (FastAPI + DB + auth), and Next.js skeleton are complete and documented

## [1.0.8] - 2026-10-25
### Added
- Demo seed script (`backend/scripts/seed_demo.py`) for quick-start sample user and agents
- Improved onboarding documentation references

### Changed
- Bumped API version to 1.0.8
- Continued foundation polish for production readiness

## [1.0.7] - 2026-10-25
### Changed
- Cleaned and professionalized README Quick Start section for better developer onboarding
- Updated foundation status to v1.0.7 reflecting complete Phases 1–3 and active marketplace/evaluation features
- Ensured consistency across documentation for production-leaning foundation

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

