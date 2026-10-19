"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import { API_BASE } from "@/lib/api";

interface StreamEvent {
  type: "token" | "tool_call" | "tool_result" | "done" | "error";
  content?: string;
  name?: string;
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

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ detail: "Stream failed" }));
          setEvents([{ type: "error", content: err.detail || "Unknown error" }]);
          setLoading(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "token") {
                  accumulated += data.content || "";
                  setFinalOutput(accumulated);
                }
                setEvents((prev) => [...prev, data]);
              } catch {
                // ignore malformed
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
        const data = await res.json();
        if (res.ok) {
          setFinalOutput(data.output);
          setEvents([{ type: "done", content: data.output }]);
        } else {
          setEvents([{ type: "error", content: data.detail }]);
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setEvents([{ type: "error", content: e.message || "Network error" }]);
      }
    }
    setLoading(false);
  };

  if (!agent) return <div className="p-6">Loading agent...</div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-2">{agent.name}</h1>
      <p className="text-muted-foreground mb-4">{agent.description}</p>
      <div className="text-xs text-muted-foreground mb-6">
        Model: {agent.model_name} | Temp: {agent.temperature} | 
        Workflow: {agent.workflow_config?.type || "single"}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Run Agent (with Memory & Streaming)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={streaming}
                onChange={(e) => setStreaming(e.target.checked)}
              />
              Streaming mode (live tokens + tool calls)
            </label>
            <div className="flex items-center gap-2">
              <span>Thread ID (memory):</span>
              <input
                className="border rounded px-2 py-1 text-xs w-40"
                placeholder="auto or custom"
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
              />
            </div>
          </div>
          <Textarea
            placeholder="Enter your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <Button onClick={runAgent} disabled={loading || !input}>
              {loading ? "Running..." : "Run"}
            </Button>
            {loading && (
              <Button
                variant="outline"
                onClick={() => abortControllerRef.current?.abort()}
              >
                Stop
              </Button>
            )}
          </div>

          {(events.length > 0 || finalOutput) && (
            <div className="mt-4 space-y-3">
              <div
                ref={outputRef}
                className="rounded-md bg-muted p-4 max-h-96 overflow-y-auto font-mono text-sm"
              >
                {events.map((ev, i) => (
                  <div key={i} className="mb-2">
                    {ev.type === "token" && (
                      <span className="text-foreground">{ev.content}</span>
                    )}
                    {ev.type === "tool_call" && (
                      <div className="my-1">
                        <Badge variant="secondary">Tool Call: {ev.name}</Badge>
                        <pre className="text-xs mt-1 bg-background p-2 rounded">
                          {JSON.stringify(ev.args, null, 2)}
                        </pre>
                      </div>
                    )}
                    {ev.type === "tool_result" && (
                      <div className="my-1">
                        <Badge variant="outline">Tool Result: {ev.name}</Badge>
                        <pre className="text-xs mt-1 bg-background p-2 rounded max-h-32 overflow-auto">
                          {ev.content}
                        </pre>
                      </div>
                    )}
                    {ev.type === "error" && (
                      <div className="text-red-500">Error: {ev.content}</div>
                    )}
                  </div>
                ))}
                {finalOutput && events.every(e => e.type !== "token") && (
                  <div className="whitespace-pre-wrap">{finalOutput}</div>
                )}
              </div>
              {finalOutput && (
                <div className="text-xs text-muted-foreground">
                  Final response length: {finalOutput.length} chars
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Configuration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><strong>System Prompt:</strong> {agent.system_prompt?.slice(0, 300)}...</p>
          <p><strong>Tools:</strong> {(agent.tools_config || []).length} configured</p>
          <p><strong>Memory:</strong> {JSON.stringify(agent.memory_config || {})}</p>
          <p><strong>Workflow:</strong> {JSON.stringify(agent.workflow_config || {})}</p>
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
