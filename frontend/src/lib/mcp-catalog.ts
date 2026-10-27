/**
 * Catalog of famous MCP servers for the Registry "Connect" gallery.
 *
 * Configs mirror the backend's `_normalize_connection` contract:
 * - stdio: {transport, command, args, env?}
 * - streamable_http / sse: {transport, url, headers?}
 *
 * Icons use the simple-icons CDN slug (`icon.slug`); entries without a brand
 * icon fall back to a monogram in `icon.color`.
 */

export interface MCPCatalogEnvVar {
  name: string;
  hint: string;
}

export interface MCPCatalogEntry {
  slug: string;
  name: string;
  category: "demo" | "dev-tools" | "data" | "productivity" | "search" | "web" | "design";
  description: string;
  transport: "stdio" | "streamable_http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: MCPCatalogEnvVar[];
  requiresAuth?: boolean; // hosted servers that grant access via vendor OAuth flow
  icon: { slug?: string; color: string };
  official?: boolean;
}

export const CATEGORIES = [
  "all",
  "demo",
  "dev-tools",
  "data",
  "productivity",
  "search",
  "web",
  "design",
] as const;

export const MCP_CATALOG: MCPCatalogEntry[] = [
  {
    slug: "everything",
    name: "Everything",
    category: "demo",
    description:
      "Official demo server exposing a toolbox of sample tools — perfect for instantly trying the MCP pipeline with zero setup or secrets.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    icon: { color: "#6366f1" },
    official: true,
  },
  {
    slug: "filesystem",
    name: "Filesystem",
    category: "dev-tools",
    description:
      "Read, write, search, and move files inside a sandboxed directory. Give your agent hands on a real codebase or dataset folder.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    icon: { color: "#2563eb" },
    official: true,
  },
  {
    slug: "git",
    name: "Git",
    category: "dev-tools",
    description:
      "Read and operate on Git repositories — status, diffs, logs, commits. Essential for code-agent workflows.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "."],
    icon: { slug: "git", color: "#f05133" },
    official: true,
  },
  {
    slug: "github",
    name: "GitHub",
    category: "dev-tools",
    description:
      "Manage issues, PRs, repos, and files on GitHub. Create a personal access token and paste it below.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiredEnv: [
      { name: "GITHUB_PERSONAL_ACCESS_TOKEN", hint: "ghp_… token with repo scope" },
    ],
    icon: { slug: "github", color: "#181717" },
    official: true,
  },
  {
    slug: "postgres",
    name: "Postgres",
    category: "data",
    description:
      "Schema inspection and read-only SQL queries against a PostgreSQL database.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/postgres"],
    icon: { slug: "postgresql", color: "#4169e1" },
    official: true,
  },
  {
    slug: "sqlite",
    name: "SQLite",
    category: "data",
    description:
      "Query and analyze local SQLite databases with built-in business-intelligence tools.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "data.db"],
    icon: { slug: "sqlite", color: "#003b57" },
    official: true,
  },
  {
    slug: "memory",
    name: "Memory",
    category: "dev-tools",
    description:
      "Persistent knowledge-graph memory the agent can recall across runs and sessions.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    icon: { color: "#7c3aed" },
    official: true,
  },
  {
    slug: "sequential-thinking",
    name: "Sequential Thinking",
    category: "dev-tools",
    description:
      "Structured reasoning tool — lets the agent think through problems dynamically and revise conclusions.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    icon: { color: "#64748b" },
    official: true,
  },
  {
    slug: "fetch",
    name: "Fetch",
    category: "web",
    description:
      "Fetch and extract content from any web page for reading, summarizing, and research.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    icon: { color: "#0ea5e9" },
    official: true,
  },
  {
    slug: "brave-search",
    name: "Brave Search",
    category: "search",
    description:
      "Live web search and local search via the Brave Search API.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    requiresAuth: true,
    requiredEnv: [{ name: "BRAVE_API_KEY", hint: "free tier API key from brave.com/search/api" }],
    icon: { slug: "brave", color: "#fb542b" },
    official: true,
  },
  {
    slug: "gdrive",
    name: "Google Drive",
    category: "productivity",
    description:
      "Search and read files (incl. Google Docs) from your Drive using OAuth Desktop-app credentials.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    requiresAuth: true,
    requiredEnv: [
      { name: "GOOGLE_CLIENT_ID", hint: "OAuth desktop app client id" },
      { name: "GOOGLE_CLIENT_SECRET", hint: "OAuth desktop app client secret" },
    ],
    icon: { slug: "googledrive", color: "#4285f4" },
    official: true,
  },
  {
    slug: "slack",
    name: "Slack",
    category: "productivity",
    description:
      "Channels, messages, and reactions from your Slack workspace via a Slack Bot token.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    requiresAuth: true,
    requiredEnv: [
      { name: "SLACK_BOT_TOKEN", hint: "xoxb-… bot token" },
      { name: "SLACK_TEAM_ID", hint: "the T id of your workspace" },
    ],
    icon: { slug: "slack", color: "#4a154b" },
    official: true,
  },
  {
    slug: "puppeteer",
    name: "Puppeteer",
    category: "web",
    description:
      "Browser automation — navigate, click, screenshot, and scrape JavaScript-heavy pages.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    icon: { slug: "puppeteer", color: "#ffbf3f" },
    official: true,
  },
  {
    slug: "notion",
    name: "Notion (hosted)",
    category: "productivity",
    description:
      "Notion's hosted MCP — pages, databases, comments. Authenticate in the browser window Notion opens on first connect.",
    transport: "sse",
    url: "https://mcp.notion.com/sse",
    requiresAuth: true,
    icon: { slug: "notion", color: "#000000" },
  },
  {
    slug: "linear",
    name: "Linear (hosted)",
    category: "productivity",
    description:
      "Linear's hosted MCP — issues, teams, projects. Authenticate via Linear's OAuth flow on first connect.",
    transport: "sse",
    url: "https://mcp.linear.app/sse",
    requiresAuth: true,
    icon: { slug: "linear", color: "#5e6ad2" },
  },
  {
    slug: "sentry",
    name: "Sentry (hosted)",
    category: "dev-tools",
    description:
      "Sentry's hosted MCP — search and inspect errors, issues, and stack traces across projects.",
    transport: "streamable_http",
    url: "https://mcp.sentry.dev/mcp",
    requiresAuth: true,
    icon: { slug: "sentry", color: "#362d59" },
  },
  {
    slug: "stripe",
    name: "Stripe (hosted)",
    category: "data",
    description:
      "Stripe's hosted MCP — customers, payments, invoices, and dispute inspections.",
    transport: "streamable_http",
    url: "https://mcp.stripe.com",
    requiresAuth: true,
    icon: { slug: "stripe", color: "#635bff" },
  },
  {
    slug: "figma-dev-mode",
    name: "Figma Dev Mode (hosted)",
    category: "design",
    description:
      "Figma's official Dev Mode MCP (beta) — inspect designs and get design-to-code context. Enable it in Figma's desktop app localhost server.",
    transport: "streamable_http",
    url: "http://127.0.0.1:3845/mcp",
    requiresAuth: true,
    icon: { slug: "figma", color: "#f24e1e" },
  },

  /* ---------------- dev tools ---------------- */
  {
    slug: "playwright",
    name: "Playwright",
    category: "dev-tools",
    description:
      "Modern browser automation — navigate, click, fill forms, screenshot, and capture accessibility snapshots via Playwright.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    icon: { slug: "playwright", color: "#2ead33" },
    official: true,
  },
  {
    slug: "kubernetes",
    name: "Kubernetes",
    category: "dev-tools",
    description:
      "List pods, deployments, and services, tail logs, and manage resources in your cluster via kubectl. Uses your local kubeconfig.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-server-kubernetes"],
    icon: { slug: "kubernetes", color: "#326ce5" },
  },
  {
    slug: "docker",
    name: "Docker",
    category: "dev-tools",
    description:
      "Manage the Docker daemon on this machine — containers, images, networks, and log inspection.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-docker"],
    icon: { slug: "docker", color: "#2496ed" },
  },
  {
    slug: "context7",
    name: "Context7",
    category: "dev-tools",
    description:
      "Pull up-to-date, version-specific documentation for your frameworks and libraries — right while coding.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    icon: { slug: "upstash", color: "#00d924" },
    official: true,
  },
  {
    slug: "cloudflare",
    name: "Cloudflare",
    category: "dev-tools",
    description:
      "Manage your Cloudflare account — Workers, DNS, zones, and KV storage via the Cloudflare API.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@cloudflare/mcp-server-cloudflare"],
    requiredEnv: [
      { name: "CLOUDFLARE_API_TOKEN", hint: "API token with Workers/DNS permissions" },
      { name: "CLOUDFLARE_ACCOUNT_ID", hint: "32-char account id from your dashboard URL" },
    ],
    icon: { slug: "cloudflare", color: "#f38020" },
    official: true,
  },

  /* ---------------- data ---------------- */
  {
    slug: "mongodb",
    name: "MongoDB",
    category: "data",
    description:
      "Schema inspection and CRUD against MongoDB databases and collections via a connection string.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mongodb-mcp-server"],
    requiredEnv: [
      { name: "MDB_MCP_CONNECTION_STRING", hint: "mongodb+srv://… cluster connection string" },
    ],
    icon: { slug: "mongodb", color: "#47a24f" },
    official: true,
  },
  {
    slug: "supabase",
    name: "Supabase (hosted)",
    category: "data",
    description:
      "Supabase's hosted MCP — projects, tables, SQL, and edge functions. Authenticate via Supabase OAuth on first connect.",
    transport: "streamable_http",
    url: "https://mcp.supabase.com/mcp",
    requiresAuth: true,
    icon: { slug: "supabase", color: "#3ecf8e" },
    official: true,
  },
  {
    slug: "prisma",
    name: "Prisma (hosted)",
    category: "data",
    description:
      "Prisma's hosted MCP — search and read Prisma and ORM documentation directly in your prompts.",
    transport: "streamable_http",
    url: "https://mcp.prisma.io/mcp",
    requiresAuth: true,
    icon: { slug: "prisma", color: "#2d3748" },
    official: true,
  },
  {
    slug: "time",
    name: "Time",
    category: "data",
    description:
      "Get the current time and convert timestamps across timezones — small, but surprisingly handy for agents planning and scheduling.",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time"],
    icon: { color: "#f59e0b" },
    official: true,
  },

  /* ---------------- web ---------------- */
  {
    slug: "firecrawl",
    name: "Firecrawl",
    category: "web",
    description:
      "Scrape, crawl, map, and search the web with clean markdown output built for LLM consumption.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    requiredEnv: [{ name: "FIRECRAWL_API_KEY", hint: "API key from firecrawl.dev" }],
    icon: { color: "#fa5d19" },
    official: true,
  },
  {
    slug: "google-maps",
    name: "Google Maps",
    category: "web",
    description:
      "Geocoding, place search, directions, and distance calculations using Google Maps platform data.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    requiredEnv: [
      { name: "GOOGLE_MAPS_API_KEY", hint: "API key from the Google Maps platform console" },
    ],
    icon: { slug: "googlemaps", color: "#34a853" },
    official: true,
  },
  {
    slug: "vercel",
    name: "Vercel (hosted)",
    category: "web",
    description:
      "Vercel's hosted MCP — deploy, inspect, and manage projects, deployments, and domains. Authenticate on first connect.",
    transport: "streamable_http",
    url: "https://mcp.vercel.com",
    requiresAuth: true,
    icon: { slug: "vercel", color: "#000000" },
    official: true,
  },
  {
    slug: "netlify",
    name: "Netlify (hosted)",
    category: "web",
    description:
      "Netlify's hosted MCP — sites, deploys, functions, and env vars on your team. Authenticate via OAuth on first connect.",
    transport: "streamable_http",
    url: "https://mcp.netlify.com/mcp",
    requiresAuth: true,
    icon: { slug: "netlify", color: "#00c7b7" },
    official: true,
  },

  /* ---------------- search ---------------- */
  {
    slug: "tavily",
    name: "Tavily",
    category: "search",
    description:
      "LLM-optimized real-time web search API — results, Q&A, and news built for research workflows.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "tavily-mcp"],
    requiredEnv: [{ name: "TAVILY_API_KEY", hint: "free tier API key from app.tavily.com" }],
    icon: { color: "#2caae2" },
    official: true,
  },
  {
    slug: "exa",
    name: "Exa",
    category: "search",
    description:
      "Neural web search — semantic queries, content fetching, and multi-step deep research.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    requiredEnv: [{ name: "EXA_API_KEY", hint: "API key from dashboard.exa.ai" }],
    icon: { color: "#6e56cf" },
    official: true,
  },

  /* ---------------- productivity ---------------- */
  {
    slug: "atlassian",
    name: "Atlassian (hosted)",
    category: "productivity",
    description:
      "Atlassian's hosted MCP — read and search Jira issues and Confluence pages. Authenticate via OAuth on first connect.",
    transport: "sse",
    url: "https://mcp.atlassian.com/v1/sse",
    requiresAuth: true,
    icon: { slug: "atlassian", color: "#0052cc" },
    official: true,
  },

  /* ---------------- design ---------------- */
  {
    slug: "everart",
    name: "EverArt",
    category: "design",
    description:
      "Generate images with AI models via the EverArt API — reference servers approved and maintained by EverArt's local builder.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everart"],
    requiredEnv: [{ name: "EVERART_API_KEY", hint: "API key from everart.ai" }],
    icon: { color: "#d946ef" },
    official: true,
  },
  {
    slug: "blender",
    name: "Blender",
    category: "design",
    description:
      "Prompt-driven 3D modeling — create and manipulate Blender scenes hands-free (needs the mcp-for-blender addon and a running instance of Blender).",
    transport: "stdio",
    command: "uvx",
    args: ["blender-mcp"],
    icon: { color: "#ea7600" },
  },
];
