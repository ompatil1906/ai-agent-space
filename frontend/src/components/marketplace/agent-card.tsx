"use client";

import Link from "next/link";
import { StarIcon, TrendingUpIcon, BadgeCheckIcon } from "lucide-react";
import { cn } from "cn";
import type { PricingPlanPublic } from "@/lib/types";
import { pricingLabel, planDescriptor } from "@/lib/money";

export interface PublicAgentLike {
  id: number;
  slug: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  model_name: string;
  avatar_url?: string | null;
  cover_image_url?: string | null;
  category_slug?: string | null;
  category_name?: string | null;
  tags?: string[];
  is_featured?: boolean;
  owner_display_name?: string | null;
  owner_email?: string | null;
  pricing?: PricingPlanPublic | null;
  average_rating?: number | null;
  rating_count?: number;
  run_count?: number;
  sales_count?: number;
  purchased?: boolean;
  owned_by_viewer?: boolean;
}

/**
 * The one marketplace card used on the landing page, search results, and the
 * explore grid. Fixed vertical rhythm so mixed-content rows stay aligned.
 */
export function AgentCard({ agent, className }: { agent: PublicAgentLike; className?: string }) {
  const rating = agent.average_rating ?? null;
  const creator =
    agent.owner_display_name?.trim() ||
    agent.owner_email?.split("@")[0] ||
    "Creator";
  const isOwned = agent.purchased || agent.owned_by_viewer;

  return (
    <Link
      href={`/agents/${agent.slug}`}
      className={cn(
        "group/card relative flex flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        "transition-all duration-200 hover:ring-foreground/20",
        className
      )}
    >
      {/* Header: identity + status */}
      <div className="flex items-start gap-3">
        <AgentMonogram agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-medium text-foreground">
              {agent.name}
            </h3>
            {agent.is_featured && (
              <BadgeCheckIcon aria-label="Featured" className="size-3.5 shrink-0 text-brand" />
            )}
            {isOwned && (
              <span className="shrink-0 rounded-4xl bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                Owned
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            by {creator} · {agent.category_name ?? "Uncategorized"}
          </p>
        </div>
        {rating != null && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            <StarIcon className="size-3 fill-current" />
            {rating.toFixed(1)}
          </span>
        )}
      </div>

      {/* Body: one-liner + tags */}
      <p className="line-clamp-2 min-h-8 text-sm text-muted-foreground">
        {agent.tagline?.trim() ||
          agent.description?.trim() ||
          "No description yet."}
      </p>
      {agent.tags && agent.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-4xl bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: pricing + activity */}
      <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-3 text-xs">
        <span className="flex flex-col">
          <span className="font-medium text-foreground">
            {pricingLabel(agent.pricing)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {planDescriptor(agent.pricing)}
          </span>
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {agent.run_count ? (
            <span className="flex items-center gap-1" title={`${agent.run_count} runs`}>
              <TrendingUpIcon className="size-3" />
              {compact(agent.run_count)}
            </span>
          ) : null}
          {agent.rating_count ? (
            <span title={`${agent.rating_count} ratings`}>
              {agent.rating_count} ★
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}

/**
 * Deterministic tinted monogram from the agent id/name — one solid hue per
 * agent, soft enough to stay quiet next to the accent color.
 */
export function AgentMonogram({
  agent,
  size = "md",
}: {
  agent: { id: number; name: string; avatar_url?: string | null };
  size?: "md" | "lg";
}) {
  const hue = (agent.id * 47) % 360;
  const dims = size === "lg" ? "size-12 text-base" : "size-9 text-sm";
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-lg font-semibold", dims)}
      style={{
        background: agent.avatar_url
          ? undefined
          : `oklch(0.62 0.11 ${hue})`,
        color: agent.avatar_url ? undefined : "oklch(0.99 0.002 264)",
      }}
    >
      {agent.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={agent.avatar_url}
          alt=""
          className={cn("rounded-lg object-cover", size === "lg" ? "size-12" : "size-9")}
        />
      ) : (
        <span className="flex size-full items-center justify-center">
          {agent.name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}
