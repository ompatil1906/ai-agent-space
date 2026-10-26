"use client";

/**
 * Customer purchases.
 *
 * Data — all through the shared api client (`@/lib/api`):
 *   GET  /purchases                              → entitlements ("My Agents")
 *   GET  /purchases/history                      → order history
 *   GET  /purchases/subscriptions                → subscriptions
 *   POST /purchases/subscriptions/{id}/cancel    → cancel at period end
 *
 * Structure: stat strip → two-column layout (My agents grid | Subscriptions
 * card) → order history table.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader, StatCard } from "@/components/ui-page";
import { AgentMonogram } from "@/components/marketplace/agent-card";
import { api, getToken, messageFromError, useApiQuery } from "@/lib/api";
import type {
  EntitlementPublic,
  PurchasePublic,
  SubscriptionPublic,
} from "@/lib/types";
import { formatMoney, pricingLabel } from "@/lib/money";

/* ------------------------------------------------------------------ shared */

/* Status badges — semantic tokens only: active=success, muted=secondary,
   past due / pending / partially refunded=warning, revoked/failed=destructive. */

function EntitlementStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "active") return <Badge className="bg-success/10 text-success">active</Badge>;
  if (s === "revoked") return <Badge variant="destructive">revoked</Badge>;
  if (s === "expired" || s === "cancelled") return <Badge variant="secondary">{s}</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "active") return <Badge className="bg-success/10 text-success">active</Badge>;
  if (s === "past_due") return <Badge className="bg-warning/10 text-warning">past due</Badge>;
  if (s === "cancelled" || s === "expired") return <Badge variant="secondary">{s}</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

function PurchaseStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "paid") return <Badge className="bg-success/10 text-success">paid</Badge>;
  if (s === "pending" || s === "partially_refunded" || s === "past_due") {
    return <Badge className="bg-warning/10 text-warning">{s.replace(/_/g, " ")}</Badge>;
  }
  if (s === "failed" || s === "cancelled" || s === "revoked") {
    return <Badge variant="destructive">{s.replace(/_/g, " ")}</Badge>;
  }
  if (s === "refunded" || s === "expired") return <Badge variant="secondary">{s.replace(/_/g, " ")}</Badge>;
  return <Badge variant="outline">{s.replace(/_/g, " ")}</Badge>;
}

const ENT_SOURCE_LABEL: Record<string, string> = {
  free: "free claim",
  one_time: "one-time purchase",
  subscription: "subscription",
  pay_per_pack: "run pack",
  pay_per_execution: "run pack",
  admin_grant: "admin grant",
};

/** Timestamps render as local "short" strings; a missing stamp falls back cleanly. */
function formatStamp(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** "renews to …" for subscriptions, "until …" for anything with an expiry. */
function validityLabel(e: EntitlementPublic): string | null {
  if (!e.valid_until) return null;
  const d = new Date(e.valid_until).toLocaleDateString();
  return e.source === "subscription" ? `renews to ${d}` : `until ${d}`;
}

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
      <p className="max-w-md text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCwIcon />
        Try again
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- skeletons */

function StatRowSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card size="sm" key={i}>
          <CardHeader>
            <Skeleton className="h-3 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-32 max-w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EntitlementCardSkeleton() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-sm">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-4 w-28 max-w-full" />
        </CardTitle>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-4xl" />
          <Skeleton className="h-5 w-24 rounded-4xl" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-28 rounded-lg" />
      </CardContent>
    </Card>
  );
}

function SubRowSkeleton() {
  return (
    <div className="rounded-lg px-3 py-2.5 ring-1 ring-foreground/5">
      <Skeleton className="h-3.5 w-32" />
      <Skeleton className="mt-2 h-3 w-40 max-w-full" />
    </div>
  );
}

function TableRowSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

const PageSkeleton = () => (
  <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
    <PageHeader
      title="Purchases"
      description="Everything you own, what you paid, and the subscriptions you control."
    />
    <div className="flex flex-col gap-6">
      <StatRowSkeleton />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <EntitlementCardSkeleton key={i} />
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <SubRowSkeleton />
            <SubRowSkeleton />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <TableRowSkeleton rows={3} />
        </CardContent>
      </Card>
    </div>
  </div>
);

/* ------------------------------------------------------------------- page */

export default function PurchasesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    // Intentional one-time auth gate — the queries below hold until this flips.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [router]);

  const {
    data: entitlements,
    loading: entLoading,
    error: entError,
    reload: reloadEntitlements,
  } = useApiQuery<EntitlementPublic[]>(ready ? "/purchases" : null);

  const {
    data: history,
    loading: histLoading,
    error: histError,
    reload: reloadHistory,
  } = useApiQuery<PurchasePublic[]>(ready ? "/purchases/history" : null);

  const {
    data: subscriptions,
    loading: subLoading,
    error: subError,
    reload: reloadSubscriptions,
  } = useApiQuery<SubscriptionPublic[]>(ready ? "/purchases/subscriptions" : null);

  /** Suppresses the cancel row buttons + confirm button while the request runs. */
  const [cancelling, setCancelling] = useState(false);
  /** Subscription whose cancel is confirmed in the AlertDialog. */
  const [cancelTarget, setCancelTarget] = useState<SubscriptionPublic | null>(null);

  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const res = await api<{ status: string; at_period_end: boolean }>(
        `/purchases/subscriptions/${cancelTarget.id}/cancel`,
        { method: "POST" }
      );
      if (res.status === "already_cancelled") {
        toast.info("Subscription is already cancelled.");
      } else {
        toast.success(
          "Subscription cancelled — access continues until the end of the paid period."
        );
      }
      setCancelTarget(null);
      reloadEntitlements();
      reloadSubscriptions();
      reloadHistory();
    } catch (e) {
      toast.error(messageFromError(e));
    } finally {
      setCancelling(false);
    }
  };

  const activeCount = entitlements
    ? entitlements.filter((e) => e.status === "active").length
    : null;
  const activeSubs = subscriptions
    ? subscriptions.filter((s) => s.status === "active").length
    : null;

  // Paid orders only (verified payments) — same rule as before.
  const paidOrders = (history ?? []).filter(
    (p) => p.status === "paid" || p.status === "partially_refunded"
  );
  const totalSpent = history
    ? {
        amount: paidOrders.reduce((sum, p) => sum + p.amount_minor, 0),
        currency: paidOrders[0]?.currency ?? "INR",
      }
    : null;

  if (!ready) return <PageSkeleton />;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
      <PageHeader
        title="Purchases"
        description="Everything you own, what you paid, and the subscriptions you control."
      >
        <Button variant="outline" render={<Link href="/marketplace" />}>
          Browse marketplace
        </Button>
      </PageHeader>

      {!entitlements && !history && !subscriptions ? (
        <StatRowSkeleton />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Active access"
            value={activeCount != null ? String(activeCount) : "—"}
            sub="agents available right now"
          />
          <StatCard
            label="Total spent"
            value={totalSpent ? formatMoney(totalSpent.amount, totalSpent.currency) : "—"}
            sub="verified payments only"
          />
          <StatCard
            label="Subscriptions"
            value={activeSubs != null ? String(activeSubs) : "—"}
            sub="active auto-renewals"
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* ---------------------------------------------- my agents */}
        <section className="flex flex-col gap-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">My agents</h2>
            <Link
              href="/marketplace"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              browse marketplace →
            </Link>
          </div>

          {entitlements === null ? (
            entLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <EntitlementCardSkeleton key={i} />
                ))}
              </div>
            ) : entError ? (
              <PanelError message={entError} onRetry={reloadEntitlements} />
            ) : null
          ) : entitlements.length === 0 ? (
            <EmptyState
              title="No agents yet"
              hint="Claim free agents or get your first one from the marketplace."
              actionHref="/marketplace"
              actionLabel="Browse marketplace"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {entitlements.map((e) => {
                const valid = validityLabel(e);
                return (
                  <Card size="sm" key={e.id} className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="flex min-w-0 items-center gap-2.5 text-sm leading-snug">
                        <AgentMonogram
                          agent={{
                            id: e.agent_id,
                            name: e.agent_name ?? `Agent ${e.agent_id}`,
                            avatar_url: e.avatar_url,
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {e.agent_name ?? `Agent ${e.agent_id}`}
                        </span>
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EntitlementStatusBadge status={e.status} />
                        <Badge variant="outline" className="text-[10px]">
                          {ENT_SOURCE_LABEL[e.source] ?? e.source}
                        </Badge>
                        {e.runs_remaining != null && (
                          <Badge className="bg-brand/10 text-brand">
                            {e.runs_remaining} run{e.runs_remaining === 1 ? "" : "s"} left
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
                      {(e.status === "active" || e.status === "expired") && (
                        <Button size="sm" render={<Link href={`/agents/${e.agent_id}`} />}>
                          Open console
                        </Button>
                      )}
                      {e.agent_slug && (
                        <Button
                          size="xs"
                          variant="ghost"
                          render={<Link href={`/agents/${e.agent_slug}`} />}
                        >
                          Listing page
                        </Button>
                      )}
                      {valid && (
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {valid}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------ subscriptions */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Subscriptions</h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Auto-renewing access</CardTitle>
              <CardDescription>
                Cancelling stops renewal — access continues until the paid period ends.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {subscriptions === null ? (
                subLoading ? (
                  <>
                    <SubRowSkeleton />
                    <SubRowSkeleton />
                  </>
                ) : subError ? (
                  <PanelError message={subError} onRetry={reloadSubscriptions} />
                ) : null
              ) : subscriptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm font-medium">No subscriptions</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Agents with monthly access would show up here.
                  </p>
                </div>
              ) : (
                subscriptions.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {s.agent_name ?? `Agent ${s.agent_id}`}
                      </p>
                      <SubscriptionStatusBadge status={s.status} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {pricingLabel({
                        model: "subscription",
                        currency: s.currency,
                        amount_minor: s.amount_minor,
                        billing_interval: s.interval,
                      })}
                      {s.current_period_end
                        ? ` · period ends ${new Date(s.current_period_end).toLocaleDateString()}`
                        : ""}
                    </p>
                    {s.status === "active" && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => setCancelTarget(s)}
                          disabled={cancelling}
                        >
                          {cancelling && cancelTarget?.id === s.id ? "Cancelling…" : "Cancel"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ------------------------------------------- order history */}
      <section className="mt-6 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Order history</h2>
        {history === null ? (
          histLoading ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <TableRowSkeleton rows={4} />
              </CardContent>
            </Card>
          ) : histError ? (
            <PanelError message={histError} onRetry={reloadHistory} />
          ) : null
        ) : history.length === 0 ? (
          <EmptyState
            title="No purchases yet"
            hint="Your orders and receipts will appear here after your first purchase."
            actionHref="/marketplace"
            actionLabel="Browse marketplace"
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Receipts</CardTitle>
              <CardDescription>
                {history.length} order{history.length === 1 ? "" : "s"} · refunded amounts shown
                under the price.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">
                        {p.receipt_number || p.reference}
                      </TableCell>
                      <TableCell>
                        {p.agent_slug ? (
                          <Link
                            href={`/agents/${p.agent_slug}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {p.agent_name ?? `Agent ${p.agent_id}`}
                          </Link>
                        ) : (
                          <span className="text-sm">
                            {p.agent_name ?? `Agent ${p.agent_id}`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span>{p.pricing_model}</span>
                        {p.runs_included ? ` · pack of ${p.runs_included} runs` : ""}
                        {p.provider_mode ? ` · ${p.provider_mode} mode` : ""}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatStamp(p.paid_at ?? p.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm font-medium">
                          {formatMoney(p.amount_minor, p.currency)}
                        </span>
                        {(p.refunded_minor ?? 0) > 0 && (
                          <span className="mt-0.5 block font-mono text-[11px] text-warning">
                            refunded {formatMoney(p.refunded_minor ?? 0, p.currency)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <PurchaseStatusBadge status={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* cancel confirmation */}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => {
          if (!o && !cancelling) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel the {cancelTarget?.agent_name ?? "agent"} subscription?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Auto-renewal stops now; access continues until the end of the paid period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep subscription</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelling}
              onClick={() => void confirmCancel()}
            >
              {cancelling ? "Cancelling…" : "Cancel subscription"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
