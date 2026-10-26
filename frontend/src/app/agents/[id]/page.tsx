"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_BASE, api, getToken } from "@/lib/api";
import AgentTasksPanel from "@/components/AgentTasksPanel";
import WorkflowVisualizer from "@/components/WorkflowVisualizer";
import AgentLanding from "@/components/marketplace/agent-landing";
import { Markdown } from "@/components/markdown";
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

interface StreamEvent {
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
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
  const router = useRouter();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<any>(null);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [memories, setMemories] = useState<any[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<any[]>([]);
  const [kbText, setKbText] = useState("");
  const [kbSourceName, setKbSourceName] = useState("");
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [streaming] = useState(true); // SSE output; threads toggle kept for future opt-out
  const [currentThreadId, setCurrentThreadId] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; content: string; events?: StreamEvent[] }[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [finalConfidence, setFinalConfidence] = useState<number | null>(null);
  const [runUsage, setRunUsage] = useState<{input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number} | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  // Which finished turns have their "what the agent did" panel expanded (by index)
  const [openActivity, setOpenActivity] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"chat" | "automation">("chat");
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, {name: string; args: any}>>({});
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  
  const loadMemories = async () => {
    if (!agentId) return;
    setLoadingMemories(true);
    try {
      const data = await api<{ memories: any[] }>(`/agents/${agentId}/memories`);
      setMemories(data.memories || []);
    } catch (e) {
      toast.error("Could not load memories", { description: (e as Error).message });
    } finally {
      setLoadingMemories(false);
    }
  };

  const deleteMemory = async (memoryId: string) => {
    setConfirm({
      title: "Delete this memory?",
      description: "The agent will no longer use or see this memory in future runs.",
      onConfirm: async () => {
        try {
          await api(`/agents/${agentId}/memories/${memoryId}`, { method: "DELETE" });
          setMemories((prev) => prev.filter((m) => m.id !== memoryId));
          toast.success("Memory deleted");
        } catch (e) {
          toast.error("Could not delete memory", { description: (e as Error).message });
        }
      },
    });
  };

  const consolidateMemories = async () => {
    setConfirm({
      title: "Compress old memories?",
      description: "Dense summaries replace fragmented memories — same facts, less storage. This can't be undone.",
      onConfirm: async () => {
        setLoadingMemories(true);
        try {
          await api(`/agents/${agentId}/memories/consolidate`, { method: "POST" });
          toast.success("Memories consolidated");
          await loadMemories();
        } catch (e) {
          toast.error("Consolidation failed", { description: (e as Error).message });
        } finally {
          setLoadingMemories(false);
        }
      },
    });
  };

  
  const loadKnowledge = async () => {
    if (!agentId) return;
    setLoadingKnowledge(true);
    try {
      const data = await api<{ sources: any[] }>(`/agents/${agentId}/knowledge`);
      setKnowledgeSources(data.sources || []);
    } catch (e) {
      toast.error("Could not load documents", { description: (e as Error).message });
    } finally {
      setLoadingKnowledge(false);
    }
  };

  const addKnowledge = async () => {
    if (!kbText.trim()) return;
    setLoadingKnowledge(true);
    try {
      await api(`/agents/${agentId}/knowledge`, {
        method: "POST",
        body: {
          text: kbText,
          source_name: kbSourceName.trim() || "document",
        },
      });
      setKbText("");
      setKbSourceName("");
      toast.success("Document saved", { description: "The agent can read it during any task or chat." });
      await loadKnowledge();
    } catch (e) {
      toast.error("Could not save document", { description: (e as Error).message });
    } finally {
      setLoadingKnowledge(false);
    }
  };

  const deleteKnowledgeSource = async (source: string) => {
    setConfirm({
      title: `Delete “${source}”?`,
      description: "All knowledge chunks from this source are removed permanently.",
      onConfirm: async () => {
        try {
          await api(`/agents/${agentId}/knowledge/${encodeURIComponent(source)}`, { method: "DELETE" });
          toast.success("Document deleted");
          await loadKnowledge();
        } catch (e) {
          toast.error("Could not delete document", { description: (e as Error).message });
        }
      },
    });
  };

  useEffect(() => {
    const t = getToken();
    if (!t) {
      router.replace("/login");
      return;
    }
    setToken(t);
    // Start a fresh thread by default
    setCurrentThreadId(crypto.randomUUID());
    api(`/agents/${agentId}`)
      .then(setAgent)
      .catch(() => toast.error("Could not load agent", { description: "Check that this agent exists and is still yours." }));

    // Load conversation history and threads
    api<any[]>(`/agents/${agentId}/runs`)
      .then(setRuns)
      .catch(() => setRuns([]));

    api<any[]>(`/agents/${agentId}/threads`)
      .then(setThreads)
      .catch(() => setThreads([]));

    // Load memories and knowledge base
    loadMemories();
    loadKnowledge();
  }, [agentId, router]);

  useEffect(() => {
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
    setRunUsage(null);
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
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify(body),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) {
          const detail = await res
            .json()
            .then((d) => (d && typeof d.detail === "string" ? d.detail : (d?.detail as any)?.toString?.()))
            .catch(() => null);
          throw new Error(detail || `Run failed (HTTP ${res.status})`);
        }

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
                  if (parsed.usage) setRunUsage(parsed.usage);
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
                  if (ev.usage) setRunUsage(ev.usage);
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
        const data = await api<any>(`/agents/${agentId}/run`, { method: "POST", body });
        const out = data.output || "";
        setFinalOutput(out);
        setEvents([{ type: "done", content: out }]);
        setChatHistory((prev) => [...prev, { role: "assistant", content: out }]);
        if (data.usage) setRunUsage(data.usage);
        if (data.confidence != null) setFinalConfidence(Number(data.confidence));
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
      if (getToken()) {
        api<any[]>(`/agents/${agentId}/runs`).then(setRuns).catch(() => {});
        api<any[]>(`/agents/${agentId}/threads`).then(setThreads).catch(() => setRuns([]));
      }
    }
  };

  const startNewThread = () => {
    setCurrentThreadId(crypto.randomUUID());
    setChatHistory([]);
    setEvents([]);
    setFinalOutput("");
    setFinalConfidence(null);
    setRunUsage(null);
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
    try {
      await api("/agents/approval", {
        method: "POST",
        body: { request_id: requestId, approved },
      });
      setPendingApprovals((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    } catch (e) {
      toast.error("Approval failed", { description: (e as Error).message });
    }
  };

  // ---- Plain-language activity rendering ----
  // Raw stream events (tool_call, agent_step, thought, …) are translated into
  // short human-readable status lines. Technical JSON stays behind "details".
  const prettyName = (raw: string) =>
    raw
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .trim()
      .toLowerCase() || "a tool";

  const shorten = (text: string, n = 70) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  };

  const activityLines = (evs: StreamEvent[]): string[] => {
    const lines: string[] = [];
    for (const ev of evs) {
      if (ev.type === "tool_call") lines.push(`🔧 Using ${prettyName(ev.name || "")}…`);
      else if (ev.type === "tool_result") lines.push(`✓ ${prettyName(ev.name || "")} worked`);
      else if (ev.type === "agent_step") lines.push(`▸ ${ev.agent || "Step"}: ${shorten(ev.content || "")}`);
      else if (ev.type === "thought" && ev.content) lines.push(`💭 ${shorten(ev.content, 90)}`);
      else if (ev.type === "reflection") lines.push(`⟳ Double-checking its answer…`);
      else if (ev.type === "error") lines.push(`⚠ ${shorten(ev.content || "", 90)}`);
    }
    return lines;
  };

  const toolCount = (evs: StreamEvent[]) => evs.filter((e) => e.type === "tool_call").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/agents" className="transition-colors hover:text-foreground">
            My agents
          </Link>
          <span>/</span>
          <span className="text-foreground">{agent?.name || `agent ${agentId}`}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-muted-foreground font-mono text-[11px] uppercase tracking-widest">
              agent console
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">
              {agent?.name || "Agent"}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {agent?.description || "Chat with it, or hand it a task to run on its own."}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" render={<Link href={`/agents/${agentId}/versions`} />}>
              Versions
            </Button>
            <Button variant="ghost" size="sm" render={<Link href={`/agents/${agentId}/evaluations`} />}>
              Quality checks
            </Button>
          </div>
        </div>
      </div>
      <div className="text-muted-foreground mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="text-[10px] font-mono">{agent?.model_name}</Badge>
        {agent?.tools_config && agent.tools_config.length > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono text-success">
            {agent.tools_config.length} tool{agent.tools_config.length === 1 ? "" : "s"}
          </Badge>
        )}
        {agent?.workflow_config?.type && agent.workflow_config.type !== "single" && (
          <Badge variant="outline" className="text-[10px] font-mono">team</Badge>
        )}
        {agent?.autonomy_level && (
          <Badge variant="outline" className="text-[10px] font-mono">{agent.autonomy_level}</Badge>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div className="bg-muted inline-flex h-8 items-center rounded-lg p-[3px]">
            {(
              [
                { value: "chat", label: "Chat", hint: "Back-and-forth conversation — the agent remembers the thread" },
                { value: "automation", label: "Give a task", hint: "Hand off a goal — it works alone and delivers a report" },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                title={t.hint}
                onClick={() => setMode(t.value)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-all ${
                  mode === t.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {mode === "chat" && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={startNewThread}>New thread</Button>
              {threads.length > 0 && (
                <Select
                  value=""
                  onValueChange={(v) => v && loadThread(v)}
                >
                  <SelectTrigger size="sm" className="w-56" aria-label="Load previous thread">
                    <SelectValue placeholder="Load previous thread…" />
                  </SelectTrigger>
                  <SelectContent>
                    {threads.map((t) => (
                      <SelectItem key={t.thread_id} value={String(t.thread_id)}>
                        {t.last_input?.slice(0, 40) || t.thread_id.slice(0, 8)} ({t.run_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "automation" ? (
            <AgentTasksPanel
              agentId={agentId}
              token={token}
              onOpenThread={(tid) => {
                setMode("chat");
                void loadThread(tid);
              }}
            />
          ) : (
            <>
          <div className="max-h-[480px] overflow-auto space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            {chatHistory.length === 0 && !loading && (
              <p className="py-10 text-center text-sm text-muted-foreground italic">
                Say hello, ask a question, or give an instruction — everything you say here is remembered.
              </p>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background border border-border"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <Markdown className="[&_>*:first-child]:mt-0 [&_>*:last-child]:mb-0">
                      {msg.content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl border border-border bg-background px-4 py-3 text-sm">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-success" />
                    Working…
                  </p>
                  {activityLines(events).filter((l) => !l.startsWith("💭") && !l.startsWith("⟳")).slice(-4).map((line, li) => (
                    <p key={li} className="mt-1.5 text-xs text-muted-foreground">{line}</p>
                  ))}
                  {events.filter((e) => e.type === "token").length > 0 && (
                    <div className="mt-2">
                      <Markdown>
                        {events
                          .filter((e) => e.type === "token")
                          .map((e) => e.content || "")
                          .join("")}
                      </Markdown>
                    </div>
                  )}
                </div>
              </div>
            )}
            {!loading && chatHistory.length > 0 &&
              chatHistory[chatHistory.length - 1]?.role === "assistant" &&
              toolCount(chatHistory[chatHistory.length - 1]?.events || []) > 0 && (
              <div className="flex flex-col items-start gap-1.5">
                <button
                  className="rounded-full px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    const last = chatHistory.length - 1;
                    setOpenActivity((prev) => ({ ...prev, [last]: !prev[last] }));
                  }}
                >
                  {openActivity[chatHistory.length - 1] ? "▾" : "▸"} what it did ·{" "}
                  {toolCount(chatHistory[chatHistory.length - 1].events || [])} tool{" "}
                  {toolCount(chatHistory[chatHistory.length - 1].events || []) === 1 ? "call" : "calls"}
                </button>
                {openActivity[chatHistory.length - 1] && (
                  <div className="max-w-[80%] space-y-1 rounded-xl border border-dashed border-border bg-background/60 px-3.5 py-2.5 text-xs">
                    {activityLines(chatHistory[chatHistory.length - 1].events || []).map((line, li) => (
                      <p key={li} className="text-muted-foreground">{line}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {runUsage && (
            <p className="text-right font-mono text-[10px] text-muted-foreground">
              {runUsage.total_tokens} tokens · ≈ ${runUsage.estimated_cost_usd.toFixed(5)}
            </p>
          )}
          {!loading && finalConfidence != null && (
            <p className="text-right font-mono text-[10px] text-muted-foreground">
              answer confidence: {Math.round(finalConfidence * 100)}%
            </p>
          )}
          {Object.entries(pendingApprovals).length > 0 && (
            <p className="text-sm font-medium">The agent needs your OK before it continues:</p>
          )}
          {Object.entries(pendingApprovals).map(([rid, a]) => {
            const req = a as { name: string; args: Record<string, unknown> };
            return (
              <div key={rid} className="rounded-xl border border-warning/40 bg-warning/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-warning">
                  <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-warning" />
                  Wants to use {prettyName(req.name || "a tool")}
                </p>
                <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-background/60 p-2 text-xs text-muted-foreground">
                  {JSON.stringify(req.args ?? {}, null, 2)}
                </pre>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => resolveApproval(rid, true)}>Allow</Button>
                  <Button size="sm" variant="outline" onClick={() => resolveApproval(rid, false)}>Deny</Button>
                </div>
              </div>
            );
          })}
          <Textarea
            placeholder="Type your message…"
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
          <div className="flex items-center gap-3">
            {loading ? (
              <Button variant="destructive" onClick={stopRun}>Stop</Button>
            ) : (
              <Button onClick={runAgent} disabled={!input.trim()}>Send</Button>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
          </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Past conversations</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous conversations yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-auto">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-border p-3 text-sm transition-colors hover:border-foreground/20 hover:bg-muted/50 cursor-pointer"
                  onClick={() => loadThread(run.thread_id || String(run.id))}
                >
                  <div className="flex justify-between items-start gap-3">
                    <p className="truncate font-medium">{run.input}</p>
                    <Badge
                      variant="outline"
                      className={`shrink-0 font-mono text-[10px] ${
                        run.status === "completed"
                          ? "text-success border-success/30 bg-success/10"
                          : run.status === "error"
                            ? "text-destructive border-destructive/30 bg-destructive/10"
                            : run.status === "running" || run.status === "pending"
                              ? "text-warning border-warning/30 bg-warning/10"
                              : "text-muted-foreground"
                      }`}
                    >
                      {run.status === "completed" ? "done" : run.status}
                    </Badge>
                  </div>
                  {run.output && (
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{run.output.slice(0, 120)}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Click one to open it and continue where you left off.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">How this agent is set up</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground">
              Technical details
            </summary>
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p><span className="font-medium">Instructions:</span> {agent?.system_prompt?.slice(0, 300)}{agent?.system_prompt && agent.system_prompt.length > 300 ? "…" : ""}</p>
              <p><span className="font-medium">Tools:</span> {(agent?.tools_config || []).length} connected</p>
              <p><span className="font-medium">Memory:</span> {agent?.memory_config?.window_ms ? "remembers recent conversations" : "standard memory"}</p>
            </div>
          </details>
          <div>
            <h3 className="mb-2 text-sm font-medium">Workflow</h3>
            <WorkflowVisualizer workflow={agent?.workflow_config} agentName={agent?.name} />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">What it remembers about you</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={consolidateMemories} disabled={loadingMemories}>
                  Compress old memories
                </Button>
                <Button size="sm" variant="outline" onClick={loadMemories} disabled={loadingMemories}>
                  {loadingMemories ? "Loading..." : "Refresh"}
                </Button>
              </div>
            </div>
            {memories.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">Nothing yet — the agent saves important things it learns as you talk.</p>
            ) : (
              <div className="mt-2 space-y-2 max-h-48 overflow-auto">
                {memories.map((m) => (
                  <div key={m.id} className="text-xs rounded-lg border border-border bg-card p-2 flex justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-mono text-muted-foreground">{m.id.slice(0, 8)}</div>
                      <div className="mt-1">{m.text.slice(0, 200)}{m.text.length > 200 ? "..." : ""}</div>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => deleteMemory(m.id)}
                      aria-label="Delete memory"
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Documents it knows</h3>
              <Button size="sm" variant="outline" onClick={loadKnowledge} disabled={loadingKnowledge}>
                {loadingKnowledge ? "Loading..." : "Refresh"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Paste notes, specs, or docs below — the agent can read them during any task or chat.
            </p>
            <div className="space-y-2 mb-3">
              <Input
                type="text"
                placeholder="Document name (e.g. product-docs.md)"
                value={kbSourceName}
                onChange={(e) => setKbSourceName(e.target.value)}
              />
              <Textarea
                placeholder="Paste document text here (markdown, notes, specs...)"
                value={kbText}
                onChange={(e) => setKbText(e.target.value)}
                className="min-h-20 text-xs"
              />
              <Button size="sm" variant="outline" onClick={addKnowledge} disabled={loadingKnowledge || !kbText.trim()}>
                {loadingKnowledge ? "Adding…" : "Save document"}
              </Button>
            </div>
            {knowledgeSources.length === 0 ? (
              <p className="text-xs text-muted-foreground">No documents yet — paste one above and it’s saved to this agent.</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-auto">
                {knowledgeSources.map((src: any) => (
                  <div key={src.source} className="text-xs rounded-lg border border-border bg-card p-2 flex justify-between items-start gap-2">
                    <div>
                      <div className="font-medium">{src.source}</div>
                      <div className="text-muted-foreground">{src.chunk_count} chunk(s)</div>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => deleteKnowledgeSource(src.source)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* shared confirm dialog for destructive actions */}
      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
                void confirm?.onConfirm();
                setConfirm(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Shared route: /agents/{numeric-id} is a creator/entitled runtime console;
 * /agents/{slug} is the public marketplace landing page. The dynamic segment
 * carries either, branched here on numeric shape.
 */
function AgentRoute() {
  const params = useParams();
  const raw = String(params.id ?? "");
  if (!/^\d+$/.test(raw)) {
    // Public marketplace landing (token handled inside the component).
    return <AgentLanding slug={raw} />;
  }
  return <AgentRunContent />;
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
      <AgentRoute />
    </Suspense>
  );
}
