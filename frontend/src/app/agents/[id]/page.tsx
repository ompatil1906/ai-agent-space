"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { API_BASE } from "@/lib/api";

interface StreamEvent {
  type: "token" | "tool_call" | "tool_result" | "agent_step" | "done" | "error";
  content?: string;
  name?: string;
  agent?: string;
  args?: any;
}

function AgentRunContent() {
  const params = useParams();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<any>(null);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);
  const [threadId, setThreadId] = useState<string>("");
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

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
                  if (parsed.event === "tool_call" || parsed.event === "tool_result" || parsed.event === "agent_step") {
                    try {
                      const inner = typeof parsed.data === "string" ? JSON.parse(parsed.data) : parsed.data;
                      Object.assign(ev, inner);
                    } catch {}
                  }
                  setEvents((prev) => [...prev, ev]);
                  if (parsed.event === "done") setFinalOutput(parsed.data || "");
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
        <div key={idx} className="my-2 border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-950 p-2 rounded text-sm">
          <div className="font-semibold text-blue-700 dark:text-blue-300">🔧 Tool Call: {ev.name}</div>
          <pre className="text-xs mt-1 overflow-auto max-h-32">{JSON.stringify(ev.args, null, 2)}</pre>
        </div>
      );
    }
    if (ev.type === "tool_result") {
      return (
        <div key={idx} className="my-2 border-l-4 border-green-500 bg-green-50 dark:bg-green-950 p-2 rounded text-sm">
          <div className="font-semibold text-green-700 dark:text-green-300">✅ Tool Result: {ev.name}</div>
          <pre className="text-xs mt-1 overflow-auto max-h-40 whitespace-pre-wrap">{ev.content}</pre>
        </div>
      );
    }
    if (ev.type === "agent_step") {
      return (
        <div key={idx} className="my-1">
          <Badge variant="outline" className="text-xs">
            {ev.agent || "agent"}: {ev.content?.slice(0, 80)}...
          </Badge>
        </div>
      );
    }
    if (ev.type === "error") {
      return (
        <div key={idx} className="my-2 border-l-4 border-red-500 bg-red-50 dark:bg-red-950 p-2 rounded text-sm text-red-700">
          Error: {ev.content}
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{agent?.name || "Agent"}</h1>
        <p className="text-muted-foreground">{agent?.description}</p>
        <div className="flex gap-2 mt-2">
          <Badge>{agent?.model_name}</Badge>
          {agent?.workflow_config?.type && agent.workflow_config.type !== "single" && (
            <Badge variant="secondary">{agent.workflow_config.type} multi-agent</Badge>
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
              placeholder="Thread ID (optional, for memory)"
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} />
              Stream
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
          <CardTitle>Live Output & Tool Calls</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={outputRef}
            className="min-h-[200px] max-h-[500px] overflow-auto border rounded p-4 bg-muted/30 font-mono text-sm whitespace-pre-wrap"
          >
            {events.length === 0 && !finalOutput && (
              <p className="text-muted-foreground">Output and tool activity will appear here...</p>
            )}
            {events.map(renderEvent)}
            {finalOutput && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-xs text-muted-foreground mb-1">Final response:</div>
                <div className="whitespace-pre-wrap">{finalOutput}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Conversation History</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous runs yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-auto">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="border rounded p-3 text-sm hover:bg-muted cursor-pointer"
                  onClick={() => setSelectedRun(run)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-medium">Run #{run.id}</span>
                      <Badge variant={run.status === "completed" ? "default" : "secondary"} className="ml-2">
                        {run.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">Input: {run.input}</p>
                  {run.output && (
                    <p className="text-xs mt-1 line-clamp-2">Output: {run.output.slice(0, 150)}...</p>
                  )}
                  {run.messages && run.messages.length > 0 && (
                    <p className="text-xs text-blue-600 mt-1">
                      {run.messages.filter((m: any) => m.type === "tool_call").length} tool calls recorded
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Click a run to view full details and tool activity. Use Thread ID to continue the conversation with memory.
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
                <strong>Input:</strong>
                <pre className="bg-muted p-2 rounded mt-1 whitespace-pre-wrap">{selectedRun.input}</pre>
              </div>
              <div>
                <strong>Output:</strong>
                <pre className="bg-muted p-2 rounded mt-1 whitespace-pre-wrap">{selectedRun.output || "(none)"}</pre>
              </div>
              {selectedRun.messages && selectedRun.messages.length > 0 && (
                <div>
                  <strong>Event Stream / Tool Activity:</strong>
                  <div className="mt-2 space-y-1 max-h-60 overflow-auto border rounded p-2">
                    {selectedRun.messages.map((ev: any, i: number) => (
                      <div key={i} className="text-xs border-b pb-1">
                        <Badge variant="outline" className="mr-1">{ev.type}</Badge>
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
          <CardTitle>Agent Configuration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>System Prompt:</strong> {agent?.system_prompt?.slice(0, 300)}...</p>
          <p><strong>Tools:</strong> {(agent?.tools_config || []).length} configured</p>
          <p><strong>Memory:</strong> {JSON.stringify(agent?.memory_config || {})}</p>
          <p><strong>Workflow:</strong> {JSON.stringify(agent?.workflow_config || {})}</p>
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
