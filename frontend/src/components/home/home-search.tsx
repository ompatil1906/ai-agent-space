"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { cn } from "cn";

const SUGGESTIONS = ["invoice parsing", "research", "code review", "qa"];

/**
 * Hero search — routes into the marketplace with the query param, where the
 * real search runs against live listings.
 */
export function HomeSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(q.trim() ? `/marketplace?q=${encodeURIComponent(q.trim())}` : "/marketplace");
  };

  return (
    <div className="mx-auto mt-9 max-w-xl">
      <form onSubmit={submit} className="relative" role="search">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agents — “summarize PDFs”, “triage issues”…"
          aria-label="Search the agent marketplace"
          className={cn(
            "h-11 w-full rounded-xl border border-input bg-card pr-28 pl-10 text-sm text-foreground shadow-sm transition-all outline-none",
            "placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/30"
          )}
        />
        <button
          type="submit"
          className="top-1 right-1 absolute h-9 rounded-lg bg-primary px-3.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-opacity hover:opacity-80"
        >
          Search
        </button>
      </form>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span>Try:</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => router.push(`/marketplace?q=${encodeURIComponent(s)}`)}
            className="rounded-full border border-transparent font-mono transition-colors hover:border-border hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
