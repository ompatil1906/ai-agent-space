"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/api";

interface AgentStatsItem {
  id: number;
  name: string;
  is_published: boolean;
  price: number;
  run_count: number;
}

interface RecentRunItem {
  id: number;
  agent_id: number;
  input: string;
  status: string;
  latency_ms: number | null;
  steps_count: number | null;
  created_at: string;
}

interface UserStats {
  agents_count: number;
  published_count: number;
  runs_count: number;
  completed_runs: number;
  success_rate: number;
  avg_latency_ms: number | null;
  avg_steps: number | null;
  evaluations_count: number;
  avg_evaluation_score: number | null;
  credits: number;
  earnings: number;
  spend: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_estimated_cost_usd: number;
  avg_cost_per_run: number | null;
  agents: AgentStatsItem[];
  recent_runs: RecentRunItem[];
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-xs uppercase text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-3xl font-medium">{value}</p>
        {sub && <p className="mt-1 font-mono text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    fetch(`${API_BASE}/users/me/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load stats"))))
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto max-w-6xl p-6">
        <p className="font-mono text-sm text-muted-foreground">loading dashboard…</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">workspace overview</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Dashboard</h1>
        </div>
        <Link href="/agents">
          <Button variant="outline">My Agents</Button>
        </Link>
      </div>

      {error && <p className="font-mono text-sm text-red-400">{error}</p>}

      {stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="agents" value={String(stats.agents_count)} sub={`${stats.published_count} published`} />
            <StatCard
              label="runs"
              value={String(stats.runs_count)}
              sub={`success rate ${(stats.success_rate * 100).toFixed(0)}%`}
            />
            <StatCard
              label="avg latency"
              value={stats.avg_latency_ms != null ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
              sub={stats.avg_steps != null ? `${stats.avg_steps.toFixed(1)} steps avg` : undefined}
            />
            <StatCard label="credits" value={String(stats.credits)} sub={`earned ${stats.earnings} · spent ${stats.spend}`} />
            <StatCard
              label="tokens"
              value={stats.total_tokens ? stats.total_tokens.toLocaleString() : "0"}
              sub={`${stats.total_input_tokens.toLocaleString()} in · ${stats.total_output_tokens.toLocaleString()} out`}
            />
            <StatCard
              label="est. cost"
              value={`$${stats.total_estimated_cost_usd.toFixed(4)}`}
              sub={stats.avg_cost_per_run != null ? `$${stats.avg_cost_per_run.toFixed(6)} / run` : undefined}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-sm text-muted-foreground">agents</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.agents.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center">
                    <p className="font-mono text-sm text-muted-foreground">
                      No agents yet —{" "}
                      <Link href="/agents" className="text-foreground underline underline-offset-4">
                        create one
                      </Link>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stats.agents.map((agent) => (
                      <Link
                        key={agent.id}
                        href={`/agents/${agent.id}`}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-foreground/20 hover:bg-muted/50"
                      >
                        <span className="font-medium">{agent.name}</span>
                        <span className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                          {agent.run_count} run{agent.run_count === 1 ? "" : "s"}
                          {agent.is_published ? (
                            <Badge variant="secondary" className="font-mono">
                              {agent.price === 0 ? "free" : `${agent.price} cr`}
                            </Badge>
                          ) : (
                            <span className="uppercase">private</span>
                          )}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-sm text-muted-foreground">recent runs</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.recent_runs.length === 0 ? (
                  <p className="font-mono text-sm text-muted-foreground">no runs yet</p>
                ) : (
                  <div className="space-y-2">
                    {stats.recent_runs.map((run) => (
                      <Link
                        key={run.id}
                        href={`/agents/${run.agent_id}`}
                        className="block rounded-lg border border-border px-3 py-2 transition-colors hover:border-foreground/20 hover:bg-muted/50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm">{run.input}</span>
                          <Badge
                            variant={run.status === "completed" ? "default" : run.status === "error" ? "destructive" : "secondary"}
                            className="font-mono"
                          >
                            {run.status}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          agent #{run.agent_id} · {run.latency_ms ? `${(run.latency_ms / 1000).toFixed(1)}s` : "—"} ·{" "}
                          {run.steps_count ?? 0} steps · {new Date(run.created_at).toLocaleString()}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>


            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-sm text-muted-foreground">API Keys</CardTitle>
              </CardHeader>
              <CardContent>
                <ApiKeysManager />
              </CardContent>
            </Card>

                    {stats.evaluations_count > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-sm text-muted-foreground">evaluation quality</CardTitle>
              </CardHeader>
              <CardContent className="flex items-baseline gap-3">
                <span className="font-mono text-3xl font-medium">{stats.avg_evaluation_score?.toFixed(1)}</span>
                <span className="font-mono text-xs text-muted-foreground">avg score / 10 across {stats.evaluations_count} evaluations</span>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}


function ApiKeysManager() {
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const load = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api-keys/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setKeys(await res.json());
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!token || !name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api-keys/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewRawKey(data.raw_key);
        setName("");
        load();
      }
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (id: number) => {
    if (!token) return;
    await fetch(`${API_BASE}/api-keys/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="Key name (e.g. Production Bot)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" onClick={create} disabled={loading || !name.trim()}>
          {loading ? "Creating..." : "Create"}
        </Button>
      </div>
      {newRawKey && (
        <div className="rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
          <p className="font-medium">Copy this key now — it will not be shown again:</p>
          <code className="mt-1 block break-all">{newRawKey}</code>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => setNewRawKey(null)}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="space-y-1">
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No API keys yet</p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
              <div>
                <span className="font-medium">{k.name}</span>
                <span className="ml-2 font-mono text-muted-foreground">{k.key_prefix}…</span>
                {!k.is_active && <Badge variant="destructive" className="ml-2">revoked</Badge>}
              </div>
              {k.is_active && (
                <Button size="sm" variant="ghost" onClick={() => revoke(k.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Use as <code>Authorization: Bearer ask_...</code> to run agents programmatically.
      </p>
    </div>
  );
}
