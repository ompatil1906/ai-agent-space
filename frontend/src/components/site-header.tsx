"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const NAV_LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/marketplace", label: "Marketplace" },
];

function HeaderInner() {
  const [authed, setAuthed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setAuthed(Boolean(localStorage.getItem("token")));
  }, [pathname]);

  const logout = () => {
    localStorage.removeItem("token");
    setAuthed(false);
    window.location.href = "/login";
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-md border border-border bg-card text-[13px] leading-none font-medium text-foreground transition-colors group-hover:border-foreground/25">
            /
          </span>
          <span className="text-sm font-medium tracking-tight">
            AI Agent Space
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith(link.href)
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          <span className="mx-2 hidden h-4 w-px bg-border sm:block" />
          {authed ? (
            <button
              onClick={logout}
              className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Log out
            </button>
          ) : (
            <>
              <Link
                href="/login"
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  pathname === "/login"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="ml-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function SiteHeader() {
  return (
    <Suspense
      fallback={<header className="sticky top-0 z-40 h-14 border-b border-border/60 bg-background/80" />}
    >
      <HeaderInner />
    </Suspense>
  );
}
