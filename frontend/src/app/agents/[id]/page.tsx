"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { API_BASE } from "@/lib/api";
import WorkflowVisualizer from "@/components/WorkflowVisualizer";

interface StreamEvent {
  type: "token" | "tool_call" | "tool_result" | "agent_step" | "reflection" | "confidence" | "done" | "error" | "approval_required" | "thought";
  content?: string;
  name?: string;
  agent?: string;
  args?: any;
  round?: number;
  confidence?: number;
  escalated?: boolean;
  output?: string;
  request_id?: string;
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
  const [currentThreadId, setCurrentThreadId] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; content: string; events?: StreamEvent[] }[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [finalConfidence, setFinalConfidence] = useState<number | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, {name: string; args: any}>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  
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

  const deleteMemory = async (memoryId: string) => {
    if (!confirm("Delete this memory?")) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/${agentId}/memories/${memoryId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const consolidateMemories = async () => {
    if (!confirm("Consolidate memories into denser summaries?")) return;
    setLoadingMemories(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/${agentId}/memories/consolidate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await loadMemories();
      } else {
        console.error(await res.text());
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
    // Start a fresh thread by default
    setCurrentThreadId(crypto.randomUUID());
    fetch(`${API_BASE}/agents/${agentId}`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.json())
      .then(setAgent);

    // Load conversation history and threads
    fetch(`${API_BASE}/agents/${agentId}/runs`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then(setRuns)
      .catch(() => setRuns([]));

    fetch(`${API_BASE}/agents/${agentId}/threads`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then(setThreads)
      .catch(() => setThreads([]));
  }, [agentId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, finalOutput, chatHistory]);

  const runAgent = async () => {
    if (!token || !input) return;
    const userMessage = input;
    setInput("");
    setLoading(true);
    setEvents([]);
    setFinalOutput("");
    setFinalConfidence(null);
    abortControllerRef.current = new AbortController();

    // Append user turn immediately
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage }]);

    const body: any = { input: userMessage, thread_id: currentThreadId };

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
        let assistantContent = "";
        const turnEvents: StreamEvent[] = [];

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
                if (parsed.type) {
                  turnEvents.push(parsed);
                  setEvents((prev) => [...prev, parsed]);
                  if (parsed.type === "approval_required" && parsed.request_id) {
                    setPendingApprovals((prev) => ({
                      ...prev,
                      [parsed.request_id]: { name: parsed.name || "tool", args: parsed.args || {} },
                    }));
                  }
                  if (parsed.type === "token") assistantContent += parsed.content || "";
                  if (parsed.type === "done") {
                    setFinalOutput(parsed.content || assistantContent);
                    setChatHistory((prev) => [...prev, { role: "assistant", content: parsed.content || assistantContent, events: turnEvents }]);
                  }
                } else if (parsed.event) {
                  const ev: StreamEvent = { type: parsed.event as any, content: parsed.data };
                  try {
                    const inner = typeof parsed.data === "string" ? JSON.parse(parsed.data) : parsed.data;
                    Object.assign(ev, inner);
                  } catch {}
                  turnEvents.push(ev);
                  if (parsed.event === "token") assistantContent += String(parsed.data || "");
                  if (parsed.event === "done") {
                    const out = ev.output != null ? String(ev.output) : (parsed.data || assistantContent);
                    setFinalOutput(out);
                    if (ev.confidence != null) setFinalConfidence(Number(ev.confidence));
                    setChatHistory((prev) => [...prev, { role: "assistant", content: out, events: turnEvents }]);
                  } else {
                    setEvents((prev) => [...prev, ev]);
                  }
                }
              } catch {
                // plain token
                const tokenEv: StreamEvent = { type: "token", content: data };
                turnEvents.push(tokenEv);
                setEvents((prev) => [...prev, tokenEv]);
                assistantContent += data;
                setFinalOutput((prev) => prev + data);
              }
            }
          }
        }
        // If no explicit done was received, still append what we have
        if (assistantContent && !turnEvents.some(e => e.type === "done")) {
          setChatHistory((prev) => [...prev, { role: "assistant", content: assistantContent, events: turnEvents }]);
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
        const out = data.output || "";
        setFinalOutput(out);
        setEvents([{ type: "done", content: out }]);
        setChatHistory((prev) => [...prev, { role: "assistant", content: out }]);
        if (data.thread_id) setCurrentThreadId(data.thread_id);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        const errEv: StreamEvent = { type: "error", content: err.message };
        setEvents((prev) => [...prev, errEv]);
        setChatHistory((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
      }
    } finally {
      setLoading(false);
      // Refresh runs and threads
      if (token) {
        fetch(`${API_BASE}/agents/${agentId}/runs`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.json())
          .then(setRuns)
          .catch(() => {});
        fetch(`${API_BASE}/agents/${agentId}/threads`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.ok ? r.json() : [])
          .then(setThreads)
          .catch(() => {});
      }
    }
  };

  const startNewThread = () => {
    setCurrentThreadId(crypto.randomUUID());
    setChatHistory([]);
    setEvents([]);
    setFinalOutput("");
    setFinalConfidence(null);
  };

  const loadThread = async (tid: string) => {
    if (!token) return;
    setCurrentThreadId(tid);
    // Reconstruct chat from runs with this thread_id
    const threadRuns = runs.filter((r) => r.thread_id === tid).sort((a, b) => a.id - b.id);
    const history: { role: "user" | "assistant"; content: string }[] = [];
    for (const r of threadRuns) {
      history.push({ role: "user", content: r.input });
      if (r.output) history.push({ role: "assistant", content: r.output });
    }
    setChatHistory(history);
    setEvents([]);
    setFinalOutput("");
  };

  const stopRun = () => {
    abortControllerRef.current?.abort();
    setLoading(false);
  };


  const resolveApproval = async (requestId: string, approved: boolean) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_BASE}/agents/approval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ request_id: requestId, approved }),
      });
      if (res.ok) {
        setPendingApprovals((prev) => {
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
      } else {
        console.error("Approval failed", await res.text());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderEvent = (ev: StreamEvent, idx: number) => {
    if (ev.type === "token") {
      return <span key={idx}>{ev.content}</span>;
    }
    if (ev.type === "approval_required" && ev.request_id && pendingApprovals[ev.request_id]) {
      return (
        <div key={idx} className="my-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <div className="font-mono text-xs font-medium text-amber-300 mb-2">
            ⚠ Approval required · {ev.name}
          </div>
          <pre className="text-xs mb-3 overflow-auto max-h-24 text-muted-foreground">{JSON.stringify(ev.args, null, 2)}</pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resolveApproval(ev.request_id!, true)}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => resolveApproval(ev.request_id!, false)}>Deny</Button>
          </div>
        </div>
      );
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
    if (ev.type === "thought") {
      return (
        <div key={idx} className="my-2 rounded-md border-l-2 border-amber-400/70 bg-amber-500/5 p-2.5 text-sm italic">
          <div className="font-mono text-xs font-medium text-amber-300">
            💭 thought · {ev.agent || "agent"}
          </div>
          <div className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{ev.content}</div>
        </div>
      );
    }
    if (ev.type === "agent_step") {
      return (
        <div key={idx} className="my-2 rounded-md border-l-2 border-purple-400/70 bg-purple-500/10 p-2.5 text-sm">
          <div className="font-mono text-xs font-medium text-purple-300">
            ▸ {ev.agent || "agent"}
          </div>
          <div className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{ev.content}</div>
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
        <div className="flex gap-2 mt-3 flex-wrap">
          <Badge variant="secondary" className="font-mono">{agent?.model_name}</Badge>
          {agent?.workflow_config?.type && agent.workflow_config.type !== "single" && (
            <Badge variant="outline" className="font-mono">{agent.workflow_config.type} multi-agent</Badge>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" size="sm" asChild>
            <a href={`/agents/${agentId}/versions`}>Versions</a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/agents/${agentId}/evaluations`}>Evaluations</a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/agents`}>All Agents</a>
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>Conversation</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={startNewThread}>New Chat</Button>
            {threads.length > 0 && (
              <select
                className="rounded-md border border-input bg-transparent px-2 py-1 text-xs font-mono"
                value=""
                onChange={(e) => e.target.value && loadThread(e.target.value)}
              >
                <option value="">Load previous thread…</option>
                {threads.map((t) => (
                  <option key={t.thread_id} value={t.thread_id}>
                    {t.last_input} ({t.run_count})
                  </option>
                ))}
              </select>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs font-mono text-muted-foreground">
            Thread: {currentThreadId.slice(0, 8)}…
          </div>
          <div className="max-h-[400px] overflow-auto space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            {chatHistory.length === 0 && (
              <p className="text-sm text-muted-foreground italic">Start a conversation. The agent will remember this thread.</p>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border border-border"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-background border border-border px-4 py-2 text-sm text-muted-foreground">
                  Thinking…
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <Textarea
            placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!loading && input.trim()) runAgent();
              }
            }}
            rows={3}
          />
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />
              stream
            </label>
            {loading ? (
              <Button variant="destructive" onClick={stopRun}>Stop</Button>
            ) : (
              <Button onClick={runAgent} disabled={!input.trim()}>Send</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-mono text-sm text-muted-foreground">live tool calls & events</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={outputRef}
            className="min-h-[100px] max-h-[280px] overflow-auto rounded-lg border border-border bg-black/40 p-4 font-mono text-sm whitespace-pre-wrap"
          >
            {events.length === 0 && (
              <p className="text-muted-foreground">$ tool calls and intermediate events appear here</p>
            )}
            {events.map(renderEvent)}
            {finalConfidence != null && (
              <div className="mt-3 text-xs text-muted-foreground">
                Confidence: {(finalConfidence * 100).toFixed(0)}%
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
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-2">Workflow Structure</h3>
            <WorkflowVisualizer workflow={agent?.workflow_config} agentName={agent?.name} />
          </div>
          <p className="font-mono text-xs mt-2">
            <span className="text-muted-foreground">raw workflow:</span> {JSON.stringify(agent?.workflow_config || {})}
          </p>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Long-term Memories</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={consolidateMemories} disabled={loadingMemories}>
                  Consolidate
                </Button>
                <Button size="sm" variant="outline" onClick={loadMemories} disabled={loadingMemories}>
                  {loadingMemories ? "Loading..." : "Refresh"}
                </Button>
              </div>
            </div>
            {memories.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">No long-term memories stored yet.</p>
            ) : (
              <div className="mt-2 space-y-2 max-h-48 overflow-auto">
                {memories.map((m) => (
                  <div key={m.id} className="text-xs border rounded p-2 flex justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-mono text-muted-foreground">{m.id.slice(0, 8)}...</div>
                      <div className="mt-1">{m.text.slice(0, 200)}{m.text.length > 200 ? "..." : ""}</div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-red-500" onClick={() => deleteMemory(m.id)}>
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
