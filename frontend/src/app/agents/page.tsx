"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

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
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
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

  const updateAgent = async (payload: any) => {
    if (!token || !editingAgent) return;
    const res = await fetch(`${API_BASE}/agents/${editingAgent.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setEditingAgent(null);
      fetchAgents(token);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Failed to update agent");
    }
  };

  const loadVersions = async (agentId: number) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/agents/${agentId}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setVersions(await res.json());
      setSelectedAgentId(agentId);
      setVersionsOpen(true);
    }
  };

  const restoreVersion = async (agentId: number, versionId: number) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/agents/${agentId}/versions/${versionId}/restore`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      alert("Restored successfully");
      setVersionsOpen(false);
      fetchAgents(token);
    } else {
      alert("Restore failed");
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
          <Button onClick={() => { setShowCreate(!showCreate); setEditingAgent(null); }}>
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

      {editingAgent && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Editing: {editingAgent.name}</h2>
          <AgentBuilder
            onSubmit={updateAgent}
            initial={editingAgent}
          />
          <Button variant="outline" className="mt-2" onClick={() => setEditingAgent(null)}>
            Cancel Edit
          </Button>
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
                <Link href={`/agents/${agent.id}/evaluations`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Evaluations
                </Link>
                <Button size="sm" variant="outline" onClick={() => setEditingAgent(agent)}>
                  Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => loadVersions(agent.id)}>
                  Versions
                </Button>
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
      {agents.length === 0 && !showCreate && !editingAgent && (
        <p className="text-center text-muted-foreground">No agents yet. Create one!</p>
      )}

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Agent Versions</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {versions.map((v) => (
              <div key={v.id} className="border rounded p-3 flex justify-between items-start">
                <div>
                  <p className="font-medium">v{v.version_number} — {v.name}</p>
                  <p className="text-xs text-muted-foreground">{v.change_note} · {new Date(v.created_at).toLocaleString()}</p>
                  <p className="text-xs mt-1 line-clamp-2">{v.system_prompt.slice(0, 120)}...</p>
                </div>
                <Button size="sm" onClick={() => selectedAgentId && restoreVersion(selectedAgentId, v.id)}>
                  Restore
                </Button>
              </div>
            ))}
            {versions.length === 0 && <p>No versions yet.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
