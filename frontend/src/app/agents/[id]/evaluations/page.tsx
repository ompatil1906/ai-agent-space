"use client";

/**
 * LLM-as-judge evaluation dashboard for one agent. The summary strip (and the
 * per-criterion bar list) read ONLY the `/evaluations/summary` payload; the
 * judge persists per-criterion scores on each evaluation, so per-criterion
 * averages are aggregated from the summary's `recent` items.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, EmptyState } from "@/components/ui-page";
import { api, getToken, messageFromError, useApiQuery } from "@/lib/api";
import { cn } from "cn";

interface AgentEvaluation {
  id: number;
  agent_id: number;
  input: string;
  agent_output?: string | null;
  score: number;
  explanation?: string | null;
  criteria?: string | null;
  criteria_scores?: Record<string, unknown> | null;
  created_at: string;
}

interface EvaluationSummary {
  count: number;
  average_score: number;
  recent: AgentEvaluation[];
}

interface EvaluateResult {
  score?: number;
  explanation?: string;
  agent_output?: string;
  criteria_scores?: Record<string, unknown> | null;
}

interface CriterionAverage {
  name: string;
  avg: number;
  samples: number;
}

/** "2 days ago" relative timestamp, with the absolute time as a title. */
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function fullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function asNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    for (const key of ["score", "value", "average", "avg"]) {
      if (obj[key] != null) {
        const n = asNumber(obj[key]);
        if (n != null) return n;
      }
    }
  }
  return null;
}

/** Tolerant flattener: `{ helpfulness: 8 }`, `{ accuracy: "7" }` or
 * `{ clarity: { score: 9 } }` all work; unexpected shapes are skipped. */
function numericScores(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    const n = asNumber(val);
    if (n != null) out[key] = n;
  }
  return out;
}

/** Score band chip colors: 8–10 success, 5–7 warning, below 5 destructive. */
function scoreBand(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  if (rounded >= 8) return "bg-success/10 text-success ring-success/30";
  if (rounded >= 5) return "bg-warning/10 text-warning ring-warning/30";
  return "bg-destructive/10 text-destructive ring-destructive/30";
}

function ScoreChip({ score, className }: { score: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-4xl px-2.5 font-mono text-xs font-medium ring-1",
        scoreBand(score),
        className
      )}
    >
      {(Math.round(score * 10) / 10).toFixed(1)}
      <span className="opacity-60"> / 10</span>
    </span>
  );
}

function fmtScore(value: unknown): string {
  const n = typeof value === "number" ? value : asNumber(value);
  return n != null ? (Math.round(n * 10) / 10).toFixed(1) : "—";
}

/** Aggregates per-criterion averages out of the summary's recent items. */
function aggregateCriteria(recent: AgentEvaluation[]): CriterionAverage[] {
  const sums: Record<string, { total: number; count: number }> = {};
  for (const ev of recent) {
    const map = numericScores(ev.criteria_scores);
    for (const [name, value] of Object.entries(map)) {
      const bucket = (sums[name] ??= { total: 0, count: 0 });
      bucket.total += value;
      bucket.count += 1;
    }
  }
  return Object.entries(sums)
    .map(([name, { total, count }]) => ({
      name,
      avg: total / count,
      samples: count,
    }))
    .sort((a, b) => b.avg - a.avg);
}

/** Rule-free bar list — one muted track, a `var(--chart-1)` fill, the value. */
function CriterionBars({ averages }: { averages: CriterionAverage[] }) {
  if (averages.length === 0) return null;
  return (
    <div className="space-y-2">
      {averages.map((c) => (
        <div key={c.name} className="flex items-center gap-3">
          <span className="w-28 min-w-0 shrink-0 truncate font-mono text-xs text-muted-foreground">
            {c.name}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-chart-1"
              style={{
                width: `${Math.max(4, Math.min(100, (c.avg / 10) * 100))}%`,
              }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-xs font-medium">
            {fmtScore(c.avg)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Strings like "helpfulness, accuracy, and clarity" → tidy chips. */
function criteriaNames(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function EvaluationsContent() {
  const params = useParams();
  const agentId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ name?: string | null; model_name?: string | null } | null>(null);

  // run-evaluation dialog + its result
  const [runOpen, setRunOpen] = useState(false);
  const [evalInput, setEvalInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvaluateResult | null>(null);

  // full detail of a past evaluation
  const [detail, setDetail] = useState<AgentEvaluation | null>(null);

  // Auth gate — preserve the redirect-to-login entry flow. The token is
  // deferred one tick so no state is set synchronously inside the effect.
  useEffect(() => {
    const t = getToken();
    if (!t) {
      window.location.href = "/login";
      return;
    }
    const timer = window.setTimeout(() => setToken(t), 0);
    return () => window.clearTimeout(timer);
  }, [agentId]);

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    reload: reloadSummary,
  } = useApiQuery<EvaluationSummary>(
    token ? `/agents/${agentId}/evaluations/summary` : null
  );

  const {
    data: evals,
    loading: evalsLoading,
    error: evalsError,
    reload: reloadEvals,
  } = useApiQuery<AgentEvaluation[]>(
    token ? `/agents/${agentId}/evaluations?limit=30` : null
  );

  const loading = summaryLoading || evalsLoading;
  const error = summaryError ?? evalsError;
  const reload = useCallback(() => {
    reloadSummary();
    reloadEvals();
  }, [reloadSummary, reloadEvals]);

  // Agent identity (name/model) — best-effort, never blocks the page.
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api<{ name?: string | null; model_name?: string | null }>(`/agents/${agentId}`, {
      signal: controller.signal,
    })
      .then(setIdentity)
      .catch(() => {});
    return () => controller.abort();
  }, [token, agentId]);

  const runEvaluation = async () => {
    if (!evalInput.trim() || running) return;
    setRunning(true);
    try {
      const res = await api<EvaluateResult>(`/agents/${agentId}/evaluate`, {
        method: "POST",
        body: { input: evalInput },
      });
      setEvalInput("");
      setRunOpen(false);
      setResult(res);
      reload();
    } catch (e: unknown) {
      toast.error("Evaluation failed", { description: messageFromError(e) });
    } finally {
      setRunning(false);
    }
  };

  const agentName = identity?.name?.trim() || `Agent #${agentId}`;
  const count = summary?.count ?? 0;
  const countNumber = typeof count === "number" && Number.isFinite(count) ? count : 0;
  const criterionAverages = useMemo(
    () => (summary?.recent ? aggregateCriteria(summary.recent) : []),
    [summary]
  );
  const judgeCriteria = useMemo(
    () =>
      criterionAverages.length > 0
        ? criterionAverages.map((c) => c.name)
        : criteriaNamesFrom(summary?.recent),
    [summary, criterionAverages]
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* breadcrumbs — back to the agent list + into the agent console */}
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Link href="/agents" className="hover:text-foreground">
          ← back to agent list
        </Link>
        <span aria-hidden className="text-muted-foreground/50">/</span>
        <Link href={`/agents/${agentId}`} className="min-w-0 truncate hover:text-foreground">
          {agentName}
        </Link>
        <span aria-hidden className="text-muted-foreground/50">/</span>
        <span className="text-foreground">evaluations</span>
      </nav>

      <PageHeader
        eyebrow={`agent · ${agentName} · llm-as-judge`}
        title="Evaluation dashboard"
        description="Test how well the agent answers, then let a judge model score each response from 1–10."
      >
        <Button variant="outline" render={<Link href={`/agents/${agentId}`} />}>
          Open console
        </Button>
        <Button onClick={() => setRunOpen(true)}>Run evaluation</Button>
      </PageHeader>

      {summary === null && evals === null && !error ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-4 w-32" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-dashed border-border px-8 py-14 text-center">
          <p className="font-medium">Couldn’t load evaluations</p>
          <p className="text-muted-foreground mt-1 text-sm">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={reload}
            disabled={loading}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          {/* ------------------------------------------ summary strip */}
          <div className="rounded-xl bg-card px-5 py-5 ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-6">
              <div>
                <p className="font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                  average score
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-4xl font-medium tracking-tight">
                    {fmtScore(summary?.average_score)}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">/ 10</span>
                  {typeof summary?.average_score === "number" && (
                    <ScoreChip score={summary.average_score} />
                  )}
                </div>
                <p className="text-muted-foreground mt-1 font-mono text-xs">
                  {countNumber} evaluation{countNumber === 1 ? "" : "s"} recorded
                </p>
                {judgeCriteria.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {judgeCriteria.slice(0, 6).map((name) => (
                      <span
                        key={name}
                        className="rounded-4xl bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-w-56 max-w-md flex-1">
                <p className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                  per-criterion average
                </p>
                {criterionAverages.length > 0 ? (
                  <CriterionBars averages={criterionAverages} />
                ) : (
                  <p className="flex h-10 items-center text-xs text-muted-foreground">
                    Judges score overall responses so far — per-criterion breakdowns
                    appear here once evaluations include them.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ------------------------------------------------ history */}
          <div className="mt-8">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <p className="font-mono text-[11px] tracking-widest text-muted-foreground/70 uppercase">
                history · last 30
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={reload}
                disabled={loading}
              >
                Refresh
              </Button>
            </div>

            {evals === null && evalsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : evals !== null && evals.length === 0 ? (
              <EmptyState
                title="No evaluations yet"
                hint="Give the agent a realistic task — the judge model scores its answer against helpfulness, accuracy, and clarity."
                actionLabel="Run evaluation"
                onAction={() => setRunOpen(true)}
              />
            ) : (
              <div className="space-y-2">
                {(evals ?? []).map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg bg-card px-4 py-3.5 ring-1 ring-foreground/10 transition-all hover:ring-foreground/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{ev.input}</p>
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                          {ev.explanation?.trim() || "No explanation recorded."}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className="hidden font-mono text-[11px] text-muted-foreground sm:inline"
                          title={fullDate(ev.created_at)}
                        >
                          {timeAgo(ev.created_at)}
                        </span>
                        <ScoreChip score={Number(ev.score)} />
                        <Button size="xs" variant="ghost" onClick={() => setDetail(ev)}>
                          Details
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ------------------------------------------- run-eval dialog */}
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run evaluation</DialogTitle>
            <DialogDescription>
              The agent answers your input first, then a judge model scores the
              response from 1–10.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="eval-input">Test input</Label>
            <Textarea
              id="eval-input"
              rows={4}
              placeholder="Enter a realistic task for the agent…"
              value={evalInput}
              onChange={(e) => setEvalInput(e.target.value)}
              disabled={running}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)} disabled={running}>
              Cancel
            </Button>
            <Button
              onClick={runEvaluation}
              disabled={running || !evalInput.trim()}
            >
              {running ? "Evaluating…" : "Run evaluation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------- result dialog */}
      <Dialog
        open={Boolean(result)}
        onOpenChange={(open) => {
          if (!open) setResult(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Evaluation complete</DialogTitle>
            <DialogDescription>LLM-as-judge result for the submitted input.</DialogDescription>
          </DialogHeader>
          {typeof result?.score === "number" ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-3xl font-medium tracking-tight",
                    Math.round(result.score * 10) / 10 >= 8
                      ? "text-success"
                      : Math.round(result.score * 10) / 10 >= 5
                        ? "text-warning"
                        : "text-destructive"
                  )}
                >
                  {(Math.round(result.score * 10) / 10).toFixed(1)}
                </span>
                <span className="font-mono text-sm text-muted-foreground">/ 10</span>
                <ScoreChip score={result.score} />
              </div>
              {result.explanation && (
                <p className="text-sm text-muted-foreground">{result.explanation}</p>
              )}
              <CriterionBars averages={aggregateCriterionMap(result.criteria_scores)} />
              {result.agent_output && (
                <div>
                  <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                    agent output
                  </p>
                  <ScrollArea className="h-32 rounded-lg bg-muted/40 ring-1 ring-foreground/10">
                    <pre className="block min-w-full whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                      {result.agent_output}
                    </pre>
                  </ScrollArea>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The evaluation finished but returned no score.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResult(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------- history detail */}
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Evaluation #{detail?.id}</DialogTitle>
            <DialogDescription>
              {detail && `${fullDate(detail.created_at)} · ${timeAgo(detail.created_at)}`}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <ScoreChip score={Number(detail.score)} />
                <span className="font-mono text-xs text-muted-foreground">
                  {readCriteria(detail).count > 0
                    ? `${readCriteria(detail).count} criterion tracked`
                    : null}
                </span>
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                  input
                </p>
                <p className="rounded-lg bg-muted/40 p-3 text-sm ring-1 ring-foreground/10">
                  {detail.input}
                </p>
              </div>
              {detail.agent_output && (
                <div>
                  <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                    agent output
                  </p>
                  <ScrollArea className="max-h-40 rounded-lg bg-muted/40 ring-1 ring-foreground/10">
                    <pre className="block min-w-full whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                      {detail.agent_output}
                    </pre>
                  </ScrollArea>
                </div>
              )}
              {detail.explanation && (
                <div>
                  <p className="mb-1.5 font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                    explanation
                  </p>
                  <p className="text-sm text-muted-foreground">{detail.explanation}</p>
                </div>
              )}
              <CriterionBars averages={aggregateCriterionMap(detail.criteria_scores)} />
              {criteriaNames(detail.criteria).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {criteriaNames(detail.criteria).map((name) => (
                    <Badge key={name} variant="outline" className="font-mono text-[10px]">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-criterion bars from a single evaluation's `criteria_scores` map. */
function aggregateCriterionMap(raw: unknown): CriterionAverage[] {
  const map = numericScores(raw);
  return Object.entries(map)
    .map(([name, avg]) => ({ name, avg, samples: 1 }))
    .sort((a, b) => b.avg - a.avg);
}

/** Criteria names pulled from a stored evaluation (string or score map). */
function readCriteria(ev: AgentEvaluation): { count: number; names: string[] } {
  const fromMap = Object.keys(numericScores(ev.criteria_scores));
  const names = fromMap.length > 0 ? fromMap : criteriaNames(ev.criteria);
  return { count: names.length, names };
}

/** Deduped criteria names across recent evaluations (fallback for chips). */
function criteriaNamesFrom(recent: AgentEvaluation[] | null | undefined): string[] {
  const names: string[] = [];
  for (const ev of recent ?? []) {
    for (const name of readCriteria(ev).names) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export default function EvaluationsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <div className="space-y-3">
            <Skeleton className="h-40 w-full rounded-xl" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <EvaluationsContent />
    </Suspense>
  );
}
