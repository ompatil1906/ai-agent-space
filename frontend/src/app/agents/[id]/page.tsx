"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { API_BASE } from "@/lib/api";

interface StreamEvent {
  type: "token" | "tool_call" | "tool_result" | "agent_step" | "reflection" | "confidence" | "done" | "error";
  content?: string;
  name?: string;
  agent?: string;
  args?: any;
  round?: number;
  confidence?: number;
  escalated?: boolean;
  output?: string;
}

function AgentRunContent() {
  const params = useParams();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<any>(null);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [memories, setMemories] = useState<any[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);
  const [threadId, setThreadId] = useState<string>("");
  const [finalConfidence, setFinalConfidence] = useState<number | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  
  const loadMemories = async () => {
    if (!agentId) return;
    setLoadingMemories(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/${agentId}/memories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMemories(false);
    }
  };

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) {
      window.location.href = "/login";
      return;
    }
    setToken(t);
    fetch(`${API_BASE}/agents/${agentId}`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.json())
      .then(setAgent);

    // Load conversation history
    fetch(`${API_BASE}/agents/${agentId}/runs`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [agentId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [events, finalOutput]);

  const runAgent = async () => {
    if (!token || !input) return;
    setLoading(true);
    setEvents([]);
    setFinalOutput("");
    abortControllerRef.current = new AbortController();

    const body: any = { input };
    if (threadId) body.thread_id = threadId;
    setFinalConfidence(null);

    try {
      if (streaming) {
        const res = await fetch(`${API_BASE}/agents/${agentId}/run/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) throw new Error(await res.text());

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                // SSE events come as {event, data} from backend or direct
                // We accumulate structured events
                if (parsed.type) {
                  setEvents((prev) => [...prev, parsed]);
                  if (parsed.type === "done") setFinalOutput(parsed.content || "");
                } else if (parsed.event) {
                  // Alternative format
                  const ev: StreamEvent = { type: parsed.event as any, content: parsed.data };
                  try {
                    const inner = typeof parsed.data === "string" ? JSON.parse(parsed.data) : parsed.data;
                    Object.assign(ev, inner);
                  } catch {}
                  if (parsed.event === "done") {
                    // done payload may be plain output or a metrics object
                    if (ev.output != null) {
                      setFinalOutput(String(ev.output));
                      if (ev.confidence != null) setFinalConfidence(Number(ev.confidence));
                    } else {
                      setFinalOutput(parsed.data || "");
                    }
                  } else {
                    setEvents((prev) => [...prev, ev]);
                  }
                }
              } catch {
                // plain token
                setEvents((prev) => [...prev, { type: "token", content: data }]);
                setFinalOutput((prev) => prev + data);
              }
            }
          }
        }
      } else {
        const res = await fetch(`${API_BASE}/agents/${agentId}/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setFinalOutput(data.output || "");
        setEvents([{ type: "done", content: data.output }]);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setEvents((prev) => [...prev, { type: "error", content: err.message }]);
      }
    } finally {
      setLoading(false);
      // Refresh runs list
      if (token) {
        fetch(`${API_BASE}/agents/${agentId}/runs`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.json())
          .then(setRuns)
          .catch(() => {});
      }
    }
  };

  const stopRun = () => {
    abortControllerRef.current?.abort();
    setLoading(false);
  };

  const renderEvent = (ev: StreamEvent, idx: number) => {
    if (ev.type === "token") {
      return <span key={idx}>{ev.content}</span>;
    }
    if (ev.type === "tool_call") {
      return (
        <div key={idx} className="my-2 rounded-md border-l-2 border-blue-400/70 bg-blue-500/10 p-2.5 text-sm">
          <div className="font-mono text-xs font-medium text-blue-300">⚙ tool_call · {ev.name}</div>
          <pre className="text-xs mt-1.5 overflow-auto max-h-32 text-muted-foreground">{JSON.stringify(ev.args, null, 2)}</pre>
        </div>
      );
    }
    if (ev.type === "tool_result") {
      return (
        <div key={idx} className="my-2 rounded-md border-l-2 border-emerald-400/70 bg-emerald-500/10 p-2.5 text-sm">
          <div className="font-mono text-xs font-medium text-emerald-300">✓ tool_result · {ev.name}</div>
          <pre className="text-xs mt-1.5 overflow-auto max-h-40 whitespace-pre-wrap text-muted-foreground">{ev.content}</pre>
        </div>
      );
    }
    if (ev.type === "agent_step") {
      return (
        <div key={idx} className="my-1">
          <Badge variant="outline" className="font-mono text-xs">
            {ev.agent || "agent"}: {ev.content?.slice(0, 80)}...
          </Badge>
        </div>
      );
    }
    if (ev.type === "error") {
      return (
        <div key={idx} className="my-2 rounded-md border-l-2 border-red-500/70 bg-red-500/10 p-2.5 text-sm text-red-300">
          <span className="font-mono text-xs">error · </span>
          {ev.content}
        </div>
      );
    }
    if (ev.type === "reflection") {
      return (
        <div key={idx} className="my-2 font-mono text-xs text-muted-foreground">
          ⟳ self-check round {ev.round}: interrupted — revised answers follow
        </div>
      );
    }
    if (ev.type === "confidence") {
      const pct = Math.round((Number(ev.confidence ?? ev.content ?? 0)) * 100);
      return (
        <div key={idx} className="my-2 flex items-center gap-2 font-mono text-xs">
          <span className={pct >= 70 ? "text-emerald-300" : pct >= 40 ? "text-amber-300" : "text-red-300"}>
            ◎ confidence {pct}%
          </span>
          {ev.escalated && <span className="text-muted-foreground">· flagged for review (NEEDS HELP)</span>}
        </div>
      );
    }
    if (ev.type === "done") {
      return null; // shown separately
    }
    return null;
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          agent · {agentId}
        </p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">{agent?.name || "Agent"}</h1>
        <p className="mt-1 text-muted-foreground">{agent?.description}</p>
        <div className="flex gap-2 mt-3">
          <Badge variant="secondary" className="font-mono">{agent?.model_name}</Badge>
          {agent?.workflow_config?.type && agent.workflow_config.type !== "single" && (
            <Badge variant="outline" className="font-mono">{agent.workflow_config.type} multi-agent</Badge>
          )}
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Run Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Enter your message or task..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
          />
          <div className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="thread id (optional, for memory)"
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              className="flex-1 rounded-lg border border-input bg-transparent px-3 py-1.5 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <label className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />
              stream
            </label>
            {loading ? (
              <Button variant="destructive" onClick={stopRun}>Stop</Button>
            ) : (
              <Button onClick={runAgent} disabled={!input}>Run</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-mono text-sm text-muted-foreground">live output &amp; tool calls</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={outputRef}
            className="min-h-[200px] max-h-[500px] overflow-auto rounded-lg border border-border bg-black/40 p-4 font-mono text-sm whitespace-pre-wrap"
          >
            {events.length === 0 && !finalOutput && (
              <p className="text-muted-foreground">$ waiting for input…</p>
            )}
            {events.map(renderEvent)}
            {finalOutput && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="mb-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  final response:
                  {finalConfidence != null && (
                    <Badge variant="outline" className="font-mono">
                      {(finalConfidence * 100).toFixed(0)}% confident
                    </Badge>
                  )}
                </div>
                <div className="whitespace-pre-wrap">{finalOutput}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-mono text-sm text-muted-foreground">conversation history</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="font-mono text-sm text-muted-foreground">No previous runs yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-auto">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-border p-3 text-sm transition-colors hover:border-foreground/20 hover:bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedRun(run)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono font-medium">#{run.id}</span>
                      <Badge variant={run.status === "completed" ? "default" : "secondary"} className="ml-2 font-mono">
                        {run.status}
                      </Badge>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground truncate">in: {run.input}</p>
                  {run.output && (
                    <p className="mt-1 text-xs line-clamp-2 text-muted-foreground">{run.output.slice(0, 150)}...</p>
                  )}
                  {run.messages && run.messages.length > 0 && (
                    <p className="mt-1 font-mono text-xs text-blue-300">
                      {run.messages.filter((m: any) => m.type === "tool_call").length} tool calls recorded
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            click a run to inspect details · use thread id to continue with memory
          </p>
        </CardContent>
      </Card>

      {selectedRun && (
        <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Run #{selectedRun.id} Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div>
                <strong className="font-mono text-xs text-muted-foreground uppercase">Input</strong>
                <pre className="mt-1 rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{selectedRun.input}</pre>
              </div>
              <div>
                <strong className="font-mono text-xs text-muted-foreground uppercase">Output</strong>
                <pre className="mt-1 rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{selectedRun.output || "(none)"}</pre>
              </div>
              {selectedRun.messages && selectedRun.messages.length > 0 && (
                <div>
                  <strong className="font-mono text-xs text-muted-foreground uppercase">Event Stream / Tool Activity</strong>
                  <div className="mt-2 space-y-1 max-h-60 overflow-auto rounded-md border border-border p-2">
                    {selectedRun.messages.map((ev: any, i: number) => (
                      <div key={i} className="border-b border-border pb-1 text-xs font-mono">
                        <Badge variant="outline" className="mr-1 font-mono">{ev.type}</Badge>
                        {ev.name && <span className="font-medium">{ev.name}</span>}
                        {ev.agent && <span> ({ev.agent})</span>}
                        {ev.content && <span className="ml-1 text-muted-foreground">{String(ev.content).slice(0, 120)}</span>}
                        {ev.args && <pre className="text-xs">{JSON.stringify(ev.args)}</pre>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Button
                size="sm"
                onClick={() => {
                  setThreadId(String(selectedRun.id));
                  setSelectedRun(null);
                }}
              >
                Continue this thread
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-sm text-muted-foreground">configuration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p className="font-mono text-xs">
            <span className="text-muted-foreground">system_prompt:</span> {agent?.system_prompt?.slice(0, 300)}...
          </p>
          <p className="font-mono text-xs">
            <span className="text-muted-foreground">tools:</span> {(agent?.tools_config || []).length} configured
          </p>
          <p className="font-mono text-xs">
            <span className="text-muted-foreground">memory:</span> {JSON.stringify(agent?.memory_config || {})}
          </p>
          <p className="font-mono text-xs">
            <span className="text-muted-foreground">workflow:</span> {JSON.stringify(agent?.workflow_config || {})}

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Long-term Memories</h3>
              <Button size="sm" variant="outline" onClick={loadMemories} disabled={loadingMemories}>
                {loadingMemories ? "Loading..." : "Refresh"}
              </Button>
            </div>
            {memories.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">No long-term memories stored yet.</p>
            ) : (
              <div className="mt-2 space-y-2 max-h-48 overflow-auto">
                {memories.map((m) => (
                  <div key={m.id} className="text-xs border rounded p-2">
                    <div className="font-mono text-muted-foreground">{m.id.slice(0, 8)}...</div>
                    <div className="mt-1">{m.text.slice(0, 200)}{m.text.length > 200 ? "..." : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AgentRunPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading agent run...</p>
        </div>
      }
    >
      <AgentRunContent />
    </Suspense>
  );
}
