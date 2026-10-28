"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDownIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldCheckIcon,
  StoreIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import { AUTH_EVENT, api, clearToken, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Me {
  email: string;
  full_name?: string | null;
  role?: string;
  is_superuser?: boolean;
  avatar_url?: string | null;
}

/* Neutral monogram — the brand accent stays in the buttons. */
const MONOGRAM = "bg-primary text-primary-foreground text-[11px] font-semibold";

/* Primary nav stays short — account pages live in the account menu. */
const NAV_LINKS = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/agents", label: "My Agents" },
  { href: "/mcp-servers", label: "MCP" },
] as const;

/** Module-level session cache — the header fetches `/users/me` once per token. */
let cachedMe: Me | null = null;
let cacheToken: string | null = null;

function initials(me: Me | null): string {
  const source = me?.full_name?.trim() || me?.email || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase() || "…";
}

function HeaderInner() {
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const token = await Promise.resolve(getToken());
      if (cancelled) return;
      if (!token) {
        setAuthed(false);
        setMe(null);
        cachedMe = null;
        cacheToken = null;
        return;
      }
      if (token === cacheToken && cachedMe) {
        setAuthed(true);
        setMe(cachedMe);
        return;
      }
      const user = await api<Me>("/users/me", { method: "GET" }).catch(() => null);
      if (cancelled) return;
      cacheToken = token;
      cachedMe = user;
      setAuthed(true);
      setMe(user);
    };

    void sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EVENT, sync);
    };
  }, []);

  // Close the mobile panel whenever a navigation happens.
  useEffect(() => {
    void Promise.resolve().then(() => setOpen(false));
  }, [pathname]);

  const logout = async () => {
    clearToken();
    cachedMe = null;
    cacheToken = null;
    setAuthed(false);
    setMe(null);
    toast.success("Signed out");
    router.push("/login");
  };

  const isAdmin = Boolean(me && (me.role === "admin" || me.is_superuser));

  const navLinkClass = (href: string) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm transition-colors",
      pathname === href || (href !== "/" && pathname.startsWith(href + "/"))
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
    );

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border/80 bg-zinc-950 p-1 shadow-sm">
            <Image
              src="/logos/icon.svg"
              alt="AI Agent Space logo"
              width={20}
              height={20}
              className="size-5 rounded-sm object-contain"
            />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            AI Agent Space
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="ml-2 hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClass(link.href)}>
              {link.label}
            </Link>
          ))}
          {authed && isAdmin && (
            <Link href="/admin" className={navLinkClass("/admin")}>
              Admin
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />

          {authed ? (
            <>
              <Button render={<Link href="/agents" />}>New agent</Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      aria-label="Account menu"
                      className="gap-1.5 rounded-full pl-1 pr-1.5"
                    >
                      <Avatar className="size-7" aria-hidden="true">
                        {me?.avatar_url ? (
                          <AvatarImage src={me.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className={MONOGRAM}>
                          {initials(me)}
                        </AvatarFallback>
                      </Avatar>
                      <ChevronDownIcon className="size-3 text-muted-foreground" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="flex items-center gap-2.5 px-1.5 py-2">
                      <Avatar className="size-9" aria-hidden="true">
                        {me?.avatar_url ? (
                          <AvatarImage src={me.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className={cn(MONOGRAM, "text-sm")}>
                          {initials(me)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="min-w-0 max-w-44 truncate text-sm font-medium text-foreground">
                          {me?.full_name?.trim() || me?.email}
                        </span>
                        <span className="min-w-0 max-w-44 truncate text-xs font-normal text-muted-foreground">
                          {me?.email}
                        </span>
                      </div>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {authed && isAdmin && (
                      <DropdownMenuItem render={<Link href="/admin" />}>
                        <ShieldCheckIcon /> Admin console
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem render={<Link href="/dashboard" />}>
                      <LayoutDashboardIcon /> Dashboard
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link href="/purchases" />}>
                      <StoreIcon /> Purchases
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link href="/earnings" />}>
                      <WalletIcon /> Earnings
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link href="/settings" />}>
                      <SettingsIcon /> Settings
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive">
                    <LogOutIcon /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" render={<Link href="/login" />}>
                Log in
              </Button>
              <Button render={<Link href="/register" />}>Sign up free</Button>
            </div>
          )}

          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <XIcon className="size-4" /> : <MenuIcon className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Mobile nav panel */}
      <div
        id="mobile-nav"
        className={cn(
          "border-border/70 border-t bg-background/95 backdrop-blur-md transition-all duration-200 lg:hidden",
          open
            ? "visible max-h-[420px] opacity-100"
            : "invisible max-h-0 overflow-hidden border-t-0 opacity-0"
        )}
      >
        <nav className="flex max-h-[420px] flex-col overflow-y-auto px-4 py-3" aria-label="Mobile">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors",
                pathname.startsWith(link.href)
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          {authed && isAdmin && (
            <Link href="/admin" className={cn(navLinkClass("/admin"), "px-3 py-2")}>
              Admin
            </Link>
          )}
          {authed ? (
            <Button variant="outline" className="mt-2" onClick={logout}>
              <LogOutIcon className="size-4" /> Log out
            </Button>
          ) : (
            <div className="mt-2 flex flex-col gap-2 sm:hidden">
              <Button variant="outline" render={<Link href="/login" />}>
                Log in
              </Button>
              <Button render={<Link href="/register" />}>Sign up free</Button>
            </div>
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
