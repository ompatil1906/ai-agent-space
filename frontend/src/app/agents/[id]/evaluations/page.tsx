"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/api";

interface Evaluation {
  id: number;
  input: string;
  agent_output?: string;
  score: number;
  explanation?: string;
  criteria?: string;
  created_at: string;
}

interface Summary {
  count: number;
  average_score: number;
  recent: Evaluation[];
}

function EvaluationsContent() {
  const params = useParams();
  const agentId = params.id as string;
  const [token, setToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [evalInput, setEvalInput] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) {
      window.location.href = "/login";
      return;
    }
    setToken(t);
    loadData(t);
  }, [agentId]);

  const loadData = async (t: string) => {
    setLoading(true);
    try {
      const [sumRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/agents/${agentId}/evaluations/summary`, {
          headers: { Authorization: `Bearer ${t}` },
        }),
        fetch(`${API_BASE}/agents/${agentId}/evaluations?limit=30`, {
          headers: { Authorization: `Bearer ${t}` },
        }),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (listRes.ok) setEvals(await listRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const runEvaluation = async () => {
    if (!token || !evalInput.trim()) return;
    setRunning(true);
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input: evalInput }),
      });
      if (res.ok) {
        setEvalInput("");
        await loadData(token);
      } else {
        alert("Evaluation failed: " + (await res.text()));
      }
    } finally {
      setRunning(false);
    }
  };

  // Simple bar chart data from recent scores
  const chartData = (summary?.recent || []).slice().reverse().slice(-12);

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            agent · {agentId} · llm-as-judge
          </p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Evaluation Dashboard</h1>
        </div>
        <Link href={`/agents/${agentId}`}>
          <Button variant="outline">Back to Agent</Button>
        </Link>
      </div>

      {loading ? (
        <p>Loading evaluations...</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Total Evaluations</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-3xl font-medium">{summary?.count ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Average Score</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-3xl font-medium">{summary?.average_score?.toFixed(1) ?? "—"}</p>
                <p className="text-xs text-muted-foreground">/ 10</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-16">
                  {chartData.map((e, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-primary/80 rounded-t transition-all"
                      style={{ height: `${Math.max(8, (e.score / 10) * 100)}%` }}
                      title={`${e.score.toFixed(1)}`}
                    />
                  ))}
                  {chartData.length === 0 && <span className="text-xs text-muted-foreground">No data</span>}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Run New Evaluation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="w-full min-h-[80px] rounded-lg border border-input bg-transparent p-3 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Enter a test input to evaluate the agent..."
                value={evalInput}
                onChange={(e) => setEvalInput(e.target.value)}
              />
              <Button onClick={runEvaluation} disabled={running || !evalInput.trim()}>
                {running ? "Evaluating..." : "Evaluate Now"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evaluation History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {evals.length === 0 && <p className="font-mono text-sm text-muted-foreground">No evaluations yet.</p>}
              {evals.map((ev) => (
                <div key={ev.id} className="space-y-2 rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between">
                    <Badge variant={ev.score >= 7 ? "default" : ev.score >= 5 ? "secondary" : "destructive"} className="font-mono">
                      Score: {ev.score.toFixed(1)} / 10
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(ev.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm"><span className="font-mono text-xs text-muted-foreground">input: </span>{ev.input}</p>
                  {ev.agent_output && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      <span className="font-mono text-xs">output: </span>{ev.agent_output}
                    </p>
                  )}
                  {ev.explanation && (
                    <p className="text-sm text-muted-foreground italic">{ev.explanation}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function EvaluationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading evaluations...</p>
        </div>
      }
    >
      <EvaluationsContent />
    </Suspense>
  );
}
