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
];
