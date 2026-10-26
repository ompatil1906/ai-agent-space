"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { PublicAgent, CategoryPublic } from "@/lib/types";
import { AgentCard } from "@/components/marketplace/agent-card";

/**
 * Live marketplace data island for the landing page — featured/trending
 * agents and category chips, real API, real empty states.
 */
export function LiveCatalog() {
  const [categories, setCategories] = useState<CategoryPublic[]>([]);
  const [featured, setFeatured] = useState<PublicAgent[] | null>(null);
  const [trending, setTrending] = useState<PublicAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<CategoryPublic[]>("/marketplace/categories", { signal: controller.signal, auth: false })
      .then(setCategories)
      .catch(() => {});
    api<PublicAgent[]>("/marketplace/agents/featured?limit=8", { signal: controller.signal, auth: false })
      .then((rows) => {
        setError(null);
        setFeatured(rows);
      })
      .catch((e: Error) => {
        if (e?.name === "AbortError") return;
        setError(e.message);
      });
    api<PublicAgent[]>("/marketplace/agents/trending?limit=8", { signal: controller.signal, auth: false })
      .then(setTrending)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const cardRow = (agents: PublicAgent[]) =>
    agents.length === 0 ? (
      <EmptyRow />
    ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </div>
    );

  return (
    <div>
      <Tabs defaultValue="featured">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="featured">Featured</TabsTrigger>
            <TabsTrigger value="trending">Trending</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" render={<Link href="/marketplace" />}>
            Browse all agents →
          </Button>
        </div>

        {categories.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/marketplace?category=${encodeURIComponent(c.slug)}`}
                className="rounded-4xl bg-muted px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}

        <TabsContent value="featured">
          {error ? (
            <ErrorRow message={error} />
          ) : featured === null ? (
            <SkeletonRow />
          ) : (
            cardRow(featured)
          )}
        </TabsContent>
        <TabsContent value="trending">
          {trending === null ? (
            <SkeletonRow />
          ) : (
            cardRow(trending)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function EmptyRow() {
  return (
    <div className="rounded-xl border border-dashed border-border px-8 py-10 text-center">
      <p className="font-medium">No listings here yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Be the first to publish an agent and claim the spot.
      </p>
      <Button variant="outline" className="mt-4" render={<Link href="/agents" />}>
        Build an agent
      </Button>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-8 py-10 text-center">
      <p className="font-medium">Couldn’t load the marketplace</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
