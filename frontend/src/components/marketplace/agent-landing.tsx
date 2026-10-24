"use client";

/**
 * Public agent landing page (rendered at /agents/{slug}).
 * Uses ONLY the public listing payload — system_prompt / tools_config /
 * memory_config / advanced_config are never requested or rendered.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckIcon,
  CpuIcon,
  CopyIcon,
  FlagIcon,
  MessageSquareQuoteIcon,
  RocketIcon,
  ShieldCheckIcon,
  StarIcon,
  WorkflowIcon,
} from "lucide-react";
import { api, getToken, AUTH_EVENT } from "@/lib/api";
import type { PublicAgentDetail, RatingPublic, RatingSummary } from "@/lib/types";
import { pricingLabel, planDescriptor } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AgentMonogram } from "@/components/marketplace/agent-card";
import CheckoutDialog from "@/components/marketplace/checkout-dialog";
import { Skeleton } from "@/components/ui/skeleton";

const REPORT_REASONS = [
  { value: "inaccurate", label: "Inaccurate listing" },
  { value: "not_working", label: "Agent does not work" },
  { value: "misleading", label: "Misleading or unsafe content" },
  { value: "other", label: "Other (details required)" },
];

function Stars({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value == null) return null;
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span className={`text-warning ${className}`} aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      {String("★").repeat(full)}
      {half ? "☆" : ""}
    </span>
  );
}

export default function AgentLanding({ slug }: { slug: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [agent, setAgent] = useState<PublicAgentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [ratings, setRatings] = useState<RatingPublic[] | null>(null);
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setToken(getToken());
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  const loadAgent = useCallback(
    async (silent = false) => {
      try {
        const data = await api<PublicAgentDetail>(
          `/marketplace/agents/${encodeURIComponent(slug)}`,
          { auth: Boolean(getToken()) }
        );
        setAgent(data);
      } catch (e) {
        if (!silent) setNotFound(true);
      }
    },
    [slug]
  );

  useEffect(() => {
    void loadAgent();
  }, [loadAgent, token]);

  useEffect(() => {
    if (agent) document.title = `${agent.name} — AI Agent Space`;
    return () => {
      document.title = "AI Agent Space";
    };
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    api<RatingPublic[]>(`/marketplace/agents/${agent.id}/ratings`, { auth: false })
      .then(setRatings)
      .catch(() => setRatings([]));
    api<RatingSummary>(`/marketplace/agents/${agent.id}/rating-summary`, { auth: false })
      .then(setSummary)
      .catch(() => {});
  }, [agent]);

  const clone = async () => {
    if (!agent) return;
    setCloning(true);
    try {
      await api(`/marketplace/agents/${agent.id}/clone`, { method: "POST" });
      toast.success("Agent cloned", {
        description: "It is now in your workspace as a private draft.",
      });
      window.location.href = "/agents";
    } catch (e) {
      toast.error("Clone failed", { description: (e as Error).message });
    } finally {
      setCloning(false);
    }
  };

  const submitReport = async () => {
    if (!agent || !reportReason) return;
    setReporting(true);
    try {
      await api(`/marketplace/agents/${agent.id}/report`, {
        method: "POST",
        body: {
          reason: REPORT_REASONS.find((r) => r.value === reportReason)?.label ?? reportReason,
          details: reportDetails.trim() || null,
        },
      });
      setReported(true);
      setReportOpen(false);
      setReportDetails("");
      toast.success("Report submitted", {
        description: "Moderators will review this listing.",
      });
    } catch (e) {
      toast.error("Could not submit report", { description: (e as Error).message });
    } finally {
      setReporting(false);
    }
  };

  const copyPrompt = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(i);
      window.setTimeout(() => setCopiedPrompt(null), 1500);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">marketplace</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">Agent not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This listing is not published (or was taken down by moderation).
        </p>
        <Button variant="outline" className="mt-6" render={<Link href="/marketplace" />}>
          ← Back to marketplace
        </Button>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-16 sm:px-6">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const hasAccess = agent.purchased || agent.owned_by_viewer;
  const freePlan = !agent.pricing || agent.pricing.model === "free";
  const creator = agent.owner_display_name || agent.owner_email || "unknown creator";
  const stats = [
    { label: "runs", value: agent.run_count },
    { label: "sales", value: agent.sales_count },
    { label: "ratings", value: agent.rating_count },
    { label: "versions", value: agent.version_count },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6">
      {/* breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/marketplace" className="transition-colors hover:text-foreground">
          Marketplace
        </Link>
        {agent.category_name && (
          <>
            <span>/</span>
            <Link
              href={`/marketplace?category=${encodeURIComponent(agent.category_slug ?? "")}`}
              className="transition-colors hover:text-foreground"
            >
              {agent.category_name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-foreground">{agent.name}</span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px] lg:gap-10">
        {/* ------------------------------------------------ main column */}
        <div className="min-w-0">
          <header>
            <div className="flex items-start gap-4">
              <AgentMonogram agent={agent} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-heading text-2xl font-medium tracking-tight">
                    {agent.name}
                  </h1>
                  {agent.is_featured && (
                    <Badge className="gap-1 bg-brand/10 font-mono text-brand">
                      <StarIcon className="size-3" /> featured
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  by <span className="text-foreground">{creator}</span>
                  {agent.category_name ? ` · ${agent.category_name}` : ""}
                </p>
              </div>
            </div>
            <p className="mt-4 text-balance leading-relaxed text-muted-foreground">
              {agent.tagline || agent.description || "No description provided."}
            </p>
          </header>

          {/* spec strip */}
          <div className="mt-5 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="font-mono text-[11px]">
              <CpuIcon className="size-3" /> {agent.model_name}
            </Badge>
            <Badge variant="outline" className="font-mono text-[11px]">
              {agent.tools_count} tool{agent.tools_count === 1 ? "" : "s"}
            </Badge>
            {agent.workflow_type !== "single" && (
              <Badge variant="outline" className="font-mono text-[11px]">
                <WorkflowIcon className="size-3" /> team · {agent.workflow_type}
              </Badge>
            )}
            {agent.sandbox_enabled && (
              <Badge variant="outline" className="font-mono text-[11px] text-success">
                sandbox
              </Badge>
            )}
            <Badge variant="outline" className="font-mono text-[11px]">
              {agent.autonomy_level}
            </Badge>
            <Badge variant="outline" className="font-mono text-[11px]">
              {agent.latest_version || "v1"} · {agent.version_count} version
              {agent.version_count === 1 ? "" : "s"}
            </Badge>
            {agent.tags.slice(0, 4).map((t) => (
              <Badge key={t} variant="outline" className="font-mono text-[11px] text-muted-foreground">
                {t}
              </Badge>
            ))}
          </div>

          {/* stats row */}
          <dl className="ring-foreground/10 mt-6 grid grid-cols-4 gap-2 rounded-xl bg-card p-3 text-center ring-1">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="order-2 text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
                  {s.label}
                </dt>
                <dd className="order-1 text-lg font-medium tracking-tight">{s.value}</dd>
              </div>
            ))}
          </dl>

          {/* content sections */}
          <div className="mt-10 space-y-10">
            {agent.description && (
              <Section title="What it does">
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {agent.description}
                </p>
              </Section>
            )}
            {agent.problem_statement && (
              <Section title="The problem it solves">
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {agent.problem_statement}
                </p>
              </Section>
            )}

            {agent.features.length > 0 && (
              <Section title="Features">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {agent.features.map((f, i) => (
                    <li
                      key={i}
                      className="ring-foreground/10 flex items-start gap-2 rounded-lg bg-card px-3 py-2 text-sm ring-1"
                    >
                      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {agent.use_cases.length > 0 && (
              <Section title="Use cases">
                <ul className="space-y-1.5 text-sm">
                  {agent.use_cases.map((u, i) => (
                    <li key={i} className="flex gap-2.5">
                      <RocketIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
                      <span className="text-muted-foreground">{u}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {agent.target_audience && (
              <Section title="Who it's for">
                <p className="text-muted-foreground">{agent.target_audience}</p>
              </Section>
            )}

            {agent.usage_instructions && (
              <Section title="How to use it">
                <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {agent.usage_instructions}
                  </p>
                </div>
              </Section>
            )}

            {agent.example_prompts.length > 0 && (
              <Section title="Example prompts">
                <div className="grid gap-2 sm:grid-cols-2">
                  {agent.example_prompts.map((p, i) => (
                    <div
                      key={i}
                      className="group ring-foreground/10 flex items-start justify-between gap-2 rounded-lg bg-card px-3 py-2.5 ring-1 transition-shadow hover:ring-foreground/20"
                    >
                      <div className="min-w-0">
                        {p.title && <p className="mb-0.5 text-sm font-medium">{p.title}</p>}
                        <p className="text-muted-foreground line-clamp-2 font-mono text-xs">
                          {p.prompt}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Copy example prompt"
                        onClick={() => copyPrompt(i, p.prompt)}
                      >
                        {copiedPrompt === i ? (
                          <CheckIcon className="size-3 text-success" />
                        ) : (
                          <CopyIcon className="size-3" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {agent.faqs.length > 0 && (
              <Section title="FAQs">
                <div className="divide-border divide-y rounded-xl bg-card px-4 ring-1 ring-foreground/10">
                  {agent.faqs.map((q, i) => (
                    <details key={i} className="group py-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        {q.question}
                        <span className="text-muted-foreground transition-transform duration-200 group-open:rotate-45">
                          +
                        </span>
                      </summary>
                      <p className="text-muted-foreground mt-2 text-sm">{q.answer}</p>
                    </details>
                  ))}
                </div>
              </Section>
            )}

            {/* ----------------------------------------------- reviews */}
            <section id="reviews">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-base font-medium">Reviews</h2>
                {summary && (summary.rating_count ?? 0) > 0 && (
                  <span className="flex items-center gap-2 text-sm">
                    <Stars value={summary.average_rating ?? agent.average_rating} />
                    <span className="text-foreground font-medium">
                      {(summary.average_rating ?? agent.average_rating)?.toFixed(1)}
                    </span>
                    <span className="text-muted-foreground">({summary.rating_count})</span>
                  </span>
                )}
              </div>
              {ratings && ratings.length > 0 ? (
                <div className="space-y-2">
                  {ratings.map((r) => (
                    <div
                      key={r.id}
                      className="ring-foreground/10 rounded-lg bg-card px-4 py-3 ring-1"
                    >
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <Stars value={r.rating} />
                        <span className="text-muted-foreground">
                          {r.user_display_name || r.user_email || "user"}
                        </span>
                        <span className="text-muted-foreground/60 font-mono text-[10px]">
                          {new Date(r.created_at).toLocaleDateString("en-IN", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        {r.verified_purchase && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] text-success"
                          >
                            <ShieldCheckIcon className="size-3" /> verified purchase
                          </Badge>
                        )}
                      </p>
                      {r.review && (
                        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                          {r.review}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center">
                  <MessageSquareQuoteIcon className="text-muted-foreground/50 mx-auto size-5" />
                  <p className="text-muted-foreground mt-2 text-sm">
                    No reviews yet — buyers can rate the agent after purchase.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* -------------------------------------------------- sticky sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="ring-foreground/10 rounded-xl bg-card p-4 ring-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-3xl font-medium tracking-tight">
                {pricingLabel(agent.pricing)}
              </p>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Stars value={agent.average_rating} />
                {agent.average_rating != null ? agent.average_rating.toFixed(1) : "—"}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">{planDescriptor(agent.pricing)}</p>

            {agent.refund_window_days != null && agent.refund_window_days > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">
                {agent.refund_window_days}-day refund window after purchase.
              </p>
            )}

            <div className="mt-4 space-y-2">
              {hasAccess ? (
                <>
                  <Badge variant="outline" className="w-full justify-center border-success/30 bg-success/10 py-1 font-mono text-success">
                    <ShieldCheckIcon className="size-3" /> you have access
                  </Badge>
                  <Button className="w-full" render={<Link href={`/agents/${agent.id}`} />}>
                    Open console
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={clone}
                    disabled={cloning}
                  >
                    {cloning ? "Cloning…" : "Clone to my workspace"}
                  </Button>
                </>
              ) : (
                <>
                  <Button className="w-full" onClick={() => setCheckoutOpen(true)}>
                    {freePlan ? "Use for free" : "Get access"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={clone}
                    disabled={cloning}
                    title="A free preview clone of a paid agent requires purchase"
                  >
                    {cloning ? "Cloning…" : "Clone"}
                  </Button>
                </>
              )}
              {token && (
                <Button
                  variant="ghost"
                  className="text-muted-foreground w-full"
                  size="sm"
                  onClick={() => (reported ? undefined : setReportOpen(true))}
                >
                  <FlagIcon className="size-3.5" /> {reported ? "Reported ✓" : "Report listing"}
                </Button>
              )}
            </div>

            <ul className="border-border/60 text-muted-foreground mt-4 space-y-1.5 border-t pt-3 text-xs">
              <li className="flex items-center gap-2">
                <ShieldCheckIcon className="size-3.5 text-success" /> Server-verified payments —
                never client-confirmed
              </li>
              <li className="flex items-center gap-2">
                <CpuIcon className="size-3.5" /> Runs configured by the creator, billed by the
                platform
              </li>
              <li className="flex items-center gap-2">
                <WorkflowIcon className="size-3.5" /> Updates are versioned; access persists
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {checkoutOpen && (
        <CheckoutDialog
          agentId={agent.id}
          agentName={agent.name}
          pricing={agent.pricing}
          token={token ?? ""}
          onOpenChange={(open) => {
            setCheckoutOpen(open);
            if (!open) void loadAgent(true);
          }}
          onSuccess={() => {
            setCheckoutOpen(false);
            void loadAgent(true);
          }}
        />
      )}

      {/* report dialog — replaces window.prompt */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report this listing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reportReason} onValueChange={(v) => setReportReason(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-details">Details</Label>
              <Textarea
                id="report-details"
                placeholder="What should moderators know? (required for “Other”)"
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                className="min-h-20"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitReport}
              disabled={reporting || !reportReason || (reportReason === "other" && !reportDetails.trim())}
            >
              {reporting ? "Sending…" : "Submit report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-heading mb-3 text-base font-medium tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
