import Link from "next/link";
import {
  ArrowRightIcon,
  BotIcon,
  BrainIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  LayersIcon,
  LockIcon,
  ShieldCheckIcon,
  WalletIcon,
  WrenchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/reveal";
import { LiveCatalog } from "@/components/home/live-catalog";
import { HomeSearch } from "@/components/home/home-search";

/*
 * Landing page — server-rendered shell with a client "island" for live data
 * (LiveCatalog). No invented metrics: copy states what the platform actually
 * does (commission split, workflow engine, MCP tools).
 */

const CAPABILITIES = [
  {
    icon: WrenchIcon,
    title: "MCP tool use",
    body: "Connect any MCP server and agents call its tools mid-run. Validate tools before you ship.",
  },
  {
    icon: LayersIcon,
    title: "Multi-agent workflows",
    body: "Compose 13 workflow types — sequential, supervisor, parallel, debate, hierarchical teams, and more.",
  },
  {
    icon: BrainIcon,
    title: "Long-term memory",
    body: "Windowed context plus semantic memory, shareable across agents on the same owner.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Human-in-the-loop",
    body: "Agents pause before sensitive tool calls and collect your approval.",
  },
  {
    icon: LockIcon,
    title: "Sandboxed execution",
    body: "A disposable code environment with filesystem access instead of trusting shell tooling.",
  },
  {
    icon: FlaskConicalIcon,
    title: "Evals & versions",
    body: "LLM-as-judge scoring, a snapshot on every change, and one-click restore.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Build",
    body: "Pick a template or start blank. Wire tools, tune the prompt, and test in the live console.",
    icon: BotIcon,
  },
  {
    step: "02",
    title: "Publish",
    body: "Write the listing copy, set a pricing plan, and submit. Every change is snapshotted.",
    icon: GitBranchIcon,
  },
  {
    step: "03",
    title: "Earn",
    body: "Sales post to your earnings ledger as they settle. Request payouts any time.",
    icon: WalletIcon,
  },
];

const PRICING_MODELS = [
  { name: "Free", copy: "Open your agent to everyone for discovery and trust." },
  { name: "One-time", copy: "Pay once, own forever." },
  { name: "Subscription", copy: "Recurring monthly or yearly access, managed for you." },
  { name: "Run packs", copy: "Prepaid execution packs — unused runs are auto-refunded." },
];

const FAQS = [
  {
    q: "What do buyers get when they purchase an agent?",
    a: "An entitlement: they run your configured agent — prompt, model, tools, memory, workflow — from their own dashboard. Your prompt and private configs stay hidden.",
  },
  {
    q: "How do creators make money?",
    a: "Set a pricing plan when publishing. Every paid sale is split server-side: the platform keeps a 10% commission and the rest posts to your earnings ledger for payout.",
  },
  {
    q: "Do I need my own API keys?",
    a: "No. Runs are billed by the platform, and you can bring your own provider keys under Settings if you want.",
  },
  {
    q: "Can buyers run agents programmatically?",
    a: "Yes. Each account can mint scoped API keys and run entitled agents over the same HTTP API the dashboard uses.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-20 pb-24 text-center sm:px-6 sm:pt-28">
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-medium tracking-tight sm:text-6xl">
          The marketplace for AI agents that do real work
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Build agents with tools, memory, and workflows — then publish them.
          Buyers run them in one click; creators keep{" "}
          <strong className="font-medium text-foreground">90%</strong> of every
          sale.
        </p>

        <HomeSearch />

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <WrenchIcon className="size-3.5" /> MCP-native tools
          </span>
          <span className="flex items-center gap-1.5">
            <LayersIcon className="size-3.5" /> 13 workflow types
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheckIcon className="size-3.5" /> Verified payments
          </span>
        </div>
      </section>

      {/* ---------------------------------------------------- live catalog */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
        <Reveal>
          <div className="mb-6">
            <h2 className="text-2xl font-medium tracking-tight">Meet the agents</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Featured and trending listings, straight from the marketplace.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <LiveCatalog />
        </Reveal>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6">
          <Reveal>
            <h2 className="text-center text-2xl font-medium tracking-tight sm:text-3xl">
              From idea to income in three steps
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.step} delay={i * 0.07}>
                <div className="h-full rounded-xl bg-card p-6 ring-1 ring-foreground/10">
                  <div className="flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <s.icon className="size-4" />
                    </span>
                    <span className="text-xs text-muted-foreground/60">{s.step}</span>
                  </div>
                  <h3 className="mt-4 text-base font-medium">{s.title}</h3>
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
            <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
              A real agent engine, exposed to builders
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Graph-based execution, observability on every step, and guardrails
              you configure per agent.
            </p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.05}>
              <div className="h-full rounded-xl bg-card p-5 ring-1 ring-foreground/10">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <c.icon className="size-4" />
                </span>
                <h3 className="mt-4 text-base font-medium">{c.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ creator economy */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">
                Publish like a product, get paid like one
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Choose how buyers pay you. The platform handles checkout,
                entitlements, renewals, and refunds — you get a transparent
                ledger from sale to payout.
              </p>
            </div>
          </Reveal>
          <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
            {PRICING_MODELS.map((m, i) => (
              <Reveal key={m.name} delay={i * 0.05}>
                <div className="h-full rounded-xl bg-card p-5 ring-1 ring-foreground/10">
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{m.copy}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.1}>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              <Button size="lg" render={<Link href="/register" />}>
                Start building <ArrowRightIcon className="size-4" />
              </Button>
              <Button size="lg" variant="outline" render={<Link href="/earnings" />}>
                See the creator console
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------------- FAQ */}
      <section className="mx-auto w-full max-w-3xl px-4 py-24 sm:px-6">
        <Reveal>
          <h2 className="text-center text-2xl font-medium tracking-tight sm:text-3xl">
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
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>
    </>
  );
}
