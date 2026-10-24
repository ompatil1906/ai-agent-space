"use client";

/**
 * Public marketplace catalog. Browsing requires NO auth (viewer flags attach
 * when a token exists) — do not redirect signed-out visitors.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getToken, AUTH_EVENT, api } from "@/lib/api";
import type { PublicAgent, CategoryPublic } from "@/lib/types";
import { pricingLabel } from "@/lib/money";
import { PageHeader } from "@/components/ui-page";
import { AgentCard } from "@/components/marketplace/agent-card";
import { SearchIcon, StarIcon, XIcon, LayoutGridIcon, Rows3Icon, TrophyIcon } from "lucide-react";

const PRICING_FILTERS = [
  { value: "", label: "All pricing" },
  { value: "free", label: "Free" },
  { value: "one_time", label: "One-time" },
  { value: "subscription", label: "Subscription" },
  { value: "pay_per_execution", label: "Run packs" },
];

const SORTS = [
  { value: "popular", label: "Popular" },
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Highest rated" },
  { value: "price_low", label: "Price: low → high" },
  { value: "price_high", label: "Price: high → low" },
  { value: "name", label: "Name" },
];

const PAGE_SIZE = 24;

interface LeaderboardEntry {
  rank: number;
  agent_id: number;
  agent_slug?: string | null;
  agent_name: string;
  owner_email: string;
  model_name: string;
  pricing_model?: string | null;
  amount_minor?: number | null;
  currency?: string | null;
  sandbox_enabled: boolean;
  autonomy_level: string;
  avg_rating?: number | null;
  rating_count: number;
  run_count: number;
  sales_count: number;
  score: number;
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <MarketplaceInner />
    </Suspense>
  );
}

function MarketplaceInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [token, setToken] = useState<string | null>(null);
  const [agents, setAgents] = useState<PublicAgent[] | null>(null);
  const [categories, setCategories] = useState<CategoryPublic[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [pricingModel, setPricingModel] = useState("");
  const [minRating, setMinRating] = useState("");
  const [sortBy, setSortBy] = useState("popular");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [presentation, setPresentation] = useState<"grid" | "list">("grid");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(false);

  // view + leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [view, setView] = useState<"browse" | "leaderboard">("browse");

  // rating dialog
  const [rateTarget, setRateTarget] = useState<{ agentId: number; name: string } | null>(null);
  const [userRating, setUserRating] = useState("5");
  const [userReview, setUserReview] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);

  // ---- deep-link init (hero searches: /marketplace?q=…&category=…&sort=…)
  const [urlHydrated, setUrlHydrated] = useState(false);
  useEffect(() => {
    setSearch(params.get("q") ?? "");
    setCategory(params.get("category") ?? "");
    const sort = params.get("sort");
    if (sort && SORTS.some((s) => s.value === sort)) setSortBy(sort);
    setUrlHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // ---- auth token + auth-driven refetch
  useEffect(() => {
    const sync = () => setToken(getToken());
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<CategoryPublic[]>("/marketplace/categories", { auth: false })
      .then((c) => {
        if (!cancelled) setCategories(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const buildQuery = useCallback(
    (skip: number, limit: number) => {
      const p = new URLSearchParams();
      if (search.trim()) p.set("search", search.trim());
      if (category) p.set("category", category);
      if (pricingModel) p.set("pricing_model", pricingModel);
      if (minRating) p.set("min_rating", minRating);
      if (featuredOnly) p.set("featured", "true");
      p.set("sort_by", sortBy);
      p.set("skip", String(skip));
      p.set("limit", String(limit));
      return p.toString();
    },
    [search, category, pricingModel, minRating, sortBy, featuredOnly]
  );

  // ---- main fetch (debounced) + URL sync
  useEffect(() => {
    const paramsUrl = `/marketplace/agents?${buildQuery(0, PAGE_SIZE)}`;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api<PublicAgent[]>(paramsUrl, { signal: controller.signal, auth: Boolean(token) })
        .then((data) => {
          setAgents(data);
          setCanLoadMore(data.length === PAGE_SIZE);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if ((e as Error)?.name === "AbortError") return;
          setError((e as Error).message);
          setAgents([]);
          setLoading(false);
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [buildQuery, token]);

  // keep the URL shareable (does not refetch — state owns the data)
  useEffect(() => {
    if (!urlHydrated) return;
    const shareParams = new URLSearchParams();
    if (search.trim()) shareParams.set("q", search.trim());
    if (category) shareParams.set("category", category);
    if (sortBy !== "popular") shareParams.set("sort", sortBy);
    const qs = shareParams.toString();
    router.replace(qs ? `/marketplace?${qs}` : "/marketplace", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlHydrated, search, category, sortBy]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await api<PublicAgent[]>(`/marketplace/agents?${buildQuery(agents?.length ?? 0, PAGE_SIZE)}`, {
        auth: Boolean(token),
      });
      setAgents((prev) => [...(prev ?? []), ...next]);
      setCanLoadMore(next.length === PAGE_SIZE);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  // ---- leaderboard
  useEffect(() => {
    if (view !== "leaderboard" || !token || leaderboard !== null) return;
    api<LeaderboardEntry[]>("/marketplace/leaderboard")
      .then(setLeaderboard)
      .catch((e: unknown) => {
        setLeaderboard([]);
        toast.error((e as Error).message);
      });
  }, [view, token, leaderboard]);

  // ---- actions
  const submitRating = async () => {
    if (!rateTarget) return;
    setSubmittingRating(true);
    try {
      await api(`/marketplace/agents/${rateTarget.agentId}/rate`, {
        method: "POST",
        body: { rating: Number(userRating), review: userReview.trim() || null },
      });
      toast.success("Rating submitted", {
        description: Number(userRating) === 5
          ? "Verified purchases are flagged automatically."
          : undefined,
      });
      setRateTarget(null);
      // re-run the current query without the loading flicker
      const refresh = new URLSearchParams();
      if (search.trim()) refresh.set("search", search.trim());
      if (category) refresh.set("category", category);
      if (pricingModel) refresh.set("pricing_model", pricingModel);
      if (minRating) refresh.set("min_rating", minRating);
      if (featuredOnly) refresh.set("featured", "true");
      refresh.set("sort_by", sortBy);
      refresh.set("limit", String(PAGE_SIZE));
      const data = await api<PublicAgent[]>(`/marketplace/agents?${refresh.toString()}`, {
        auth: Boolean(token),
      });
      setAgents(data);
      setCanLoadMore(data.length === PAGE_SIZE);
    } catch (e) {
      toast.error("Could not submit rating", { description: (e as Error).message });
    } finally {
      setSubmittingRating(false);
    }
  };

  const cloneAgent = async (id: number) => {
    try {
      await api(`/marketplace/agents/${id}/clone`, { method: "POST" });
      toast.success("Agent cloned", {
        description: "It is now in your workspace as a private draft.",
      });
      router.push("/agents");
    } catch (e) {
      toast.error("Clone failed", { description: (e as Error).message });
    }
  };

  const hasFilters = Boolean(search || category || pricingModel || minRating || featuredOnly);
  const clearFilters = () => {
    setSearch("");
    setCategory("");
    setPricingModel("");
    setMinRating("");
    setFeaturedOnly(false);
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="buy · sell · build on agents"
        title="Agent Marketplace"
        description="Real agents, real payments. Get a proven specialist for your workspace in one click — or publish yours and earn when others use it."
      >
        {token && (
          <Button variant="outline" size="sm" render={<Link href="/purchases" />}>
            My purchases
          </Button>
        )}
      </PageHeader>

      <Tabs value={view} onValueChange={(v) => setView(v as "browse" | "leaderboard")}>
        <TabsList className="mb-6">
          <TabsTrigger value="browse">
            <SearchIcon className="size-3.5" /> Browse
          </TabsTrigger>
          <TabsTrigger value="leaderboard">
            <TrophyIcon className="size-3.5" /> Leaderboard
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "browse" ? (
        <>
          {/* -------------------------------------------------- filters */}
          <div className="mb-6 space-y-3">
            <div className="flex gap-2">
              <div className="relative max-w-md flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search agents, problems, tools…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search agents"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                    className="top-1/2 right-2 absolute -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="icon-xs" onClick={() => setPresentation("grid")} aria-pressed={presentation === "grid"} aria-label="Grid view">
                  <LayoutGridIcon className="size-3.5" />
                </Button>
                <Button variant="outline" size="icon-xs" onClick={() => setPresentation("list")} aria-pressed={presentation === "list"} aria-label="List view">
                  <Rows3Icon className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
                <SelectTrigger size="sm" className="w-44" aria-label="Category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={pricingModel} onValueChange={(v) => setPricingModel(v ?? "")}>
                <SelectTrigger size="sm" className="w-40" aria-label="Pricing">
                  <SelectValue placeholder="All pricing" />
                </SelectTrigger>
                <SelectContent>
                  {PRICING_FILTERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={minRating} onValueChange={(v) => setMinRating(v ?? "")}>
                <SelectTrigger size="sm" className="w-36" aria-label="Minimum rating">
                  <SelectValue placeholder="Any rating" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any rating</SelectItem>
                  <SelectItem value="4">4★ and up</SelectItem>
                  <SelectItem value="3">3★ and up</SelectItem>
                  <SelectItem value="2">2★ and up</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v ?? "popular")}>
                <SelectTrigger size="sm" className="w-44" aria-label="Sort">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="bg-muted flex h-7 items-center gap-2 rounded-lg px-2.5">
                <Switch
                  size="sm"
                  id="featured-only"
                  checked={featuredOnly}
                  onCheckedChange={setFeaturedOnly}
                />
                <Label htmlFor="featured-only" className="text-xs text-muted-foreground">
                  Featured
                </Label>
              </div>

              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <XIcon className="size-3.5" /> Clear
                </Button>
              )}
            </div>
          </div>

          {/* --------------------------------------------------- results */}
          {error ? (
            <div className="rounded-xl border border-dashed border-border px-8 py-14 text-center">
              <p className="font-medium">Couldn’t reach the marketplace</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
          ) : loading && agents === null ? (
            <CatalogSkeleton presentation={presentation} />
          ) : agents !== null && agents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-8 py-14 text-center">
              <p className="font-medium">No published agents match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasFilters
                  ? "Try clearing the filters — or be the first to publish one."
                  : "Be the first to publish one."}
              </p>
              <Button className="mt-4" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              {presentation === "grid" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(agents ?? []).map((agent) => (
                    <AgentCard key={agent.id} agent={agent} />
                  ))}
                </div>
              ) : (
                <AgentListRows
                  agents={agents ?? []}
                  token={token}
                  onClone={cloneAgent}
                  onRate={setRateTarget}
                />
              )}
              {canLoadMore && !loading && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more agents"}
                  </Button>
                </div>
              )}
            </>
          )}

          {/* loading overlay for filter changes */}
          {loading && agents !== null && agents.length > 0 && (
            <p className="text-muted-foreground mt-4 animate-pulse font-mono text-xs">
              refreshing results…
            </p>
          )}
        </>
      ) : (
        /* ------------------------------------------------- leaderboard */
        <div>
          <p className="text-muted-foreground mb-3 font-mono text-xs">
            ranked by quality (ratings ×20) + reviews (×2) + usage (runs) + paid adoption (sales ×5)
          </p>
          {!token ? (
            <div className="rounded-xl border border-dashed border-border px-8 py-12 text-center">
              <p className="font-medium">Sign in to see rankings</p>
              <Button variant="outline" className="mt-4" render={<Link href="/login" />}>
                Log in
              </Button>
            </div>
          ) : leaderboard === null ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-muted-foreground text-sm">No published agents yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((entry) => (
                <div
                  key={entry.agent_id}
                  className="ring-foreground/10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-card px-4 py-3 ring-1 transition-shadow hover:ring-foreground/20"
                >
                  <span
                    className={`flex h-8 min-w-9 items-center justify-center rounded-md px-2 font-mono text-sm ring-1 ${
                      entry.rank === 1
                        ? "bg-warning/10 text-warning ring-warning/30"
                        : entry.rank === 2
                          ? "bg-accent text-foreground ring-foreground/20"
                          : entry.rank === 3
                            ? "bg-brand/10 text-brand ring-brand/25"
                            : "bg-muted/60 text-muted-foreground ring-border"
                    }`}
                  >
                    #{entry.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <Link
                        href={`/agents/${entry.agent_slug || entry.agent_id}`}
                        className="transition-colors hover:underline"
                      >
                        {entry.agent_name}
                      </Link>
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      by {entry.owner_email} · {entry.model_name} · {entry.autonomy_level}
                      {entry.sandbox_enabled ? " · sandboxed" : ""}
                    </p>
                  </div>
                  <StarRating rating={entry.avg_rating} count={entry.rating_count} />
                  <div className="text-muted-foreground hidden font-mono text-xs sm:block">
                    {entry.run_count} run{entry.run_count === 1 ? "" : "s"} · {entry.sales_count} sale
                    {entry.sales_count === 1 ? "" : "s"}
                  </div>
                  <Badge variant={entry.pricing_model === "free" ? "outline" : "secondary"} className="font-mono">
                    {pricingLabel({
                      model: entry.pricing_model || "free",
                      currency: entry.currency,
                      amount_minor: entry.amount_minor,
                    })}
                  </Badge>
                  <span className="font-mono text-sm font-medium">{entry.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------- rating dialog */}
      <Dialog open={Boolean(rateTarget)} onOpenChange={(open) => !open && setRateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rate · {rateTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Stars</Label>
              <Select value={userRating} onValueChange={(v) => setUserRating(v ?? "5")}>
                <SelectTrigger className="w-full">
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
            <div className="space-y-2">
              <Label htmlFor="user-review">Review (optional)</Label>
              <Input
                id="user-review"
                placeholder="Write a short review…"
                value={userReview}
                onChange={(e) => setUserReview(e.target.value)}
              />
              {userRating === "5" && userReview.trim() !== "" && (
                <p className="text-muted-foreground text-[11px]">
                  Reviews from verified purchases are flagged as such automatically.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submitRating} disabled={submittingRating}>
              {submittingRating ? "Submitting…" : "Submit rating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentListRows({
  agents,
  token,
  onClone,
  onRate,
}: {
  agents: PublicAgent[];
  token: string | null;
  onClone: (id: number) => void;
  onRate: (t: { agentId: number; name: string }) => void;
}) {
  return (
    <div className="space-y-2">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className="ring-foreground/10 flex flex-wrap items-center gap-4 rounded-lg bg-card px-4 py-3 ring-1 transition-shadow hover:ring-foreground/20"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link href={`/agents/${agent.slug}`} className="truncate font-medium hover:underline">
                {agent.name}
              </Link>
              {agent.is_featured && (
                <StarIcon className="size-3.5 shrink-0 text-brand" aria-label="Featured" />
              )}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              by {agent.owner_display_name || agent.owner_email}
              {agent.category_name ? ` · ${agent.category_name}` : ""}
            </p>
          </div>
          <StarRating rating={agent.average_rating} count={agent.rating_count} />
          <Badge variant={agent.pricing?.model === "free" ? "outline" : "secondary"} className="font-mono">
            {pricingLabel(agent.pricing)}
          </Badge>
          <div className="flex items-center gap-1.5">
            <Button size="sm" render={<Link href={`/agents/${agent.slug}`} />}>
              View
            </Button>
            {token && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRate({ agentId: agent.id, name: agent.name })}
              >
                Rate
              </Button>
            )}
            {token &&
            (agent.pricing?.model === "free" ||
              (agent.purchased &&
                agent.pricing?.model !== "subscription" &&
                agent.pricing?.model !== "pay_per_execution")) ? (
              <Button size="sm" variant="ghost" onClick={() => onClone(agent.id)}>
                Clone
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function StarRating({ rating, count }: { rating: number | null | undefined; count: number }) {
  if (rating == null || count === 0) {
    return <span className="text-muted-foreground shrink-0 text-xs">no ratings</span>;
  }
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="shrink-0 text-xs">
      <span className="text-warning">
        {"★".repeat(full)}
        {half ? "☆" : ""}
      </span>
      <span className="text-muted-foreground">
        {" "}
        {rating.toFixed(1)} ({count})
      </span>
    </span>
  );
}

function CatalogSkeleton({ presentation = "grid" }: { presentation?: "grid" | "list" }) {
  if (presentation === "list") {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
