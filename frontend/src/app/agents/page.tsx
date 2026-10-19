"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { API_BASE } from "@/lib/api";
import AgentBuilder from "@/components/AgentBuilder";

interface Agent {
  id: number;
  name: string;
  description: string | null;
  system_prompt: string;
  model_name: string;
  temperature: number;
  is_public: boolean;
  is_published?: boolean;
  price?: number;
  tools_config?: any[];
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<string>("");

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) {
      window.location.href = "/login";
      return;
    }
    setToken(t);
    fetchAgents(t);
  }, []);

  const fetchAgents = async (t: string) => {
    const res = await fetch(`${API_BASE}/agents/`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.ok) {
      setAgents(await res.json());
    }
  };
  const publishAgent = async (id: number, publish: boolean) => {
    if (!token) return;
    const endpoint = publish ? "publish" : "unpublish";
    const res = await fetch(`${API_BASE}/marketplace/agents/${id}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      fetchAgents(token);
    } else {
      const err = await res.json();
      alert(err.detail || "Failed");
    }
  };

  const cloneAgent = async (id: number) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/marketplace/agents/${id}/clone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      fetchAgents(token);
      alert("Cloned to your agents!");
    }
  };


  const createAgent = async (payload: any) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/agents/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setShowCreate(false);
      fetchAgents(token);
      setDiscoverResult("");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Failed to create agent");
    }
  };

  if (!token) return <div>Loading...</div>;

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">My Agents</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => (window.location.href = "/marketplace")}>
            Marketplace
          </Button>
          <Button onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? "Cancel" : "Create Agent"}
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-6">
          <AgentBuilder onSubmit={createAgent} />
          {discoverResult && (
            <pre className="mt-2 p-2 bg-muted text-xs overflow-auto max-h-40">{discoverResult}</pre>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id}>
            <CardHeader>
              <CardTitle>{agent.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-2">{agent.description || "No description"}</p>
              <p className="text-xs">Model: {agent.model_name}</p>
              <p className="text-xs">Temp: {agent.temperature}</p>
              {agent.tools_config && agent.tools_config.length > 0 && (
                <p className="text-xs text-green-600">MCP Tools: {agent.tools_config.length} server(s)</p>
              )}
              <div className="mt-4 flex gap-2 flex-wrap">
                <Link href={`/agents/${agent.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  View / Run
                </Link>
                <Button size="sm" variant="secondary" onClick={() => publishAgent(agent.id, !agent.is_published)}>
                  {agent.is_published ? "Unpublish" : "Publish"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => cloneAgent(agent.id)}>
                  Clone
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {agents.length === 0 && !showCreate && (
        <p className="text-center text-muted-foreground">No agents yet. Create one!</p>
      )}
    </div>
  );
}
