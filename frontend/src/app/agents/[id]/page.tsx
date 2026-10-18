"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [agent, setAgent] = useState<any>(null);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);

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

  const runAgent = async () => {
    if (!token || !input) return;
    setLoading(true);
    setOutput("");
    try {
      const res = await fetch(`${API_BASE}/agents/${agentId}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (res.ok) {
        setOutput(data.output);
      } else {
        setOutput(`Error: ${data.detail}`);
      }
    } catch (e) {
      setOutput("Network error");
    }
    setLoading(false);
  };

  if (!agent) return <div className="p-6">Loading agent...</div>;

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2">{agent.name}</h1>
      <p className="text-muted-foreground mb-6">{agent.description}</p>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Run Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Enter your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
          />
          <Button onClick={runAgent} disabled={loading || !input}>
            {loading ? "Running..." : "Run"}
          </Button>
          {output && (
            <div className="mt-4 rounded-md bg-muted p-4">
              <p className="font-medium mb-2">Response:</p>
              <p className="whitespace-pre-wrap">{output}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="text-sm text-muted-foreground">
        <p>Model: {agent.model_name} | Temperature: {agent.temperature}</p>
        <p className="mt-1">System Prompt: {agent.system_prompt?.slice(0, 200)}...</p>
      </div>
    </div>
  );
}
