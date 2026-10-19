"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { API_BASE } from "@/lib/api";

interface MarketplaceAgent {
  id: number;
  name: string;
  description: string | null;
  system_prompt: string;
  model_name: string;
  temperature: number;
  is_public: boolean;
  is_published: boolean;
  price: number;
  owner_email?: string;
  tools_config?: any[];
}

export default function MarketplacePage() {
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("token");
    if (!t) {
      window.location.href = "/login";
      return;
    }
    setToken(t);
    fetchMarketplace(t);
    fetchCredits(t);
  }, []);

  const fetchMarketplace = async (t: string, q = "") => {
    setLoading(true);
    const url = q
      ? `${API_BASE}/marketplace/agents?search=${encodeURIComponent(q)}`
      : `${API_BASE}/marketplace/agents`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.ok) {
      setAgents(await res.json());
    }
    setLoading(false);
  };

  const fetchCredits = async (t: string) => {
    const res = await fetch(`${API_BASE}/marketplace/me/credits`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.ok) {
      const data = await res.json();
      setCredits(data.credits);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (token) fetchMarketplace(token, search);
  };

  const cloneAgent = async (id: number) => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/marketplace/agents/${id}/clone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      alert(`Cloned! New agent ID: ${data.id}`);
      window.location.href = "/agents";
    } else {
      const err = await res.json();
      alert(`Error: ${err.detail}`);
    }
  };

  const purchaseAgent = async (id: number, price: number) => {
    if (!token) return;
    if (!confirm(`Purchase this agent for ${price} credits?`)) return;
    const res = await fetch(`${API_BASE}/marketplace/agents/${id}/purchase`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      setCredits(data.credits_remaining);
      if (data.cloned_agent_id) {
        window.location.href = "/agents";
      }
    } else {
      alert(`Error: ${data.detail}`);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Agent Marketplace</h1>
        {credits !== null && (
          <Badge variant="secondary" className="text-lg px-3 py-1">
            Credits: {credits}
          </Badge>
        )}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <Input
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </Button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <Card key={agent.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex justify-between items-start">
                <span>{agent.name}</span>
                <Badge>{agent.price === 0 ? "Free" : `${agent.price} cr`}</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{agent.owner_email}</p>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <p className="text-sm mb-4 line-clamp-3">{agent.description || "No description"}</p>
              <p className="text-xs text-muted-foreground mb-4">
                Model: {agent.model_name} | Temp: {agent.temperature}
              </p>
              <div className="mt-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => cloneAgent(agent.id)}>
                  Clone
                </Button>
                {agent.price > 0 && (
                  <Button size="sm" onClick={() => purchaseAgent(agent.id, agent.price)}>
                    Buy ({agent.price} cr)
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {agents.length === 0 && !loading && (
        <p className="text-center text-muted-foreground mt-12">
          No published agents yet. Publish one from your Agents page!
        </p>
      )}
    </div>
  );
}
