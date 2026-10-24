"use client";

/**
 * Creator + customer overview.
 *
 * Data — all through the shared api client (`@/lib/api`):
 *   GET /users/me/stats      → aggregates, per-agent list, recent runs
 *   GET /api-keys/           → list keys
 *   POST /api-keys/          → create key (raw key returned exactly once)
 *   DELETE /api-keys/{id}    → revoke key
 *
 * Structure: three tabs.
 *   Overview — stat cards → runs-by-agent chart → my agents list (+ eval quality)
 *   My runs  — recent runs table (status badges, latency, tokens → agent console)
 *   API keys — key manager (create dialog → copy-once reveal, revoke confirm)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Bar, BarChart } from "recharts";
import {
  ActivityIcon,
  BotIcon,
  CheckIcon,
  CircleDollarSignIcon,
  CoinsIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  TimerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/ui-page";
import { AgentMonogram } from "@/components/marketplace/agent-card";
import { api, getToken, messageFromError, useApiQuery } from "@/lib/api";
import type { ApiKeyCreateResponse, ApiKeyPublic, UserStats } from "@/lib/types";
import { formatMoney } from "@/lib/money";

/* ------------------------------------------------------------------ shared */

const CHIP_STYLES = {
  brand: "bg-brand/10 text-brand ring-brand/20",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/10 text-warning ring-warning/20",
  neutral: "bg-muted text-muted-foreground ring-foreground/5",
} as const;

function StatCard({
  icon: Icon,
  chip = "neutral",
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  chip?: keyof typeof CHIP_STYLES;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground/80">
          <span className="min-w-0 truncate">{label}</span>
          <span
            aria-hidden
            className={`flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ${CHIP_STYLES[chip]}`}
          >
            <Icon className="size-3.5" />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl leading-none font-medium tracking-tight text-foreground">
          {value}
        </p>
        {sub ? <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "completed") {
    return <Badge className="bg-success/10 text-success">completed</Badge>;
  }
  if (s === "error" || s === "failed") {
    return <Badge variant="destructive">{s}</Badge>;
  }
  if (s === "running") {
    return (
      <Badge className="bg-warning/10 text-warning">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-warning" />
        running
      </Badge>
    );
  }
  if (s === "pending") {
    return <Badge className="bg-warning/10 text-warning">pending</Badge>;
  }
  if (s === "cancelled") {
    return <Badge variant="secondary">cancelled</Badge>;
  }
  return <Badge variant="outline">{s}</Badge>;
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
      <p className="max-w-md text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCwIcon />
        Try again
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- skeletons */

function StatGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card size="sm" key={i}>
          <CardHeader>
            <Skeleton className="h-3 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-32 max-w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartCardSkeleton() {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-60 w-full" />
      </CardContent>
    </Card>
  );
}

function ListCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

const OverviewSkeleton = () => (
  <div className="flex flex-col gap-4">
    <StatGridSkeleton />
    <div className="grid gap-4 lg:grid-cols-5">
      <ChartCardSkeleton />
      <ListCardSkeleton rows={3} />
    </div>
  </div>
);

/* ------------------------------------------------------------------- page */

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
  } = useApiQuery<UserStats>(ready ? "/users/me/stats" : null);

  // A failed request that also cleared the token means the session expired.
  useEffect(() => {
    if (ready && statsError && !getToken()) router.replace("/login");
  }, [ready, statsError, router]);

  const chartData = useMemo(() => {
    return (stats?.agents ?? [])
      .slice()
      .sort((a, b) => b.run_count - a.run_count)
      .slice(0, 5)
      .map((a) => ({
        name: a.name.length > 12 ? `${a.name.slice(0, 11)}…` : a.name,
        runs: a.run_count,
      }));
  }, [stats]);
  const hasAgentRuns = chartData.some((d) => d.runs > 0);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="workspace overview"
        title="Dashboard"
        description="Everything you've built, run, and spent — at a glance."
      >
        <Button variant="outline" size="icon-sm" aria-label="Refresh stats" onClick={reloadStats}>
          <RefreshCwIcon />
        </Button>
        <Button variant="outline" render={<Link href="/agents" />}>
          My agents
        </Button>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v ?? "overview")}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">My runs</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------- overview */}
        <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
          {statsError && !stats ? (
            <PanelError message={statsError} onRetry={reloadStats} />
          ) : !stats ? (
            <OverviewSkeleton />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard
                  icon={BotIcon}
                  chip="brand"
                  label="agents"
                  value={String(stats.agents_count)}
                  sub={`${stats.published_count} published`}
                />
                <StatCard
                  icon={ActivityIcon}
                  chip="success"
                  label="runs"
                  value={stats.runs_count.toLocaleString()}
                  sub={`${(stats.success_rate * 100).toFixed(0)}% success rate`}
                />
                <StatCard
                  icon={TimerIcon}
                  label="avg latency"
                  value={
                    stats.avg_latency_ms != null
                      ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s`
                      : "—"
                  }
                  sub={
                    stats.avg_steps != null
                      ? `${stats.avg_steps.toFixed(1)} tool steps avg`
                      : "no steps recorded"
                  }
                />
                <StatCard
                  icon={WalletIcon}
                  chip="brand"
                  label="marketplace spend"
                  value={formatMoney(stats.spent_minor, stats.currency)}
                  sub={`${stats.purchases_count} orders · ${stats.active_subscriptions} active subscriptions`}
                />
                <StatCard
                  icon={CoinsIcon}
                  label="tokens"
                  value={stats.total_tokens ? stats.total_tokens.toLocaleString() : "0"}
                  sub={`${stats.total_input_tokens.toLocaleString()} in · ${stats.total_output_tokens.toLocaleString()} out`}
                />
                <StatCard
                  icon={CircleDollarSignIcon}
                  chip="warning"
                  label="est. cost"
                  value={`$${stats.total_estimated_cost_usd.toFixed(4)}`}
                  sub={
                    stats.avg_cost_per_run != null
                      ? `$${stats.avg_cost_per_run.toFixed(6)} / run`
                      : "per-run cost unavailable"
                  }
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle>Runs by agent</CardTitle>
                    <CardDescription>Top five of your agents by run count.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {stats.agents.length === 0 ? (
                      <EmptyState
                        title="No agents yet"
                        hint="Build your first agent — it only takes a prompt and a model."
                        actionHref="/agents"
                        actionLabel="Create an agent"
                      />
                    ) : !hasAgentRuns ? (
                      <EmptyState
                        title="No runs yet"
                        hint="Open an agent's console and fire off a run — totals land here."
                        actionHref="/agents"
                        actionLabel="Open my agents"
                      />
                    ) : (
                      <div className="h-60 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={chartData}
                            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="var(--border)"
                            />
                            <XAxis
                              dataKey="name"
                              tickLine={false}
                              axisLine={{ stroke: "var(--border)" }}
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                              interval={0}
                            />
                            <YAxis
                              allowDecimals={false}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            />
                            <Tooltip
                              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                              contentStyle={{
                                backgroundColor: "var(--popover)",
                                borderColor: "var(--border)",
                                borderRadius: 10,
                                fontSize: 11,
                                color: "var(--popover-foreground)",
                              }}
                            />
                            <Bar
                              dataKey="runs"
                              name="runs"
                              fill="var(--chart-1)"
                              radius={[4, 4, 0, 0]}
                              maxBarSize={44}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>My agents</CardTitle>
                    <CardDescription>
                      {stats.agents.length} agent{stats.agents.length === 1 ? "" : "s"} built so
                      far.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {stats.agents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                        <p className="text-sm font-medium">No agents yet</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Build one in seconds — free plans work out of the box.
                        </p>
                      </div>
                    ) : (
                      stats.agents.map((agent) => (
                        <Link
                          key={agent.id}
                          href={`/agents/${agent.id}`}
                          className="group flex items-center gap-3 rounded-lg bg-muted/40 px-2.5 py-2 ring-1 ring-foreground/5 transition-colors hover:bg-muted/70 hover:ring-foreground/10"
                        >
                          <AgentMonogram agent={{ id: agent.id, name: agent.name }} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {agent.name}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {agent.run_count} run{agent.run_count === 1 ? "" : "s"}
                          </span>
                          {agent.is_published ? (
                            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                              listed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              private
                            </Badge>
                          )}
                        </Link>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              {stats.evaluations_count > 0 && (
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2.5 text-sm">
                      <span
                        aria-hidden
                        className="flex size-6 items-center justify-center rounded-md bg-success/10 text-success ring-1 ring-success/20"
                      >
                        <SparklesIcon className="size-3.5" />
                      </span>
                      Evaluation quality
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-2xl leading-none font-medium">
                      {stats.avg_evaluation_score != null
                        ? stats.avg_evaluation_score.toFixed(1)
                        : "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      avg score / 10 across {stats.evaluations_count} evaluation
                      {stats.evaluations_count === 1 ? "" : "s"}
                    </span>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* --------------------------------------------------- my runs */}
        <TabsContent value="runs" className="flex flex-col gap-4 pt-4">
          {statsError && !stats ? (
            <PanelError message={statsError} onRetry={reloadStats} />
          ) : !stats ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : stats.recent_runs.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>My runs</CardTitle>
                <CardDescription>The latest runs across all of your agents.</CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  title="No runs yet"
                  hint="Fire off a run from an agent's console — latency, tokens, and status will show up here."
                  actionHref="/agents"
                  actionLabel="Open my agents"
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>My runs</CardTitle>
                <CardDescription>
                  Latest {stats.recent_runs.length} run{stats.recent_runs.length === 1 ? "" : "s"}{" "}
                  across your agents — click one to open its console.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recent_runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Link
                            href={`/agents/${run.agent_id}`}
                            title={run.input}
                            className="block max-w-[22rem] truncate font-medium hover:underline"
                          >
                            {run.input}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/agents/${run.agent_id}`}
                            className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            agent #{run.agent_id}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {run.latency_ms != null
                            ? `${(run.latency_ms / 1000).toFixed(1)}s`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {run.total_tokens != null ? run.total_tokens.toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {new Date(run.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* -------------------------------------------------- api keys */}
        <TabsContent value="keys" className="pt-4">
          <ApiKeysPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* --------------------------------------------------------------- api keys */

function ApiKeysPanel() {
  const {
    data: keys,
    loading: keysLoading,
    error: keysError,
    reload: reloadKeys,
  } = useApiQuery<ApiKeyPublic[]>("/api-keys/");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  /** Raw key from POST — shown exactly once, never stored again. */
  const [reveal, setReveal] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  /** Key awaiting revoke confirmation. */
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyPublic | null>(null);
  const [revoking, setRevoking] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const created = await api<ApiKeyCreateResponse>("/api-keys/", {
        method: "POST",
        body: { name: trimmed },
      });
      toast.success(`API key "${created.name}" created`);
      setName("");
      setCreateOpen(false);
      setReveal(created);
      reloadKeys();
    } catch (e) {
      toast.error(messageFromError(e));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    try {
      await api(`/api-keys/${revokeTarget.id}`, { method: "DELETE" });
      toast.success(`Revoked "${revokeTarget.name}"`);
      setRevokeTarget(null);
      reloadKeys();
    } catch (e) {
      toast.error(messageFromError(e));
    } finally {
      setRevoking(false);
    }
  };

  const copyRawKey = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.raw_key);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the key and copy it manually.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          API keys
        </CardTitle>
        <CardDescription>Run your agents from scripts, bots, and apps.</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New key
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {keysError && !keys ? (
          <PanelError message={keysError} onRetry={reloadKeys} />
        ) : keysLoading && !keys ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-foreground/5"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-14 rounded-md" />
            </div>
          ))
        ) : !keys || keys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">No API keys yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create one to run agents from scripts and bots.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create first key
            </Button>
          </div>
        ) : (
          keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 ring-1 ring-foreground/5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{k.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{k.key_prefix}…</p>
              </div>
              {k.is_active ? (
                <Button size="xs" variant="destructive" onClick={() => setRevokeTarget(k)}>
                  <Trash2Icon />
                  Revoke
                </Button>
              ) : (
                <Badge variant="destructive">revoked</Badge>
              )}
            </div>
          ))
        )}
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          Use as <code className="text-foreground">Authorization: Bearer ask_…</code> to run agents
          programmatically.
        </p>
      </CardContent>

      {/* create key */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!o && !creating) setCreateOpen(false);
        }}
      >
        <DialogContent>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <DialogHeader>
              <DialogTitle>Create a new key</DialogTitle>
              <DialogDescription>
                Give it a recognizable name — you can revoke it at any time.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="api-key-name">Key name</Label>
              <Input
                id="api-key-name"
                placeholder="Key name (e.g. Production Bot)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* copy-once reveal — the raw key is never sent again */}
      <Dialog
        open={reveal !== null}
        onOpenChange={(o) => {
          if (!o) setReveal(null);
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>Key &ldquo;{reveal?.name}&rdquo; is ready to use.</DialogDescription>
          </DialogHeader>
          {reveal && (
            <div className="grid gap-3">
              <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>Copy it now — for security, it won&apos;t be shown again.</span>
              </p>
              <code className="block rounded-lg bg-muted px-3 py-2.5 font-mono text-xs break-all select-all">
                {reveal.raw_key}
              </code>
              <DialogFooter>
                <Button variant="outline" onClick={() => void copyRawKey()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy key"}
                </Button>
                <Button onClick={() => setReveal(null)}>Done — I saved it</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* revoke confirmation */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(o) => {
          if (!o && !revoking) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &ldquo;{revokeTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Scripts and bots using this key will immediately lose access. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Keep key</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={() => void revoke()}
            >
              <Trash2Icon />
              {revoking ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
