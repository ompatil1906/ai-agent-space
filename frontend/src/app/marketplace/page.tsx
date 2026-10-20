"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

function StarRating({ rating, count }: { rating: number | null | undefined; count: number }) {
  if (rating == null || count === 0) {
    return <span className="text-xs text-muted-foreground">No ratings yet</span>;
  }
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-yellow-500">
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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Agent Marketplace</h1>
        {credits !== null && (
          <Badge variant="secondary" className="text-lg px-3 py-1">
            Credits: {credits}
          </Badge>
        )}
      </div>

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
              <CardTitle className="flex justify-between items-start gap-2">
                <span className="line-clamp-1">{agent.name}</span>
                <Badge>{agent.price === 0 ? "Free" : `${agent.price} cr`}</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{agent.owner_email}</p>
              <StarRating rating={agent.average_rating} count={agent.rating_count} />
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <p className="text-sm mb-4 line-clamp-3">{agent.description || "No description"}</p>
              <p className="text-xs text-muted-foreground mb-4">
                Model: {agent.model_name} | Temp: {agent.temperature}
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