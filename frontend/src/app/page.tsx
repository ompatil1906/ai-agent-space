import Link from "next/link";
import {
  ArrowRightIcon,
  BotIcon,
  BrainIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  LayersIcon,
  LockIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WalletIcon,
  WrenchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { LiveCatalog } from "@/components/home/live-catalog";
import { HomeSearch } from "@/components/home/home-search";
import { MCP_CATALOG } from "@/lib/mcp-catalog";
import { McpLogo } from "@/components/McpLogo";

/*
 * Landing page — server-rendered shell with client "islands" for live data
 * (LiveCatalog, HomeSearch). No invented metrics: numbers on this page come
 * from real platform behavior (commission setting, workflow engine, MCP).
 */

const CAPABILITIES = [
  {
    icon: WrenchIcon,
    title: "MCP tool use",
    body: "Connect any MCP server — stdio or HTTP — and agents call its tools, resources, and prompts mid-run. Validate and discover tools before you ship.",
  },
  {
    icon: LayersIcon,
    title: "Multi-agent workflows",
    body: "Compose 13 workflow types — sequential, supervisor, parallel, debate, map-reduce, hierarchical teams, swarm, and more.",
  },
  {
    icon: BrainIcon,
    title: "Long-term memory",
    body: "Windowed context plus semantic memory with consolidation, shareable across agents on the same owner.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Human-in-the-loop",
    body: "Supervised agents pause before sensitive tool calls and collect your approval — from the console or on a schedule.",
  },
  {
    icon: LockIcon,
    title: "Sandboxed execution",
    body: "Give agents a disposable code environment with filesystem access instead of trusting shell tooling.",
  },
  {
    icon: FlaskConicalIcon,
    title: "Evals & versions",
    body: "LLM-as-judge scoring with per-criteria breakdowns, snapshot every change, and restore any version in one click.",
  },
];

const PRICING_MODELS = [
  { name: "Free", copy: "Open your agent to everyone for discovery and trust." },
  { name: "One-time", copy: "Pay once, own forever. The classic digital good." },
  { name: "Subscription", copy: "Recurring monthly or yearly access, managed for you." },
  { name: "Run packs", copy: "Prepaid execution packs — unused runs are auto-refunded." },
];

const FAQS = [
  {
    q: "What do buyers actually get when they purchase an agent?",
    a: "An entitlement on this platform: they can run your configured agent — its prompt, model settings, MCP tools, memory, and workflow — from their own dashboard. Your prompt and private configs stay hidden; a public listing only exposes pricing, feature copy, and ratings.",
  },
  {
    q: "How do creators make money?",
    a: "Set a pricing plan during publishing: free, one-time, subscription, or pay-per-execution packs. Every paid sale is split server-side; the platform currently takes a 10% commission and posts the remainder to your earnings ledger. Request a payout to your bank account or UPI ID when your balance clears the minimum.",
  },
  {
    q: "Do I need my own API keys?",
    a: "No. Runs are billed by the platform using its default model access, and you can override models per agent or bring your own provider keys under Settings — keys are stored server-side and never exposed to buyers.",
  },
  {
    q: "What happens when I publish a listing?",
    a: "The listing enters review. Once approved it appears in the marketplace with search, category, and rating metadata. You can unpublish or update it any time; updates are snapshotted as versions and buyers keep their access.",
  },
  {
    q: "Can buyers run agents programmatically?",
    a: "Yes. Each account can mint scoped API keys (prefix ask_) and execute entitled agents over the same HTTP API the dashboard uses.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(60%_80%_at_50%_-10%,color-mix(in_oklch,var(--brand)_18%,transparent),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(75%_60%_at_50%_0%,black,transparent)]"
        />

        <div className="relative mx-auto w-full max-w-7xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <SparklesIcon className="size-3.5 text-brand" />
              Create an agent for free · publish when it works
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="font-heading mx-auto mt-6 max-w-3xl text-balance text-4xl font-medium tracking-tight sm:text-6xl">
              The marketplace for AI agents that{" "}
              <span className="bg-gradient-to-r from-[var(--brand)] to-[var(--chart-2)] bg-clip-text text-transparent">
                do real work
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
              Build agents with MCP tools, memory, and multi-agent workflows —
              then publish them. Buyers run them in one click; creators keep{" "}
              <strong className="font-medium text-foreground">90%</strong> of
              every sale.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <HomeSearch />
          </Reveal>

          <Reveal delay={0.2}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <WrenchIcon className="size-3.5" /> MCP-native tools
              </span>
              <span className="flex items-center gap-1.5">
                <LayersIcon className="size-3.5" /> 13 workflow types
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheckIcon className="size-3.5" /> Server-verified payments
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------- live catalog */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
        <Reveal>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-heading text-2xl font-medium tracking-tight">
                Meet the agents
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A rotating view of featured and trending listings, straight
                from the marketplace.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <LiveCatalog />
        </Reveal>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section className="border-border/60 border-t bg-card/40">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6">
          <Reveal>
            <h2 className="font-heading text-center text-2xl font-medium tracking-tight sm:text-3xl">
              From idea to income in three passes
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Build",
                body: "Pick a template or start blank. Wire MCP tools, tune the prompt, set autonomy limits, and test in the live console with streaming output.",
                icon: BotIcon,
              },
              {
                step: "02",
                title: "Publish",
                body: "Write the landing copy, set a pricing plan, and submit for review. Version snapshots keep every change reversible.",
                icon: GitBranchIcon,
              },
              {
                step: "03",
                title: "Earn",
                body: "Sales post to your earnings ledger as purchases settle. Track gross, commission, and net — then request payouts to your bank or UPI.",
                icon: WalletIcon,
              },
            ].map((s, i) => (
              <Reveal key={s.step} delay={i * 0.07}>
                <div className="relative h-full rounded-xl bg-card p-6 ring-1 ring-foreground/10 transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
                  <div className="flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/20">
                      <s.icon className="size-4" />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground/60">
                      {s.step}
                    </span>
                  </div>
                  <h3 className="font-heading mt-4 text-base font-medium">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- capabilities */}
      <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6">
        <Reveal>
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-brand">
              Engine capabilities
            </p>
            <h2 className="font-heading mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
              Everything under the hood, exposed to builders
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The runtime is a real agent framework: graph-based execution,
              observability on every step, and guardrails you configure per
              agent.
            </p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.05}>
              <div className="h-full rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-all duration-200 hover:-translate-y-0.5 hover:ring-foreground/20">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground ring-1 ring-foreground/10">
                  <c.icon className="size-4" />
                </span>
                <h3 className="font-heading mt-4 text-base font-medium">{c.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* MCP brand strip — from the built-in catalog */}
        <Reveal delay={0.1}>
          <div className="border-border/60 mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 rounded-xl border bg-card/40 px-6 py-5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Ships with {MCP_CATALOG.length} MCP servers
            </span>
            <div className="flex flex-wrap items-center gap-5">
              {MCP_CATALOG.slice(0, 8).map((s) => (
                <McpLogo
                  key={s.slug}
                  slug={s.icon.slug ?? s.slug}
                  name={s.name}
                  color={s.icon.color}
                  size={18}
                  className="opacity-70 transition-opacity hover:opacity-100"
                />
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ------------------------------------------------ creator economy */}
      <section className="border-border/60 border-t bg-card/40">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-brand">
                For creators
              </p>
              <h2 className="font-heading mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
                Publish like a product, get paid like a product
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Choose how buyers pay you. The platform handles checkout,
                entitlements, renewals, and refunds — creators get a
                transparent ledger of every movement from sale to payout.
              </p>
              <ul className="mt-6 space-y-3">
                {PRICING_MODELS.map((m) => (
                  <li key={m.name} className="flex gap-3">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-brand/20">
                      <MessageSquareIcon className="size-3" />
                    </span>
                    <span className="text-sm">
                      <strong className="font-medium">{m.name}</strong>
                      <span className="text-muted-foreground"> — {m.copy}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-2">
                <Button size="lg" render={<Link href="/register" />}>
                  Start building <ArrowRightIcon className="size-4" />
                </Button>
                <Button size="lg" variant="outline" render={<Link href="/earnings" />}>
                  See the creator console
                </Button>
              </div>
            </div>
          </Reveal>

          {/* Ledger artifact — illustrates the flow, states are labeled as UI */}
          <Reveal delay={0.1}>
            <div className="overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-foreground/10 max-lg:hidden dark:ring-white/10">
              <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-mono text-[11px] text-zinc-400">
                  earnings ledger
                </span>
              </div>
              <pre className="p-4 font-mono text-xs leading-relaxed text-zinc-300">
                <code>{`entry_type  sale
agent_id    42 · pdf-invoice-extractor
amount      ₹499.00
commission  ₹49.90  (10%)
net cred.   ₹449.10
balance     ₹1,847.20   # available

 payout requested   po_8fk2…  ₹1,500
 →  processing      razorpay_x
 →  paid            funds landed

# whole flow visible? inspect /earnings`}</code>
              </pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------------- FAQ */}
      <section className="mx-auto w-full max-w-3xl px-4 py-24 sm:px-6">
        <Reveal>
          <h2 className="font-heading text-center text-2xl font-medium tracking-tight sm:text-3xl">
            Questions, answered plainly
          </h2>
        </Reveal>
        <div className="mt-10 divide-y divide-border">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 0.04}>
              <details className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-muted-foreground transition-transform duration-200 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
