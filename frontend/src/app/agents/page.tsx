"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

interface Agent {
  id: number;
  name: string;
  description: string | null;
  system_prompt: string;
  model_name: string;
  temperature: number;
  is_public: boolean;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: "",
    description: "",
    system_prompt: "You are a helpful AI assistant.",
    model_name: "gpt-4o-mini",
    temperature: 0.7,
  });

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

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const res = await fetch(`${API_BASE}/agents/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newAgent),
    });
    if (res.ok) {
      setShowCreate(false);
      fetchAgents(token);
      setNewAgent({
        name: "",
        description: "",
        system_prompt: "You are a helpful AI assistant.",
        model_name: "gpt-4o-mini",
        temperature: 0.7,
      });
    }
  };

  if (!token) return <div>Loading...</div>;

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">My Agents</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Create Agent"}
        </Button>
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
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={`/agents/${agent.id}`}>View / Run</a>
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
