import Link from "next/link";
import Image from "next/image";
import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  {
    kicker: "01 / Builder",
    title: "Agent Builder",
    description:
      "Compose agents with custom prompts, models, memory windows, and multi-agent workflows.",
  },
  {
    kicker: "02 / Tools",
    title: "Real MCP",
    description:
      "Connect to official MCP servers over stdio, SSE, or streamable HTTP for tool discovery and execution.",
  },
  {
    kicker: "03 / Market",
    title: "Marketplace",
    description:
      "Publish, discover, clone, rate, and sell agents — with credits and versioned rollbacks.",
  },
];

const CONSOLE_LINES: Array<{ tone?: string; text: string }> = [
  { tone: "text-muted-foreground", text: "$ agent run research-assistant" },
  { text: "› planning task → 3 steps" },
  { tone: "text-blue-300", text: "⚙ tool_call  web_search(query=\"MCP spec\")" },
  { tone: "text-emerald-300", text: "✓ tool_result  12 sources · 1.4s" },
  { tone: "text-blue-300", text: "⚙ tool_call  filesystem.read(path=\"notes.md\")" },
  { tone: "text-emerald-300", text: "✓ tool_result  842 bytes" },
  { tone: "text-muted-foreground", text: "› synthesizing final answer…" },
  { text: "Done in 6.2s · 2 tool calls · thread a91f3c" },
];

export default function Home() {
  return (
    <div className="relative flex flex-col">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_100%_at_50%_0%,rgb(255_255_255/7%),transparent_70%)]"
      />

      <section className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-20 pb-20 text-center">
        <div className="mb-6 flex flex-col items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-border/80 bg-zinc-950 p-3 shadow-xl ring-1 ring-white/10 transition-transform hover:scale-105">
            <Image
              src="/logos/icon.svg"
              alt="AI Agent Space logo"
              width={48}
              height={48}
              className="size-10 object-contain"
              priority
            />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 font-mono text-xs text-muted-foreground shadow-sm">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            agents · mcp · multi-agent workflows
          </div>
        </div>

        <h1 className="max-w-3xl text-5xl font-medium tracking-tight text-balance sm:text-6xl">
          Your space for building AI agents
        </h1>

        <p className="mt-6 max-w-xl text-lg text-muted-foreground text-pretty">
          Build, configure, run, and share advanced AI agents with real tool
          use, MCP servers, and multi-agent workflows.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className={buttonVariants({ size: "lg" })}>
            Get started
          </Link>
          <Link
            href="/marketplace"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            Explore marketplace
          </Link>
        </div>

        {/* Console preview */}
        <div className="mt-16 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card text-left shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="size-2 rounded-full bg-white/15" />
            <span className="size-2 rounded-full bg-white/15" />
            <span className="size-2 rounded-full bg-white/15" />
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              research-assistant — run
            </span>
          </div>
          <div className="space-y-1.5 p-4 font-mono text-[13px] leading-relaxed">
            {CONSOLE_LINES.map((line, i) => (
              <p key={i} className={line.tone || "text-foreground"}>
                {line.text}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="relative mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-foreground/20"
            >
              <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                {feature.kicker}
              </p>
              <h3 className="mt-3 text-base font-medium tracking-tight">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/40 px-6 py-8 text-xs text-muted-foreground">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logos/icon.svg"
            alt="AI Agent Space"
            width={18}
            height={18}
            className="size-4.5 rounded-sm object-contain"
          />
          <span className="font-medium text-foreground">AI Agent Space</span>
          <span>— platform for intelligent agent workflows</span>
        </div>
        <p>© 2026 AI Agent Space</p>
      </footer>
    </div>
  );
}
