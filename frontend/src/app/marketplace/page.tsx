"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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
  average_rating?: number | null;
  rating_count: number;
}

interface LeaderboardEntry {
  rank: number;
  agent_id: number;
  agent_name: string;
  description: string | null;
  owner_email: string;
  model_name: string;
  price: number;
  sandbox_enabled: boolean;
  autonomy_level: string;
  avg_rating: number | null;
  rating_count: number;
  run_count: number;
  sales_count: number;
  score: number;
}

function StarRating({ rating, count }: { rating: number | null | undefined; count: number }) {
  if (rating == null || count === 0) {
    return <span className="text-xs text-muted-foreground">No ratings yet</span>;
  }
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-amber-400">
        {"★".repeat(full)}
        {half ? "☆" : ""}
        {"☆".repeat(5 - full - (half ? 1 : 0))}
      </span>
      <span className="text-muted-foreground">
        {rating.toFixed(1)} ({count})
      </span>
    </div>
  );
}

const RANK_STYLES: Record<number, string> = {
  1: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  2: "border-slate-400/40 bg-slate-500/10 text-slate-300",
  3: "border-orange-700/50 bg-orange-700/10 text-orange-300",
};

export default function MarketplacePage() {
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [minRating, setMinRating] = useState<string>("");
  const [priceFilter, setPriceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("created");
  const [loading, setLoading] = useState(false);
  const [ratingModal, setRatingModal] = useState<{ agentId: number; name: string } | null>(null);
  const [userRating, setUserRating] = useState(5);
  const [userReview, setUserReview] = useState("");
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [lbLoading, setLbLoading] = useState(false);

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

  const fetchMarketplace = async (
    t: string,
    q = search,
    mr = minRating,
    pf = priceFilter,
    sb = sortBy
  ) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("search", q);
    if (mr) params.set("min_rating", mr);
    if (pf && pf !== "all") params.set("price_filter", pf);
    if (sb) params.set("sort_by", sb);
    const url = `${API_BASE}/marketplace/agents?${params.toString()}`;
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

  const fetchLeaderboard = async (t: string) => {
    setLbLoading(true);
    try {
      const res = await fetch(`${API_BASE}/marketplace/leaderboard`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        setLeaderboard(await res.json());
      } else {
        setLeaderboard([]);
      }
    } catch {
      setLeaderboard([]);
    } finally {
      setLbLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (token) fetchMarketplace(token);
  };

  const applyFilters = () => {
    if (token) fetchMarketplace(token);
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

  const submitRating = async () => {
    if (!token || !ratingModal) return;
    const res = await fetch(`${API_BASE}/marketplace/agents/${ratingModal.agentId}/rate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rating: userRating, review: userReview || null }),
    });
    if (res.ok) {
      alert("Rating submitted!");
      setRatingModal(null);
      setUserReview("");
      if (token) fetchMarketplace(token);
    } else {
      const err = await res.json();
      alert(`Error: ${err.detail}`);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            discover · clone · sell
          </p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Agent Marketplace</h1>
        </div>
        {credits !== null && (
          <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
            credits: {credits}
          </Badge>
        )}
      </div>

      <Tabs defaultValue="browse" onValueChange={(v: any) => {
        if (v === "leaderboard" && token && leaderboard === null) fetchLeaderboard(token);
      }}>
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        </TabsList>

        <TabsContent value="browse">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 mb-4">
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

          <div className="flex flex-wrap gap-3 mb-6 items-end">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Min Rating</label>
              <Select value={minRating} onValueChange={(val) => setMinRating(val ?? "")}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="4">4+</SelectItem>
                  <SelectItem value="3">3+</SelectItem>
                  <SelectItem value="2">2+</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Price</label>
              <Select value={priceFilter} onValueChange={(val) => setPriceFilter(val ?? "all")}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sort by</label>
              <Select value={sortBy} onValueChange={(val) => setSortBy(val ?? "created")}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created">Newest</SelectItem>
                  <SelectItem value="rating">Highest Rated</SelectItem>
                  <SelectItem value="price">Price (Low)</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={applyFilters} disabled={loading}>
              Apply Filters
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <Card key={agent.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="flex justify-between items-start gap-2 text-sm font-medium tracking-tight">
                    <span className="line-clamp-1">{agent.name}</span>
                    <Badge variant="secondary" className="font-mono">
                      {agent.price === 0 ? "free" : `${agent.price} cr`}
                    </Badge>
                  </CardTitle>
                  <p className="font-mono text-xs text-muted-foreground">{agent.owner_email}</p>
                  <StarRating rating={agent.average_rating} count={agent.rating_count} />
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <p className="text-sm mb-4 line-clamp-3 text-muted-foreground">{agent.description || "No description"}</p>
                  <p className="mb-4 font-mono text-xs text-muted-foreground">
                    model: {agent.model_name} · temp: {agent.temperature}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => cloneAgent(agent.id)}>
                      Clone
                    </Button>
                    {agent.price > 0 && (
                      <Button size="sm" onClick={() => purchaseAgent(agent.id, agent.price)}>
                        Buy
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRatingModal({ agentId: agent.id, name: agent.name });
                        setUserRating(5);
                        setUserReview("");
                      }}
                    >
                      Rate
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leaderboard">
          <p className="mb-4 font-mono text-xs text-muted-foreground">
            ranked by quality (ratings ×20) + social proof (reviews ×2) + usage (runs) + adoption (sales ×5)
          </p>
          {lbLoading || leaderboard === null ? (
            <p className="font-mono text-sm text-muted-foreground">loading leaderboard…</p>
          ) : leaderboard.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">No published agents yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((entry) => (
                <div
                  key={entry.agent_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3"
                >
                  <span
                    className={`flex h-8 min-w-8 items-center justify-center rounded-md border px-2 font-mono text-sm ${
                      RANK_STYLES[entry.rank] ?? "border-border bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    #{entry.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{entry.agent_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      by {entry.owner_email} · {entry.model_name} · {entry.autonomy_level}
                      {entry.sandbox_enabled ? " · sandboxed" : ""}
                    </p>
                  </div>
                  <StarRating rating={entry.avg_rating} count={entry.rating_count} />
                  <div className="font-mono text-xs text-muted-foreground">
                    {entry.run_count} run{entry.run_count === 1 ? "" : "s"} · {entry.sales_count} sale
                    {entry.sales_count === 1 ? "" : "s"}
                  </div>
                  <Badge variant={entry.price > 0 ? "secondary" : "outline"} className="font-mono">
                    {entry.price === 0 ? "free" : `${entry.price} cr`}
                  </Badge>
                  <span className="font-mono text-sm font-medium">score {entry.score}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {ratingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Rate: {ratingModal.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Stars (1-5)</label>
                <Select value={String(userRating)} onValueChange={(v) => setUserRating(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} ★
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Review (optional)</label>
                <Input
                  placeholder="Write a short review..."
                  value={userReview}
                  onChange={(e) => setUserReview(e.target.value)}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setRatingModal(null)}>
                  Cancel
                </Button>
                <Button onClick={submitRating}>Submit Rating</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
