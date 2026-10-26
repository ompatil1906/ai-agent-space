"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CircleAlertIcon,
  DownloadIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  TrendingUpIcon,
} from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, StatCard } from "@/components/ui-page";
import { api, API_BASE, getToken, messageFromError } from "@/lib/api";
import { currencySymbol, formatMoney, pricingLabel } from "@/lib/money";

/* ---------------------------------------------------------------- types */

interface Overview {
  gross_sales_minor: number;
  platform_fees_minor: number;
  net_earnings_minor: number;
  refund_reversals_total_minor: number;
  ledger_balance_minor: number;
  pending_payout_minor: number;
  available_to_payout_minor: number;
  total_paid_out_minor: number;
  currency: string;
  total_sales: number;
  active_subscriptions: number;
  published_agents: number;
  customers: number;
  monthly_series: {
    month: string;
    net_minor?: number;
    [k: string]: unknown;
  }[];
  per_agent: {
    agent_id: number;
    name: string;
    slug?: string;
    sales: number;
    gross_minor: number;
  }[];
}

interface Profile {
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  website_url?: string | null;
  payout_currency?: string | null;
  payout_account_name?: string | null;
  payout_account_number?: string | null;
  payout_ifsc?: string | null;
  payout_vpa?: string | null;
  onboarding_status: string;
  is_verified: boolean;
}

interface LedgerEntry {
  id: number;
  entry_type: string;
  amount_minor: number;
  currency: string;
  balance_after_minor: number;
  reference?: string | null;
  note?: string | null;
  created_at: string;
}

interface Payout {
  id: number;
  reference: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider?: string | null;
  provider_payout_id?: string | null;
  failure_reason?: string | null;
  requested_at: string;
  processed_at?: string | null;
}

interface Plan {
  id: number;
  agent_id: number;
  model: string;
  currency: string;
  amount_minor: number;
  billing_interval?: string | null;
  runs_per_pack?: number | null;
  is_active: boolean;
}

interface MyAgent {
  id: number;
  name: string;
  is_published?: boolean;
  status?: string;
}

interface PayoutRequest {
  amount_minor: number;
}

interface PlanRequest {
  model: string;
  currency: string;
  amount_minor: number;
  billing_interval: string | null;
  runs_per_pack: number | null;
}

/* -------------------------------------------------------------- constants */

const MODELS = [
  { value: "free", label: "Free" },
  { value: "one_time", label: "One-time purchase" },
  { value: "subscription", label: "Subscription" },
  { value: "pay_per_execution", label: "Prepaid run pack" },
];

const ENTRY_TYPES = [
  { value: "all", label: "All entry types" },
  { value: "sale", label: "Sales" },
  { value: "refund_reversal", label: "Refund reversals" },
  { value: "payout", label: "Payouts" },
  { value: "fee_correction", label: "Fee corrections" },
];

/** entry_type → badge label + semantic-only colors. */
const ENTRY_BADGE: Record<string, { label: string; className: string }> = {
  sale: {
    label: "Sale",
    className: "border-transparent bg-success/10 text-success ring-1 ring-success/20",
  },
  refund_reversal: {
    label: "Refund reversal",
    className: "border-transparent bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  },
  payout: {
    label: "Payout",
    className: "border-transparent bg-warning/10 text-warning ring-1 ring-warning/20",
  },
  fee_correction: {
    label: "Fee correction",
    className: "bg-muted text-muted-foreground",
  },
};

/** payout status → badge label + semantic-only colors. */
const PAYOUT_BADGE: Record<string, { className: string }> = {
  requested: {
    className: "border-transparent bg-warning/10 text-warning ring-1 ring-warning/20",
  },
  processing: {
    className: "border-transparent bg-brand/10 text-brand ring-1 ring-brand/20",
  },
  paid: {
    className: "border-transparent bg-success/10 text-success ring-1 ring-success/20",
  },
  failed: {
    className: "border-transparent bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  },
  cancelled: {
    className: "border-transparent bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  },
};

/**
 * Mirrors `settings.PLATFORM_MIN_PAYOUT_MINOR = 50000` in the backend — the
 * same floor is enforced server-side on `POST /creator/payouts`.
 */
const PLATFORM_MIN_PAYOUT_MINOR = 50000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------------------------------------------------------------- helpers */

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 && y ? `${MONTHS[idx]} ’${y.slice(-2)}` : key;
}

const COMPACT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

/* --------------------------------------------------------------- tooltips */

function ChartTip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const minor = Math.round(Number(payload[0]?.value ?? 0) * 100);
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{formatMoney(minor, currency)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function EarningsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [myAgents, setMyAgents] = useState<MyAgent[]>([]);
  const [loadError, setLoadError] = useState("");

  // ledger filters
  const [entryType, setEntryType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerTick, setLedgerTick] = useState(0);
  const [exporting, setExporting] = useState(false);

  // payout request
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutMsg, setPayoutMsg] = useState("");
  const [requestingPayout, setRequestingPayout] = useState(false);

  // profile form
  const [savingProfile, setSavingProfile] = useState(false);

  // pricing panel
  const [pricingAgentId, setPricingAgentId] = useState("");
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planModel, setPlanModel] = useState("free");
  const [planAmount, setPlanAmount] = useState("");
  const [planInterval, setPlanInterval] = useState("month");
  const [planRuns, setPlanRuns] = useState("");
  const [planMsg, setPlanMsg] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  /** One refresh of the overview endpoints — the ledger is owned by the
   *  filter-fetch effect so the two never fight over the same state. */
  const load = async () => {
    setLoadError("");
    const results = await Promise.all([
      api<Overview>("/creator/overview"),
      api<Profile>("/creator/profile"),
      api<Payout[]>("/creator/payouts"),
      api<MyAgent[]>("/agents/"),
    ]).catch((e: unknown) => {
      setLoadError(messageFromError(e));
      return null;
    });
    if (!results) return;
    const [ov, pf, po, ag] = results;
    setOverview(ov);
    setProfile(pf);
    setPayouts(po);
    setMyAgents(ag);
  };

  useEffect(() => {
    (async () => {
      const t = await Promise.resolve(getToken());
      if (!t) {
        router.push("/login");
        return;
      }
      setToken(t);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Ledger fetch — entry_type filter + date range via query params. */
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLedgerLoading(true);
    setLedgerError("");
    const qs = new URLSearchParams();
    if (entryType) qs.set("entry_type", entryType);
    if (fromDate) qs.set("from_date", fromDate);
    if (toDate) qs.set("to_date", toDate);
    const path = `/creator/earnings${qs.toString() ? `?${qs.toString()}` : ""}`;
    api<LedgerEntry[]>(path, { signal: controller.signal })
      .then((d) => {
        setLedger(d ?? []);
        setLedgerLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        setLedgerError(messageFromError(e));
        setLedgerLoading(false);
      });
    return () => controller.abort();
  }, [token, entryType, fromDate, toDate, ledgerTick]);

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      const saved = await api<Profile>("/creator/profile", {
        method: "PUT",
        body: {
          display_name: profile.display_name || null,
          bio: profile.bio || null,
          avatar_url: profile.avatar_url || null,
          website_url: profile.website_url || null,
          payout_currency: profile.payout_currency || null,
          payout_account_name: profile.payout_account_name || null,
          payout_account_number: profile.payout_account_number || null,
          payout_ifsc: profile.payout_ifsc || null,
          payout_vpa: profile.payout_vpa || null,
        },
      });
      setProfile(saved);
      toast.success("Profile saved");
    } catch (e: unknown) {
      toast.error(messageFromError(e));
    } finally {
      setSavingProfile(false);
    }
  };

  const validatePayout = (minor: number, available: number): string => {
    if (!minor || minor <= 0) return "Enter an amount greater than zero.";
    if (minor < PLATFORM_MIN_PAYOUT_MINOR) {
      return `Minimum payout is ${formatMoney(PLATFORM_MIN_PAYOUT_MINOR, overview?.currency || "INR")}.`;
    }
    if (minor > available) {
      return `Requested amount exceeds your available balance (${formatMoney(available, overview?.currency || "INR")}).`;
    }
    return "";
  };

  const requestPayout = async () => {
    if (!overview) return;
    const minor = Math.round(parseFloat(payoutAmount || "0") * 100);
    const available = overview.available_to_payout_minor;
    const msg = validatePayout(minor, available);
    if (msg) {
      setPayoutMsg(msg);
      return;
    }
    setRequestingPayout(true);
    setPayoutMsg("");
    try {
      // Body kept exactly as before: { amount_minor } — backend asks
      // PayoutRequestIn and derives the currency itself.
      const body: PayoutRequest = { amount_minor: minor };
      await api<Payout>("/creator/payouts", { method: "POST", body });
      setPayoutAmount("");
      setPayoutOpen(false);
      await load();
      setLedgerTick((t) => t + 1);
      toast.success(
        "Payout requested. It stays “requested” until the platform confirms the transfer with the payment provider."
      );
    } catch (e: unknown) {
      setPayoutMsg(messageFromError(e));
    } finally {
      setRequestingPayout(false);
    }
  };

  const downloadCsv = async () => {
    const t = getToken();
    if (!t) return;
    setExporting(true);
    try {
      // CSV needs the Authorization header (the endpoint is protected), so a
      // plain window.open URL won't work — keep the fetch + blob download,
      // now extended with the active ledger filters.
      const qs = new URLSearchParams({ format: "csv" });
      if (entryType) qs.set("entry_type", entryType);
      if (fromDate) qs.set("from_date", fromDate);
      if (toDate) qs.set("to_date", toDate);
      const res = await fetch(`${API_BASE}/creator/earnings?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) throw new Error("CSV export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "earnings.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      toast.error(messageFromError(e));
    } finally {
      setExporting(false);
    }
  };

  const loadPlans = async (agentId: string) => {
    setPricingAgentId(agentId);
    setPlans(null);
    setPlanMsg("");
    if (!agentId) return;
    try {
      const data = await api<Plan[]>(`/creator/agents/${agentId}/pricing`);
      setPlans(data);
      const active = data.find((p) => p.is_active) ?? data[0];
      if (active) {
        setPlanModel(active.model);
        setPlanAmount(active.amount_minor ? String(active.amount_minor / 100) : "");
        setPlanInterval(active.billing_interval || "month");
        setPlanRuns(active.runs_per_pack ? String(active.runs_per_pack) : "");
      }
    } catch (e: unknown) {
      toast.error(messageFromError(e));
    }
  };

  const savePlan = async () => {
    if (!pricingAgentId) return;
    const body: PlanRequest = {
      model: planModel,
      currency: "INR",
      amount_minor: Math.round(parseFloat(planAmount || "0") * 100),
      billing_interval: planModel === "subscription" ? planInterval : null,
      runs_per_pack: planModel === "pay_per_execution" ? parseInt(planRuns || "0", 10) || null : null,
    };
    if (planModel !== "free" && body.amount_minor <= 0) {
      setPlanMsg("Price must be greater than zero.");
      return;
    }
    setSavingPlan(true);
    setPlanMsg("");
    try {
      await api<Plan[]>(`/creator/agents/${pricingAgentId}/pricing`, { method: "POST", body });
      setPlanMsg("Pricing saved — buyers see it on the listing immediately.");
      await loadPlans(pricingAgentId);
    } catch (e: unknown) {
      setPlanMsg(messageFromError(e));
    } finally {
      setSavingPlan(false);
    }
  };

  if (!token) return <div className="min-h-[40vh]" />;

  const cur = overview?.currency || "INR";
  const available = overview?.available_to_payout_minor ?? 0;
  const pending = overview?.pending_payout_minor ?? 0;
  const hasDestination = Boolean(profile?.payout_vpa || profile?.payout_account_number);

  const chartData = (overview?.monthly_series ?? []).map((m) => {
    const net = Number(
      m.net_minor ??
        (m as { gross_minor?: number }).gross_minor ??
        (m as { amount_minor?: number }).amount_minor ??
        0
    );
    return { month: String(m.month), label: monthLabel(String(m.month)), net: net / 100 };
  });

  const compact = (value: number) => `${currencySymbol(cur)}${COMPACT.format(value)}`;
  const filtersActive = Boolean(entryType || fromDate || toDate);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
      <PageHeader
        title="Earnings"
        description="Your sales, your ledger, your payouts — every number here is derived from the auditable ledger, not an estimate."
      >
        <Button variant="outline" render={<Link href="/agents" />}>
          My agents
        </Button>
        <Button onClick={() => { setPayoutMsg(""); setPayoutOpen(true); }}>
          <PlusIcon /> Request payout
        </Button>
      </PageHeader>

      {loadError && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-8 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            <CircleAlertIcon className="size-5" />
          </span>
          <p className="mt-4 font-medium">Could not load your earnings</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" className="mt-5" onClick={load}>
            <RefreshCwIcon /> Retry
          </Button>
        </div>
      )}

      {!loadError && (
        <>
          {/* -------------------------------------------------- overview */}
          {!overview || !overview.monthly_series ? (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[86px] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Available balance"
                value={formatMoney(available, cur)}
                sub="ready to withdraw"
              />
              <StatCard
                label="Pending payouts"
                value={formatMoney(pending, cur)}
                sub={pending > 0 ? "reserved until the provider confirms" : "nothing in flight"}
              />
              <StatCard
                label="Lifetime net"
                value={formatMoney(overview.net_earnings_minor, cur)}
                sub="after platform fees"
              />
              <StatCard
                label="Gross sales"
                value={formatMoney(overview.gross_sales_minor, cur)}
                sub={`${overview.total_sales} paid sale${overview.total_sales === 1 ? "" : "s"} · ${overview.customers} customer${overview.customers === 1 ? "" : "s"}`}
              />
              <StatCard
                label="Platform fees"
                value={formatMoney(overview.platform_fees_minor, cur)}
                sub={`commission withheld at payment · ${formatMoney(overview.refund_reversals_total_minor, cur)} refund reversals`}
              />
            </div>
          )}

          {/* ---------------------------------------------- monthly chart */}
          {overview && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Monthly net earnings</CardTitle>
                <CardDescription>
                  Credited minus debited, straight from the ledger — sales lead, refunds and payouts pull it down.
                </CardDescription>
                <CardAction>
                  <Badge variant="outline">{cur}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
                      <TrendingUpIcon className="size-4" />
                    </span>
                    <p className="mt-3 text-sm font-medium">No ledger activity yet</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                      Once a customer pays for one of your agents, monthly net earnings plot here.
                    </p>
                  </div>
                ) : (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="ledgerFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={56}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                          tickFormatter={(v: number) => compact(v)}
                        />
                        <Tooltip cursor={{ stroke: "var(--border)" }} content={<ChartTip currency={cur} />} />
                        <Area
                          type="monotone"
                          dataKey="net"
                          name="Net earnings"
                          stroke="var(--chart-1)"
                          strokeWidth={2}
                          fill="url(#ledgerFill)"
                          dot={{ r: 2.5, fill: "var(--chart-1)", strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ------------------------------------------------ per-agent */}
          {overview && overview.per_agent.length > 0 && (
            <Card className="mb-6" size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Sales by agent</CardTitle>
                <CardDescription>Where your gross revenue comes from.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {overview.per_agent.map((a) => (
                  <div
                    key={a.agent_id}
                    className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm ring-1 ring-foreground/5"
                  >
                    <span className="min-w-0 truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {a.sales} sale{a.sales === 1 ? "" : "s"} · {formatMoney(a.gross_minor, cur)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* -------------------------------------------------- ledger */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Earnings ledger</CardTitle>
              <CardDescription>
                Every credit and debit on your account — filter by type or date range.
              </CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={downloadCsv} disabled={exporting || ledger === null}>
                  {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
                  CSV
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Select
                  value={entryType || "all"}
                  onValueChange={(v) => setEntryType((v ?? "") === "all" ? "" : (v ?? ""))}
                >
                  <SelectTrigger className="w-[180px]" aria-label="Entry type">
                    <SelectValue placeholder="All entry types" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTRY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground" htmlFor="from-date">From</Label>
                  <Input
                    id="from-date"
                    type="date"
                    className="w-[150px]"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground" htmlFor="to-date">To</Label>
                  <Input
                    id="to-date"
                    type="date"
                    className="w-[150px]"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
                {filtersActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setEntryType(""); setFromDate(""); setToDate(""); }}
                  >
                    Clear filters
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh ledger"
                  onClick={() => setLedgerTick((t) => t + 1)}
                >
                  <RefreshCwIcon />
                </Button>
              </div>

              {ledgerError ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <p className="text-sm font-medium">Could not load the ledger</p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">{ledgerError}</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setLedgerTick((t) => t + 1)}>
                    <RefreshCwIcon /> Retry
                  </Button>
                </div>
              ) : ledgerLoading && ledger === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 rounded-lg" />
                  ))}
                </div>
              ) : ledger === null || ledger.length === 0 ? (
                <EmptyState
                  title="No ledger entries yet"
                  hint="When a customer pays for one of your agents, the net earnings are posted here."
                />
              ) : (
                <div className="max-h-[440px] overflow-y-auto rounded-lg ring-1 ring-foreground/5">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Detail</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Running balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.map((e) => {
                        const badge = ENTRY_BADGE[e.entry_type] ?? {
                          label: e.entry_type,
                          className: "bg-muted text-muted-foreground",
                        };
                        return (
                          <TableRow key={e.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {new Date(e.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                              {e.note || e.reference || "—"}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono font-medium ${
                                e.amount_minor < 0 ? "text-destructive" : "text-success"
                              }`}
                            >
                              {e.amount_minor < 0 ? "−" : "+"}
                              {formatMoney(Math.abs(e.amount_minor), e.currency)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {formatMoney(e.balance_after_minor, e.currency)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ------------------------------------------------- payouts */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Payouts</CardTitle>
              <CardDescription>
                Paid via the platform provider (RazorpayX when configured) to the bank account / UPI configured below.
                Minimum {formatMoney(PLATFORM_MIN_PAYOUT_MINOR, cur)} per payout.
              </CardDescription>
              <CardAction>
                <Button
                  size="sm"
                  onClick={() => { setPayoutMsg(""); setPayoutOpen(true); }}
                  disabled={available < PLATFORM_MIN_PAYOUT_MINOR}
                >
                  Request payout
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {payouts === null ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 rounded-lg" />
                  <Skeleton className="h-10 rounded-lg" />
                </div>
              ) : payouts.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
                    <LandmarkIcon className="size-4" />
                  </span>
                  <p className="mt-3 text-sm font-medium">No payouts yet</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Once your available balance clears the platform minimum, request a payout and track it here.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map((p) => {
                      const badge = PAYOUT_BADGE[p.status] ?? {
                        className: "bg-muted text-muted-foreground",
                      };
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <p className="font-mono text-xs">{p.reference}</p>
                            {p.failure_reason && (
                              <p className="mt-0.5 text-[11px] text-destructive">{p.failure_reason}</p>
                            )}
                            {p.provider_payout_id && (
                              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                evidence {p.provider_payout_id}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={badge.className}>{p.status}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {new Date(p.requested_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatMoney(p.amount_minor, p.currency)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ---------------------------------------------- pricing plans */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Pricing plans</CardTitle>
              <CardDescription>
                Set what buyers pay per agent — the active plan is charged at checkout immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {myAgents.length === 0 ? (
                <EmptyState
                  title="Create an agent first"
                  hint="Pricing is set per agent — create one and it shows up here."
                  actionLabel="Go to my agents"
                  actionHref="/agents"
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select value={pricingAgentId} onValueChange={(v) => loadPlans(v ?? "")}>
                      <SelectTrigger className="w-[240px]" aria-label="Agent">
                        <SelectValue placeholder="Choose agent…" />
                      </SelectTrigger>
                      <SelectContent>
                        {myAgents.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {plans !== null && plans.length > 0 && (
                      <p className="pb-2 text-xs text-muted-foreground">
                        current:{" "}
                        {plans.filter((p) => p.is_active).map((p) => pricingLabel(p)).join(", ") || "none active"}
                      </p>
                    )}
                  </div>
                  {pricingAgentId && (
                    <div className="space-y-3 rounded-xl bg-muted/40 p-4 ring-1 ring-foreground/10">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <Label>Model</Label>
                          <Select value={planModel} onValueChange={(v) => setPlanModel(v ?? "free")}>
                            <SelectTrigger className="w-[190px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MODELS.map((m) => (
                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {planModel !== "free" && (
                          <div className="space-y-1">
                            <Label htmlFor="plan-amount">Price (₹)</Label>
                            <Input
                              id="plan-amount"
                              type="number"
                              min={1}
                              step="0.01"
                              className="w-32"
                              value={planAmount}
                              onChange={(e) => setPlanAmount(e.target.value)}
                              placeholder="e.g. 499"
                            />
                          </div>
                        )}
                        {planModel === "subscription" && (
                          <div className="space-y-1">
                            <Label>Billing</Label>
                            <Select value={planInterval} onValueChange={(v) => setPlanInterval(v ?? "month")}>
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="month">Monthly</SelectItem>
                                <SelectItem value="year">Yearly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {planModel === "pay_per_execution" && (
                          <div className="space-y-1">
                            <Label htmlFor="plan-runs">Runs per pack</Label>
                            <Input
                              id="plan-runs"
                              type="number"
                              min={1}
                              className="w-32"
                              value={planRuns}
                              onChange={(e) => setPlanRuns(e.target.value)}
                              placeholder="e.g. 100"
                            />
                          </div>
                        )}
                        <Button onClick={savePlan} disabled={savingPlan}>
                          {savingPlan && <LoaderCircleIcon className="animate-spin" />}
                          {savingPlan ? "Saving…" : "Save pricing"}
                        </Button>
                      </div>
                      {planModel !== "free" && (
                        <p className="text-xs text-muted-foreground">
                          Amounts are charged in INR. The platform takes{" "}
                          <span className="font-medium">commission at payment time</span>; your net share is credited to
                          the ledger the moment the payment is verified.
                        </p>
                      )}
                      {planMsg && <p className="text-sm">{planMsg}</p>}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* --------------------------------------- profile / payout details */}
          <Card>
            <CardHeader>
              <CardTitle>Creator profile &amp; payout details</CardTitle>
              <CardDescription>
                Account details are stored for payout settlement only. Payouts are transferred to verified
                destinations (RazorpayX fund accounts) and never to this UI.
              </CardDescription>
              <CardAction>
                {profile && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      profile.onboarding_status === "verified"
                        ? "border-transparent bg-success/10 text-success ring-1 ring-success/20"
                        : profile.onboarding_status === "pending"
                          ? "border-transparent bg-warning/10 text-warning ring-1 ring-warning/20"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {profile.onboarding_status}
                    {profile.is_verified ? " · verified" : ""}
                  </Badge>
                )}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              {profile ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="display-name">Display name</Label>
                      <Input
                        id="display-name"
                        value={profile.display_name || ""}
                        onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="website">Website</Label>
                      <Input
                        id="website"
                        value={profile.website_url || ""}
                        onChange={(e) => setProfile({ ...profile, website_url: e.target.value })}
                        placeholder="https://…"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      id="bio"
                      rows={2}
                      value={profile.bio || ""}
                      onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="payee-name">Payee account name</Label>
                      <Input
                        id="payee-name"
                        value={profile.payout_account_name || ""}
                        onChange={(e) => setProfile({ ...profile, payout_account_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="payee-vpa">UPI (or bank below)</Label>
                      <Input
                        id="payee-vpa"
                        value={profile.payout_vpa || ""}
                        onChange={(e) => setProfile({ ...profile, payout_vpa: e.target.value })}
                        placeholder="name@upi"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="payee-number">Bank account number</Label>
                      <Input
                        id="payee-number"
                        value={profile.payout_account_number || ""}
                        onChange={(e) => setProfile({ ...profile, payout_account_number: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="payee-ifsc">IFSC</Label>
                      <Input
                        id="payee-ifsc"
                        value={profile.payout_ifsc || ""}
                        onChange={(e) => setProfile({ ...profile, payout_ifsc: e.target.value })}
                      />
                    </div>
                  </div>
                  {!hasDestination && (
                    <p className="text-xs text-warning">
                      Add your UPI or bank details and save before requesting a payout — transfers go to a verified destination.
                    </p>
                  )}
                  <Button onClick={saveProfile} disabled={savingProfile}>
                    {savingProfile && <LoaderCircleIcon className="animate-spin" />}
                    {savingProfile ? "Saving…" : "Save profile"}
                  </Button>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                  </div>
                  <Skeleton className="h-8 w-32" />
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* payout request dialog */}
      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a payout</DialogTitle>
            <DialogDescription>
              Up to {formatMoney(available, cur)} is available · platform minimum{" "}
              {formatMoney(PLATFORM_MIN_PAYOUT_MINOR, cur)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="payout-amount">Amount ({cur})</Label>
              <Input
                id="payout-amount"
                type="number"
                min={1}
                step="0.01"
                value={payoutAmount}
                onChange={(e) => {
                  setPayoutAmount(e.target.value);
                  setPayoutMsg("");
                }}
                placeholder={overview ? String(available / 100) : "0"}
                disabled={requestingPayout}
              />
            </div>
            {payoutMsg && <p className="text-xs text-destructive">{payoutMsg}</p>}
            {!hasDestination && (
              <p className="text-xs text-warning">
                Add a UPI or bank account under “Creator profile &amp; payout details” first — payouts need a
                verified destination.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              It stays “requested” until the platform confirms the transfer with the payment provider.
            </p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={requestPayout} disabled={requestingPayout}>
              {requestingPayout && <LoaderCircleIcon className="animate-spin" />}
              {requestingPayout ? "Requesting…" : "Request payout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
