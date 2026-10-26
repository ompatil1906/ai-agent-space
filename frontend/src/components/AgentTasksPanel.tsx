"use client";

/**
 * Direct Automation panel — Devin-style "head off and do it" task runs.
 * Submit a goal; the agent executes it unattended in a background session.
 * Tasks poll until finished and can be re-opened as chat sessions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { API_BASE } from "@/lib/api";

interface Task {
  id: number;
  title: string | null;
  input: string;
  output: string | null;
  status: string; // running | completed | error | cancelled
  error: string | null;
  latency_ms: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  thread_id: string | null;
  created_at: string;
}

const STATUS_PILL: Record<string, { label: string; cls: string; dot: string }> = {
  running: { label: "running", cls: "border-warning/40 bg-warning/10 text-warning", dot: "bg-warning animate-pulse" },
  completed: { label: "done", cls: "border-success/40 bg-success/10 text-success", dot: "bg-success" },
  error: { label: "failed", cls: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  cancelled: { label: "cancelled", cls: "border-border bg-muted/60 text-muted-foreground", dot: "bg-muted-foreground/50" },
};

const relTime = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime()) / 1000);
  if (s < 60) return `${Math.max(1, s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function AgentTasksPanel({
  agentId,
  token,
  onOpenThread,
}: {
  agentId: string;
  token: string | null;
  onOpenThread: (threadId: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setTasks(await res.json());
    } catch {
      /* transient */
    }
  }, [agentId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any task is in flight
  useEffect(() => {
    const inFlight = tasks.some((t) => t.status === "running" || t.status === "pending");
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (inFlight) pollRef.current = setInterval(load, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tasks, load]);

  const createTask = async () => {
    if (!goal.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim() || goal.trim().slice(0, 80), input: goal }),
      });
      if (res.ok) {
        const t: Task = await res.json();
        setTasks((prev) => [t, ...prev]);
        setExpanded(t.id);
        setTitle("");
        setGoal("");
      }
    } finally {
      setCreating(false);
    }
  };

  const cancelTask = async (id: number) => {
    try {
      await fetch(`${API_BASE}/agents/${agentId}/tasks/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await load();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-5">
      {/* Composer */}
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="font-mono text-sm">⚡</span>
          <p className="text-sm font-medium">Direct automation — hand off a task, unattended</p>
        </div>
        <Input
          placeholder="Task title (optional, e.g. “Audit dependency risk”)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          placeholder={"Describe the outcome you want, not the conversation:\n“Research the top 3 open-source vector DBs, compare on licensing & latency, and deliver a report with a recommendation.”"}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end">
          <Button onClick={createTask} disabled={creating || !goal.trim()}>
            {creating ? "Dispatching…" : "Run Task"}
          </Button>
        </div>
      </div>

      {/* Task list */}
      <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
        {tasks.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No automation tasks yet — describe a goal above and the agent will run it end-to-end on its own.
          </p>
        )}
        {tasks.map((t) => {
          const pill = STATUS_PILL[t.status] || STATUS_PILL.cancelled;
          const isOpen = expanded === t.id;
          return (
            <div key={t.id} className="rounded-lg border border-border bg-card">
              <button
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                onClick={() => setExpanded(isOpen ? null : t.id)}
              >
                <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${pill.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.title || `Task #${t.id}`}</span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    #{t.id} · {relTime(t.created_at)}
                    {t.latency_ms ? ` · ${(t.latency_ms / 1000).toFixed(1)}s` : ""}
                    {t.total_tokens ? ` · ${t.total_tokens} tok` : ""}
                    {t.estimated_cost_usd ? ` · $${t.estimated_cost_usd.toFixed(4)}` : ""}
                  </span>
                </span>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${pill.cls}`}>
                  {pill.label}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-border px-3 py-3">
                  <p className="font-mono text-[11px] text-muted-foreground line-clamp-3">▶ goal: {t.input}</p>
                  {t.status === "running" && (
                    <p className="font-mono text-[11px] text-warning">
                      ▸ working autonomously — steps, tool calls and verification happen in the background…
                    </p>
                  )}
                  {t.error && (
                    <pre className="max-h-32 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
                      {t.error}
                    </pre>
                  )}
                  {t.output && (
                    <div className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3">
                      <Markdown className="[&_>*:first-child]:mt-0 [&_>*:last-child]:mb-0">
                        {t.output}
                      </Markdown>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {t.status === "running" && (
                      <Button size="sm" variant="destructive" onClick={() => cancelTask(t.id)}>
                        Cancel task
                      </Button>
                    )}
                    {t.thread_id && t.status === "completed" && (
                      <Button size="sm" variant="outline" onClick={() => onOpenThread(t.thread_id!)}>
                        Open as chat session
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {tasks.length > 0 && (
        <p className="font-mono text-[10px] text-muted-foreground">
          tasks run unattended · isolated session thread · “open as chat” replays it in Agent Chat
        </p>
      )}
    </div>
  );
}
