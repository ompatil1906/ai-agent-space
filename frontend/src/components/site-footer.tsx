import Link from "next/link";
import Image from "next/image";
import { FooterYear } from "@/components/footer-year";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Marketplace",
    links: [
      { href: "/marketplace", label: "Explore agents" },
      { href: "/marketplace?sort=popular", label: "Popular" },
      { href: "/marketplace?sort=newest", label: "Newest" },
    ],
  },
  {
    title: "Builders",
    links: [
      { href: "/agents", label: "My agents" },
      { href: "/mcp-servers", label: "MCP tools" },
      { href: "/register", label: "Create account" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/purchases", label: "Purchases" },
      { href: "/earnings", label: "Creator earnings" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-border/70 mt-auto border-t bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg border border-border/80 bg-zinc-950 p-1">
                <Image
                  src="/logos/icon.svg"
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 rounded-sm object-contain"
                />
              </span>
              <span className="text-sm font-semibold tracking-tight">
                AI Agent Space
              </span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Build, publish, and sell AI agents with real tool use, memory,
              and multi-agent workflows.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {col.title}
                </p>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="border-border/60 mt-8 flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <FooterYear />
          <span className="font-mono">agent-native · mcp-first</span>
        </div>
      </div>
    </footer>
  );
}
