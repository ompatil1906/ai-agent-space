# Changelog
## [1.0.15] - 2026-10-28
### Changed
- MCP page rebrand: the primary nav label for `/mcp-servers` is now "MCP" and the page title reads "MCP Connections" (was "Tools" / "Tool Connections")
### Added
- Live Web Researcher: demo-ready published agent wired to the official Tavily MCP server (`npx tavily-mcp` via server_id reference). The seed script registers "Tavily Search" (`TAVILY_API_KEY` read from env/backend/.env) and ships the agent with a search-first, cite-sources system prompt; reference config exported to `agents/tavily_research_agent.yaml`
- Tavily brand logo: official `tavily-mark-black.svg` path vendored into `brand-icons.ts` (55×55 viewBox support added to `BrandIcon` + `McpLogo`), catalog entry and the seeded "Tavily Search" server now carry `logo_slug: "tavily"`
### Fixed
- `mcp_service.discover_tools` crashed with `AttributeError: 'NoneType' object has no attribute 'get'` on tools whose adapter metadata is `None` (first hit by tavily-mcp)
- MCP stdio spawn failing with `[Errno 2] No such file or directory` (e.g. `npx -y tavily-mcp`) when the backend is launched from a GUI/IDE/non-login shell whose `PATH` lacks Homebrew/nvm Node locations: stdio servers now spawn with a robust child env (conservative variable allowlist + well-known Node bin dirs grafted onto `PATH`, verified healthy under a bare `/usr/bin:/bin` PATH); config `env` values win, and empty-string placeholders no longer clobber an inherited key

## [1.0.14] - 2026-10-26
### Changed
- Marketplace declutter: all five filters (sort / category / pricing / minimum rating / featured) moved out of the inline toolbar into a single "Filters" button; the popover shows labeled selects with friendly option labels, a featured Switch, and a disabled-when-clean "Clear all filters" action
- Active filters render as removable chips next to the Filters button, and the button shows an active-count badge; the empty state now keys off the filter count
- Agent builder: the "Execution & Autonomy" panel (max steps, autonomy level, max reflections, sandbox, planning, reflection, structured output, Agent-as-Tool binding, tool choice) is collapsed behind an "Advanced settings" disclosure by default, with a summary line and an "N active" badge when any non-default feature is in use
- Builder autonomy select now derives its display label via Base UI `items` instead of showing the raw enum value

## [1.0.13] - 2026-10-26
### Fixed
- Marketplace leaderboard showed raw creator emails; the endpoint now exposes `owner_display_name` (creator profile display name with email fallback) and the leaderboard row uses it
- Landing page "Meet the agents" block latched the StrictMode fetch-abort as a permanent error ("signal is aborted without reason"); AbortError is now ignored and a successful load clears the error state
### Added
- Showcase seed verified end-to-end in the live app (marketplace, landing, listing pages, purchases, earnings, admin orders/payouts/reports/audit, MCP tools) — every money figure cross-checks against the auditable ledger

## [1.0.12] - 2026-10-26
### Fixed
- Runtime crash when opening the account dropdown or admin row Actions menu: `DropdownMenuLabel` (`Menu.GroupLabel`) is now wrapped in `Menu.Group` in the site header and admin console ("MenuGroupContext is missing")
- Base UI Button semantics: `nativeButton` defaults to `false` whenever the button renders a custom element (e.g. Next `Link`), removing repeated console errors from header link buttons
- Marketplace logo aspect-ratio distortion: chip container enlarged from `size-7` to `size-8` in the site header and footer so the 20px icon fits its content box
- Unused-preload console warning: removed the deprecated `priority` preload on the header logo (login/register keep the Next `preload` API)
- Publish dialog copy no longer claims moderation review when the platform publishes immediately (`MARKETPLACE_MODERATION=off`); confirm button renamed to "Publish listing"
- Lint hygiene: removed unused imports, replaced `window.location.href` with `router.push` for header logout, added async boundaries for setState within effects

### Added
- `backend/scripts/seed_showcase.py`: temporary demo/showcase dataset — 8 marketplace-ready agents with full listing payloads, pricing plans (free / one_time / subscription / pay_per_execution), verified ratings & reviews, mock-gateway-marked payments, purchases with real commission splits, active subscriptions, run history, evaluations, Showcase MCP servers, one processed partial refund, a paid + a pending payout, and admin audit entries. `--purge` removes only showcase-marked data and never touches real accounts or the RT Checker agent.

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

