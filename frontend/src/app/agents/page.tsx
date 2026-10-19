"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { API_BASE } from "@/lib/api";

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

const defaultToolsConfig = `[
  {
    "name": "example",
    "transport": "stdio",
    "command": "python",
    "args": ["backend/examples/example_mcp_server.py"]
  }
]`;

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: "",
    description: "",
    system_prompt: "You are a helpful AI assistant. You have access to tools when configured.",
    model_name: "gpt-4o-mini",
    temperature: 0.7,
    tools_config_json: "[]",
    workflow_type: "single",
    workflow_config_json: "{}",
  });
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


  const discoverTools = async () => {
    if (!token) return;
    try {
      const tools_config = JSON.parse(newAgent.tools_config_json || "[]");
      const res = await fetch(`${API_BASE}/agents/discover-tools`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(tools_config),
      });
      const data = await res.json();
      if (res.ok) {
        setDiscoverResult(JSON.stringify(data, null, 2));
      } else {
        setDiscoverResult(`Error: ${data.detail}`);
      }
    } catch (e) {
      setDiscoverResult(`Invalid JSON or error: ${e}`);
    }
  };

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    let tools_config: any[] = [];
    let workflow_config: any = {};
    try {
      tools_config = JSON.parse(newAgent.tools_config_json || "[]");
    } catch {
      alert("Invalid tools_config JSON");
      return;
    }
    try {
      workflow_config = JSON.parse(newAgent.workflow_config_json || "{}");
      if (newAgent.workflow_type !== "single") {
        workflow_config.type = newAgent.workflow_type;
      }
    } catch {
      alert("Invalid workflow_config JSON");
      return;
    }
    const payload = {
      name: newAgent.name,
      description: newAgent.description,
      system_prompt: newAgent.system_prompt,
      model_name: newAgent.model_name,
      temperature: newAgent.temperature,
      tools_config,
      workflow_config,
    };
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
      setNewAgent({
        name: "",
        description: "",
        system_prompt: "You are a helpful AI assistant. You have access to tools when configured.",
        model_name: "gpt-4o-mini",
        temperature: 0.7,
        tools_config_json: "[]",
        workflow_type: "single",
        workflow_config_json: "{}",
      });
      setDiscoverResult("");
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
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createAgent} className="space-y-4">
              <Input
                placeholder="Agent Name"
                value={newAgent.name}
                onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                required
              />
              <Input
                placeholder="Description"
                value={newAgent.description}
                onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
              />
              <Textarea
                placeholder="System Prompt"
                value={newAgent.system_prompt}
                onChange={(e) => setNewAgent({ ...newAgent, system_prompt: e.target.value })}
                rows={4}
              />
              <Input
                placeholder="Model (e.g. gpt-4o-mini)"
                value={newAgent.model_name}
                onChange={(e) => setNewAgent({ ...newAgent, model_name: e.target.value })}
              />
              <div>
                <label className="text-sm">Temperature: {newAgent.temperature}</label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={newAgent.temperature}
                  onChange={(e) => setNewAgent({ ...newAgent, temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Workflow Type</label>
                <select
                  className="w-full border rounded px-3 py-2 mt-1"
                  value={newAgent.workflow_type}
                  onChange={(e) => setNewAgent({ ...newAgent, workflow_type: e.target.value })}
                >
                  <option value="single">Single Agent</option>
                  <option value="sequential">Sequential Multi-Agent</option>
                  <option value="supervisor">Supervisor Multi-Agent</option>
                </select>
              </div>
              {newAgent.workflow_type !== "single" && (
                <div>
                  <label className="text-sm font-medium">
                    Workflow Config (JSON) — sub_agents / workers
                  </label>
                  <Textarea
                    placeholder={`{\n  "sub_agents": [\n    {"name": "researcher", "system_prompt": "Research thoroughly."},\n    {"name": "writer", "system_prompt": "Write a clear summary."}\n  ]\n}`}
                    value={newAgent.workflow_config_json}
                    onChange={(e) => setNewAgent({ ...newAgent, workflow_config_json: e.target.value })}
                    rows={8}
                    className="font-mono text-xs"
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-medium">MCP Tools Config (JSON array)</label>
                <Textarea
                  placeholder={defaultToolsConfig}
                  value={newAgent.tools_config_json}
                  onChange={(e) => setNewAgent({ ...newAgent, tools_config_json: e.target.value })}
                  rows={8}
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={discoverTools}>
                  Discover Tools
                </Button>
                {discoverResult && (
                  <pre className="mt-2 p-2 bg-muted text-xs overflow-auto max-h-40">{discoverResult}</pre>
                )}
              </div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
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
