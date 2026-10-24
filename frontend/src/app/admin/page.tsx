"use client";

/**
 * Admin console — moderation, orders + refunds, payouts, reports, platform
 * policy and the audit trail.
 *
 * All traffic goes through `api()` from "@/lib/api" (bearer token, typed
 * backend errors) and every parameterised/destructive action runs in a
 * Dialog or AlertDialog — never window.prompt/confirm. Feedback is toasts.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api, getToken, AUTH_EVENT, messageFromError, useApiQuery } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, PageHeader } from "@/components/ui-page";
import {
  CircleCheckIcon,
  ExternalLinkIcon,
  FlagTriangleRightIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
  StarIcon,
  TriangleAlertIcon,
  WalletIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ types */

interface AdminAgent {
  id: number;
  slug?: string | null;
  name: string;
  owner_email?: string | null;
  status: string;
  is_featured: boolean;
  pricing_model: string;
  amount_minor: number;
  currency: string;
  sales_count: number;
  updated_at: string;
  moderation_note?: string | null;
}

interface Order {
  id: number;
  reference: string;
  buyer_email?: string | null;
  agent_name?: string | null;
  agent_slug?: string | null;
  pricing_model: string;
  amount_minor: number;
  platform_fee_minor: number;
  creator_earnings_minor: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at?: string | null;
  refunded_minor: number;
}

interface Payout {
  id: number;
  reference: string;
  creator_email?: string | null;
  amount_minor: number;
  currency: string;
  destination?: string | null;
  status: string;
  provider?: string | null;
  provider_payout_id?: string | null;
  failure_reason?: string | null;
  requested_at: string;
  processed_at?: string | null;
}

interface Report {
  id: number;
  agent_id: number;
  reason: string;
  details?: string | null;
  status: string;
  created_at: string;
  resolution_note?: string | null;
}

interface Settings {
  commission_bps: number;
  currency: string;
  min_payout_minor: number;
  moderation: string;
  payment_mode?: string | null;
  payments_enabled: boolean;
}

interface AdminStats {
  currency: string;
  total_agents: number;
  published_agents: number;
  pending_review: number;
  total_users: number;
  total_paid_purchases: number;
  gross_volume_minor: number;
  platform_revenue_minor: number;
  refunded_minor: number;
  payments_enabled: boolean;
  payment_mode?: string | null;
}

interface AuditEntry {
  id: number;
  actor_id?: number | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

interface Me {
  role?: string;
  is_superuser?: boolean;
}

/* -------------------------------------------------------------- constants */

const AGENT_ACTIONS = [
  { action: "approved", label: "Approve & publish" },
  { action: "rejected", label: "Reject" },
  { action: "pending_review", label: "Send back to review" },
  { action: "published", label: "Re-publish (force)" },
  { action: "suspended", label: "Suspend" },
  { action: "draft", label: "Unlist to draft" },
  { action: "featured", label: "★ Feature" },
  { action: "unfeatured", label: "Un-feature" },
] as const;

type AgentActionValue = (typeof AGENT_ACTIONS)[number]["action"];

/** Actions that take a listing out of public view — always confirm first. */
const DESTRUCTIVE_AGENT_ACTIONS: ReadonlySet<AgentActionValue> = new Set([
  "rejected",
  "suspended",
  "draft",
]);

const VISIBILITY_AGENT_ACTIONS: ReadonlySet<AgentActionValue> = new Set([
  "featured",
  "unfeatured",
]);

const STATUS_FILTERS = ["pending_review", "published", "rejected", "suspended", "draft"];

const TABS = [
  { v: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { v: "moderation", label: "Moderation", icon: ShieldCheckIcon },
  { v: "orders", label: "Orders", icon: ReceiptTextIcon },
  { v: "payouts", label: "Payouts", icon: WalletIcon },
  { v: "reports", label: "Reports", icon: FlagTriangleRightIcon },
  { v: "settings", label: "Settings", icon: Settings2Icon },
  { v: "audit", label: "Audit", icon: ScrollTextIcon },
] as const;

type TabKey = (typeof TABS)[number]["v"];

const CONFIRM_COPY: Record<string, { title: string; body: string }> = {
  rejected: {
    title: "Reject this listing?",
    body: "It leaves the public marketplace. The owner sees a rejection and can fix issues before resubmitting.",
  },
  suspended: {
    title: "Suspend this listing?",
    body: "It is hidden from buyers immediately. Existing purchases stay valid.",
  },
  draft: {
    title: "Unlist to draft?",
    body: "The listing goes private until it is re-approved or re-published by an operator.",
  },
};

/* -------------------------------------------------------------- helpers */

const fmtDate = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleString() : "—";

/* --------------------------------------------------------------- badges */

function AgentStatusBadge({ status }: { status: string }) {
  if (status === "published") {
    return (
      <Badge variant="secondary" className="bg-success/10 text-success border-success/30">
        {status}
      </Badge>
    );
  }
  if (status === "pending_review") {
    return (
      <Badge variant="secondary" className="bg-warning/10 text-warning border-warning/30">
        {status}
      </Badge>
    );
  }
  if (status === "rejected" || status === "suspended") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  /* draft + anything unknown */
  return (
    <Badge variant="secondary" className="bg-muted text-muted-foreground">
      {status}
    </Badge>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <Badge variant="secondary" className="bg-success/10 text-success border-success/30">
        {status}
      </Badge>
    );
  }
  if (status === "partially_refunded") {
    return (
      <Badge variant="secondary" className="bg-warning/10 text-warning border-warning/30">
        {status}
      </Badge>
    );
  }
  if (status === "failed") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  if (status === "refunded") {
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground">
        {status}
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

function PayoutStatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <Badge variant="secondary" className="bg-success/10 text-success border-success/30">
        {status}
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary" className="bg-brand/10 text-brand border-brand/30">
        {status}
      </Badge>
    );
  }
  if (status === "requested") {
    return (
      <Badge variant="secondary" className="bg-warning/10 text-warning border-warning/30">
        {status}
      </Badge>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

/* ------------------------------------------------------------- fragments */

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3.5">
      <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-2xl font-medium tracking-tight">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-destructive/10 ring-1 ring-destructive/30 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-destructive">Couldn’t load this section</p>
        <p className="text-xs text-destructive/80">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-3.5" /> Retry
      </Button>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10 p-1.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
          <Skeleton className="h-5 w-20 shrink-0" />
          <Skeleton className="h-5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Settings — draft state is local so reloads after Save can't clobber typing. */
function SettingsEditor({
  settings,
  saving,
  onSave,
}: {
  settings: Settings;
  saving: boolean;
  onSave: (draft: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const parseInput = (v: string): number => {
    const n = Number.parseInt(v || "0", 10);
    return Number.isNaN(n) ? 0 : n;
  };
  return (
    <div className="max-w-xl rounded-xl bg-card ring-1 ring-foreground/10 p-5">
      <h2 className="text-sm font-medium">Platform policy</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Changes apply marketplace-wide. Money values stay integer minor units behind the scenes.
      </p>

      <div className="mt-5 space-y-5">
        <div>
          <Label
            htmlFor="settings-commission"
            className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Commission (basis points)
          </Label>
          <Input
            id="settings-commission"
            type="number"
            min={0}
            max={5000}
            value={draft.commission_bps}
            onChange={(e) => setDraft({ ...draft, commission_bps: parseInput(e.target.value) })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Platform share of each paid order — e.g. 10% = 1000 bps (currently{" "}
            {(draft.commission_bps / 100).toFixed(2)}%). Applies to new paid orders only.
          </p>
        </div>

        <div>
          <Label
            htmlFor="settings-min-payout"
            className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Minimum payout (minor units)
          </Label>
          <Input
            id="settings-min-payout"
            type="number"
            min={0}
            value={draft.min_payout_minor}
            onChange={(e) => setDraft({ ...draft, min_payout_minor: parseInput(e.target.value) })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            = {formatMoney(draft.min_payout_minor, draft.currency || "INR")} — creators can
            withdraw once their balance crosses this.
          </p>
        </div>

        <div>
          <Label
            htmlFor="settings-moderation"
            className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Moderation
          </Label>
          <Select
            value={draft.moderation}
            onValueChange={(v) => setDraft({ ...draft, moderation: v ?? "off" })}
          >
            <SelectTrigger id="settings-moderation" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">off — publish immediately</SelectItem>
              <SelectItem value="manual">manual — queue for review</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button onClick={() => onSave(draft)} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <p className="font-mono text-[11px] text-muted-foreground">
            currency {settings.currency} ·{" "}
            {settings.payments_enabled
              ? `payment mode ${settings.payment_mode}`
              : "payments NOT configured"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function AdminPage() {
  const router = useRouter();

  /* role gate — redirect-or-denied, same behaviour as the previous console */
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [tab, setTab] = useState<TabKey>("overview");

  /* moderation filters */
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  /* agent-moderation confirm */
  const [confirmAction, setConfirmAction] = useState<{
    agent: AdminAgent;
    action: AgentActionValue;
  } | null>(null);

  /* refund dialog */
  const [refundTarget, setRefundTarget] = useState<Order | null>(null);
  const [refundType, setRefundType] = useState<"refund" | "chargeback">("refund");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundAmountError, setRefundAmountError] = useState("");
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  /* payout dialogs */
  const [payoutPaidTarget, setPayoutPaidTarget] = useState<Payout | null>(null);
  const [payoutProviderId, setPayoutProviderId] = useState("");
  const [payoutProviderError, setPayoutProviderError] = useState("");
  const [payoutFailTarget, setPayoutFailTarget] = useState<Payout | null>(null);
  const [payoutFailNote, setPayoutFailNote] = useState("");
  const [payoutCancelTarget, setPayoutCancelTarget] = useState<Payout | null>(null);
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);

  /* report resolve dialog */
  const [resolveTarget, setResolveTarget] = useState<{
    report: Report;
    outcome: "resolved" | "dismissed";
  } | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  /* settings editor — draft state lives inside <SettingsEditor/> */
  const [savingSettings, setSavingSettings] = useState(false);

  /* --------------------------------------------------------- role gate */

  useEffect(() => {
    let alive = true;
    const onAuth = () => {
      const next = getToken();
      setToken(next);
      if (!next) router.push("/login");
    };
    (async () => {
      await Promise.resolve(); // setState boundary — never synchronously inside the effect body
      if (!alive) return;
      const t = getToken();
      setToken(t);
      if (!t) {
        router.push("/login");
        setChecked(true);
        return;
      }
      window.addEventListener(AUTH_EVENT, onAuth);
      const me = await api<Me>("/users/me").catch(() => null);
      if (!alive) return;
      setRole(me?.role || (me?.is_superuser ? "admin" : "customer"));
      setChecked(true);
    })();
    return () => {
      alive = false;
      window.removeEventListener(AUTH_EVENT, onAuth);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------- debounced search */

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  /* --------------------------------------------------- data sections */

  const sectionReady = Boolean(token) && role === "admin";

  const agentsQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (search) p.set("search", search);
    const qs = p.toString();
    return qs ? `/admin/agents?${qs}` : "/admin/agents";
  }, [statusFilter, search]);

  const statsQ = useApiQuery<AdminStats>(sectionReady ? "/admin/stats" : null);
  const agentsQ = useApiQuery<AdminAgent[]>(sectionReady ? agentsQuery : null);
  const ordersQ = useApiQuery<Order[]>(tab === "orders" && sectionReady ? "/admin/orders" : null);
  const payoutsQ = useApiQuery<Payout[]>(
    tab === "payouts" && sectionReady ? "/admin/payouts" : null
  );
  const reportsQ = useApiQuery<Report[]>(
    tab === "reports" && sectionReady ? "/admin/reports?status_filter=all" : null
  );
  const settingsQ = useApiQuery<Settings>(
    tab === "settings" && sectionReady ? "/admin/settings" : null
  );
  const auditQ = useApiQuery<AuditEntry[]>(tab === "audit" && sectionReady ? "/admin/audit" : null);

  /* -------------------------------------------------------- mutations */

  /**
   * One mutation walker with the exact refresh policy the console has always
   * used: agents + stats refresh after every action; the active section
   * refreshes when it shows mutable data. Returns the parsed response on
   * success, `null` on failure (error already toasted via messageFromError).
   */
  const runMutation = async <T,>(opts: {
    method: "POST" | "PUT";
    path: string;
    body?: unknown;
  }): Promise<T | null> => {
    try {
      const data = await api<T>(opts.path, { method: opts.method, body: opts.body });
      statsQ.reload();
      agentsQ.reload();
      if (tab === "orders") ordersQ.reload();
      if (tab === "payouts") payoutsQ.reload();
      if (tab === "reports") reportsQ.reload();
      if (tab === "settings") settingsQ.reload();
      return data;
    } catch (e: unknown) {
      toast.error("Action failed", { description: messageFromError(e) });
      return null;
    }
  };

  /* agent moderation — the full action set, identical semantics */
  const applyAgentAction = async (agent: AdminAgent, action: AgentActionValue) => {
    const ok = await runMutation({
      method: "POST",
      path: `/admin/agents/${agent.id}/status`,
      body: { status: action },
    });
    if (ok) {
      toast.success("Listing updated", { description: `Agent #${agent.id} → ${action}` });
    }
  };

  const requestAgentAction = (agent: AdminAgent, action: AgentActionValue) => {
    if (DESTRUCTIVE_AGENT_ACTIONS.has(action)) setConfirmAction({ agent, action });
    else void applyAgentAction(agent, action);
  };

  /* refunds */
  const submitRefund = async () => {
    const target = refundTarget;
    if (!target) return;
    let amountMinor: number | null = null;
    const raw = refundAmount.trim();
    if (raw !== "") {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        setRefundAmountError(
          "Enter a whole number of paise — or clear the field to refund the full remainder."
        );
        return;
      }
      amountMinor = parsed;
    }
    setRefundSubmitting(true);
    const data = await runMutation<{ warning?: string | null }>({
      method: "POST",
      path: "/admin/refunds",
      body: {
        purchase_reference: target.reference,
        amount_minor: amountMinor,
        reason: refundReason.trim() || null,
        type: refundType,
      },
    });
    setRefundSubmitting(false);
    if (data) {
      setRefundTarget(null);
      toast.success(`Refund initiated for ${target.reference}`, {
        description: data.warning || undefined,
      });
    }
  };

  /* payouts state machine */
  const submitPayoutPaid = async () => {
    const target = payoutPaidTarget;
    if (!target) return;
    const providerId = payoutProviderId.trim();
    if (!providerId) {
      setPayoutProviderError("Provider payout reference is required — payouts are never confirmed without provider evidence.");
      return;
    }
    setPayoutSubmitting(true);
    const ok = await runMutation({
      method: "POST",
      path: `/admin/payouts/${target.id}/action`,
      body: { action: "mark_paid", provider_payout_id: providerId },
    });
    setPayoutSubmitting(false);
    if (ok) {
      setPayoutPaidTarget(null);
      toast.success("Payout confirmed", {
        description: `Payout ${target.reference} → paid (evidence ${providerId})`,
      });
    }
  };

  const submitPayoutFail = async () => {
    const target = payoutFailTarget;
    if (!target) return;
    setPayoutSubmitting(true);
    const ok = await runMutation({
      method: "POST",
      path: `/admin/payouts/${target.id}/action`,
      body: { action: "mark_failed", note: payoutFailNote.trim() || null },
    });
    setPayoutSubmitting(false);
    if (ok) {
      setPayoutFailTarget(null);
      toast.success("Payout marked failed", {
        description: `Payout ${target.reference} → failed`,
      });
    }
  };

  const runPayoutAction = async (p: Payout, action: "mark_processing" | "cancel") => {
    const ok = await runMutation({
      method: "POST",
      path: `/admin/payouts/${p.id}/action`,
      body: { action },
    });
    if (ok) {
      toast.success("Payout updated", { description: `Payout ${p.reference} → ${action}` });
    }
  };

  /* reports */
  const submitResolve = async () => {
    const target = resolveTarget;
    if (!target) return;
    setResolveSubmitting(true);
    const note = resolveNote.trim();
    const ok = await runMutation({
      method: "POST",
      path: `/admin/reports/${target.report.id}/resolve?outcome=${target.outcome}${
        note ? `&note=${encodeURIComponent(note)}` : ""
      }`,
    });
    setResolveSubmitting(false);
    if (ok) {
      setResolveTarget(null);
      toast.success("Report handled", { description: `Report #${target.report.id} → ${target.outcome}` });
    }
  };

  /* settings */
  const saveSettings = async (d: Settings) => {
    setSavingSettings(true);
    const ok = await runMutation<Settings>({
      method: "PUT",
      path: "/admin/settings",
      body: {
        commission_bps: d.commission_bps,
        min_payout_minor: d.min_payout_minor,
        moderation: d.moderation,
      },
    });
    setSavingSettings(false);
    if (ok) toast.success("Settings saved");
  };

  /* --------------------------------------------------------- render */

  if (!checked) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-8 w-56" />
        <Skeleton className="mt-3 hidden h-4 w-96 sm:block" />
        <div className="mt-10">
          <StatSkeleton />
        </div>
      </div>
    );
  }

  if (!token || role !== "admin") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader eyebrow="platform" title="Admin" description="Admin-only console." />
        <div className="rounded-2xl border border-dashed border-border px-8 py-12 text-center">
          <p className="font-medium">Access denied</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account ({role || "unknown role"}) is not an admin. This console is for platform
            operators only.
          </p>
          <Button variant="outline" className="mt-5" render={<Link href="/marketplace" />}>
            Back to marketplace
          </Button>
        </div>
      </div>
    );
  }

  const stats = statsQ.data;
  const agents = agentsQ.data;
  const orders = ordersQ.data;
  const payouts = payoutsQ.data;
  const reports = reportsQ.data;
  const audit = auditQ.data;
  const settings = settingsQ.data;
  const openReports = (reports ?? []).filter((r) => r.status === "open");
  const resolvedReports = (reports ?? []).filter((r) => r.status !== "open");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="platform operators"
        title="Admin console"
        description="Moderation, orders, refunds, payouts and platform policy — one control surface."
      >
        {stats?.payments_enabled ? (
          <Badge variant="secondary" className="font-mono text-[11px]">
            payments: {stats.payment_mode || "enabled"}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-mono text-[11px]">
            payments disabled (no gateway keys)
          </Badge>
        )}
      </PageHeader>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab((v ?? "overview") as TabKey)}
      >
        <TabsList className="mb-8 flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.v} value={t.v}>
              <t.icon className="size-3.5" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ------------------------------------------------ overview */}
        <TabsContent value="overview">
          {statsQ.error ? (
            <ErrorPanel message={statsQ.error} onRetry={statsQ.reload} />
          ) : stats ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="gross volume"
                value={formatMoney(stats.gross_volume_minor, stats.currency)}
                hint={`${stats.total_paid_purchases} paid orders`}
              />
              <StatCard
                label="platform revenue"
                value={formatMoney(stats.platform_revenue_minor, stats.currency)}
                hint="fees from splits"
              />
              <StatCard
                label="refunded"
                value={formatMoney(stats.refunded_minor, stats.currency)}
                hint="paid back to buyers"
              />
              <StatCard
                label="users"
                value={stats.total_users}
                hint={`${stats.published_agents}/${stats.total_agents} agents published`}
              />
              {/* attention strip — spans the grid below the stat cards */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card ring-1 ring-foreground/10 px-4 py-3 sm:col-span-2 lg:col-span-4">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={
                      stats.pending_review > 0
                        ? "flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
                        : "flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                    }
                  >
                    {stats.pending_review > 0 ? (
                      <TriangleAlertIcon className="size-4" />
                    ) : (
                      <CircleCheckIcon className="size-4" />
                    )}
                  </span>
                  <p className="text-sm">
                    {stats.pending_review > 0 ? (
                      <>
                        <span className="font-medium">{stats.pending_review}</span>{" "}
                        <span className="text-muted-foreground">
                          listing{stats.pending_review === 1 ? "" : "s"} waiting for review
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Moderation queue is clear.</span>
                    )}
                  </p>
                </div>
                {stats.pending_review > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setTab("moderation")}>
                    Open moderation queue
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <StatSkeleton />
          )}
        </TabsContent>

        {/* --------------------------------------------- moderation */}
        <TabsContent value="moderation">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search listings by name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search listings by name"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "")}>
              <SelectTrigger className="w-44" aria-label="Status filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">all statuses</SelectItem>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="ml-auto text-xs text-muted-foreground">
              {agents
                ? `${agents.length} listing${agents.length === 1 ? "" : "s"}`
                : statusFilter || search
                  ? "matching current filter"
                  : ""}
            </p>
          </div>

          {agentsQ.error ? (
            <ErrorPanel message={agentsQ.error} onRetry={agentsQ.reload} />
          ) : agents && agents.length === 0 ? (
            <EmptyState
              icon="🛡"
              title={statusFilter || search ? "No listings match" : "Nothing to moderate"}
              hint={
                statusFilter || search
                  ? "Try a different status or clear the search."
                  : "New submissions land here when marketplace moderation is set to manual."
              }
              actionLabel={statusFilter || search ? "Clear filters" : undefined}
              onAction={
                statusFilter || search
                  ? () => {
                      setStatusFilter("");
                      setSearchInput("");
                      setSearch("");
                    }
                  : undefined
              }
            />
          ) : agents ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(agents ?? []).map((a) => {
                  /* the same visibility rule as before: every action except the
                     one matching the current status; feature toggles always on */
                  const primary: AgentActionValue[] =
                    a.status === "pending_review"
                      ? ["approved", "rejected"]
                      : a.status === "published"
                        ? ["suspended"]
                        : a.status === "rejected" || a.status === "suspended"
                          ? ["approved"]
                          : [];
                  const rest = AGENT_ACTIONS.filter(
                    (act) => act.action !== a.status && !primary.includes(act.action)
                  );
                  const visibilityMenu = rest.filter((act) =>
                    VISIBILITY_AGENT_ACTIONS.has(act.action)
                  );
                  const moderationMenu = rest.filter(
                    (act) =>
                      !DESTRUCTIVE_AGENT_ACTIONS.has(act.action) &&
                      !VISIBILITY_AGENT_ACTIONS.has(act.action)
                  );
                  const restrictedMenu = rest.filter((act) =>
                    DESTRUCTIVE_AGENT_ACTIONS.has(act.action)
                  );
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="min-w-0 max-w-[22rem]">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span className="truncate">{a.name}</span>
                          {a.is_featured && (
                            <StarIcon
                              aria-label="Featured"
                              className="size-3.5 shrink-0 text-warning"
                            />
                          )}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          id {a.id} · {a.sales_count} sales
                        </p>
                        {a.moderation_note && (
                          <p className="truncate text-[11px] text-muted-foreground" title={a.moderation_note}>
                            note: {a.moderation_note}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="block truncate text-xs">{a.owner_email || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">
                          {a.pricing_model}
                          {a.amount_minor > 0 ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {formatMoney(a.amount_minor, a.currency)}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <AgentStatusBadge status={a.status} />
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{fmtDate(a.updated_at)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          {primary.map((act) => {
                            const meta = AGENT_ACTIONS.find((x) => x.action === act)!;
                            return (
                              <Button
                                key={act}
                                size="xs"
                                variant={act === "approved" ? "default" : "outline"}
                                onClick={() => requestAgentAction(a, act)}
                              >
                                {meta.label}
                              </Button>
                            );
                          })}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Actions for ${a.name}`}
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end" className="w-60">
                              <DropdownMenuLabel>Moderation</DropdownMenuLabel>
                              <DropdownMenuGroup>
                                {moderationMenu.map((act) => (
                                  <DropdownMenuItem
                                    key={act.action}
                                    onClick={() => requestAgentAction(a, act.action)}
                                  >
                                    {act.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>Visibility</DropdownMenuLabel>
                              <DropdownMenuGroup>
                                {visibilityMenu.map((act) => (
                                  <DropdownMenuItem
                                    key={act.action}
                                    onClick={() => requestAgentAction(a, act.action)}
                                  >
                                    {act.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuGroup>
                              {restrictedMenu.length > 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    {restrictedMenu.map((act) => (
                                      <DropdownMenuItem
                                        key={act.action}
                                        variant="destructive"
                                        onClick={() => requestAgentAction(a, act.action)}
                                      >
                                        {act.label}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuGroup>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {a.slug && (
                            <Button variant="ghost" size="xs" render={<Link href={`/agents/${a.slug}`} />}>
                              <ExternalLinkIcon className="size-3" /> View
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <ListSkeleton rows={5} />
          )}
        </TabsContent>

        {/* -------------------------------------------------- orders */}
        <TabsContent value="orders">
          {ordersQ.error ? (
            <ErrorPanel message={ordersQ.error} onRetry={ordersQ.reload} />
          ) : orders && orders.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="No orders yet"
              hint="Paid purchases appear here as they flow through checkout."
            />
          ) : orders ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="max-w-[20rem]">
                      <p className="truncate font-mono text-xs font-medium" title={o.reference}>
                        {o.reference}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {o.buyer_email || "—"} → {o.agent_name || "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{o.pricing_model}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-xs">{formatMoney(o.amount_minor, o.currency)}</span>
                      <p className="text-[11px] text-muted-foreground">
                        fee {formatMoney(o.platform_fee_minor, o.currency)} · creator{" "}
                        {formatMoney(o.creator_earnings_minor, o.currency)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <OrderStatusBadge status={o.status} />
                        {o.refunded_minor > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            refunded {formatMoney(o.refunded_minor, o.currency)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(o.paid_at || o.created_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {(o.status === "paid" || o.status === "partially_refunded") && (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              setRefundType("refund");
                              setRefundAmount(String(o.amount_minor - (o.refunded_minor || 0)));
                              setRefundReason("");
                              setRefundAmountError("");
                              setRefundTarget(o);
                            }}
                          >
                            Refund
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ListSkeleton rows={7} />
          )}
        </TabsContent>

        {/* ------------------------------------------------- payouts */}
        <TabsContent value="payouts">
          <p className="mb-4 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Payouts remain “requested” until completed with provider evidence. RazorpayX processes
            them automatically when configured; otherwise use mark_paid only with a real transfer
            reference.
          </p>
          {payoutsQ.error ? (
            <ErrorPanel message={payoutsQ.error} onRetry={payoutsQ.reload} />
          ) : payouts && payouts.length === 0 ? (
            <EmptyState
              icon="💸"
              title="No payouts requested"
              hint="Creator withdrawals land here once your balance clears the minimum payout."
            />
          ) : payouts ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payout</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[18rem]">
                      <p className="truncate font-mono text-xs font-medium" title={p.reference}>
                        {p.reference}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        to {p.creator_email || "—"} · {p.destination || "no destination"}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-xs">{formatMoney(p.amount_minor, p.currency)}</span>
                    </TableCell>
                    <TableCell>
                      <PayoutStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{fmtDate(p.requested_at)}</span>
                      {p.processed_at && (
                        <p className="text-[11px] text-muted-foreground">
                          processed {fmtDate(p.processed_at)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      {p.provider_payout_id && (
                        <p className="truncate font-mono text-[11px]" title={p.provider_payout_id}>
                          {p.provider_payout_id}
                          {p.provider ? <span className="text-muted-foreground"> · {p.provider}</span> : null}
                        </p>
                      )}
                      {p.failure_reason && (
                        <p className="truncate text-[11px] text-destructive" title={p.failure_reason}>
                          {p.failure_reason}
                        </p>
                      )}
                      {!p.provider_payout_id && !p.failure_reason && (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {p.status === "requested" && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={payoutSubmitting}
                            onClick={() => void runPayoutAction(p, "mark_processing")}
                          >
                            mark processing
                          </Button>
                        )}
                        {(p.status === "requested" || p.status === "processing") && (
                          <>
                            <Button
                              size="xs"
                              disabled={payoutSubmitting}
                              onClick={() => {
                                setPayoutProviderId(p.provider_payout_id || "");
                                setPayoutProviderError("");
                                setPayoutPaidTarget(p);
                              }}
                            >
                              mark paid
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-muted-foreground"
                              disabled={payoutSubmitting}
                              onClick={() => {
                                setPayoutFailNote("");
                                setPayoutFailTarget(p);
                              }}
                            >
                              mark failed
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-muted-foreground"
                              disabled={payoutSubmitting}
                              onClick={() => setPayoutCancelTarget(p)}
                            >
                              cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ListSkeleton rows={5} />
          )}
        </TabsContent>

        {/* ------------------------------------------------- reports */}
        <TabsContent value="reports">
          {reportsQ.error ? (
            <ErrorPanel message={reportsQ.error} onRetry={reportsQ.reload} />
          ) : reports && openReports.length === 0 ? (
            <>
              <EmptyState
                icon="🚩"
                title="No open reports"
                hint="Buyer-submitted reports land here for triage."
              />
              {resolvedReports.length > 0 && (
                <div className="mt-6 space-y-1.5">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">Resolved</h3>
                  {resolvedReports.slice(0, 20).map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                    >
                      #{r.id} · agent {r.agent_id} · {r.reason} · {r.status}
                      {r.resolution_note ? ` · ${r.resolution_note}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : reports ? (
            <div className="space-y-2">
              {openReports.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl bg-warning/5 ring-1 ring-warning/30 px-4 py-3 text-sm"
                >
                  <p className="font-medium">Report #{r.id} · agent {r.agent_id}</p>
                  <p className="mt-1">{r.reason}</p>
                  {r.details && <p className="mt-1 text-xs text-muted-foreground">{r.details}</p>}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {fmtDate(r.created_at)}
                  </p>
                  <div className="mt-2.5 flex gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setResolveNote("");
                        setResolveTarget({ report: r, outcome: "resolved" });
                      }}
                    >
                      Resolve…
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setResolveNote("");
                        setResolveTarget({ report: r, outcome: "dismissed" });
                      }}
                    >
                      Dismiss…
                    </Button>
                  </div>
                </div>
              ))}
              {resolvedReports.length > 0 && (
                <div className="space-y-1.5 pt-4">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">Resolved</h3>
                  {resolvedReports.slice(0, 20).map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                    >
                      #{r.id} · agent {r.agent_id} · {r.reason} · {r.status}
                      {r.resolution_note ? ` · ${r.resolution_note}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <ListSkeleton rows={4} />
          )}
        </TabsContent>

        {/* ------------------------------------------------ settings */}
        <TabsContent value="settings">
          {settingsQ.error ? (
            <ErrorPanel message={settingsQ.error} onRetry={settingsQ.reload} />
          ) : settings ? (
            <SettingsEditor
              settings={settings}
              saving={savingSettings}
              onSave={(d) => void saveSettings(d)}
            />
          ) : (
            <ListSkeleton rows={4} />
          )}
        </TabsContent>

        {/* --------------------------------------------------- audit */}
        <TabsContent value="audit">
          {auditQ.error ? (
            <ErrorPanel message={auditQ.error} onRetry={auditQ.reload} />
          ) : audit && audit.length === 0 ? (
            <EmptyState
              icon="📜"
              title="No audit entries"
              hint="Every operator action lands here with actor, entity and details."
            />
          ) : audit ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((e) => {
                  const details = e.details ? JSON.stringify(e.details) : "";
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(e.created_at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {e.action ? (
                          <Badge
                            variant="secondary"
                            className="max-w-[220px] font-mono text-[11px]"
                            title={e.action}
                          >
                            <span className="truncate">{e.action}</span>
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">
                          {e.actor_id != null ? `#${e.actor_id}` : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {e.entity_type ? `${e.entity_type}#${e.entity_id ?? ""}` : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[24rem]">
                        {details ? (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground" title={details}>
                            {details}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <ListSkeleton rows={6} />
          )}
        </TabsContent>
      </Tabs>

      {/* ============================================== refund dialog */}
      <Dialog
        open={Boolean(refundTarget)}
        onOpenChange={(open) => {
          if (!open) setRefundTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Refund order {refundTarget?.reference}</DialogTitle>
            <DialogDescription>
              {refundTarget && (
                <>
                  {refundTarget.buyer_email || "buyer"} · {refundTarget.agent_name} ·{" "}
                  {formatMoney(refundTarget.amount_minor, refundTarget.currency)} charged
                  {refundTarget.refunded_minor > 0
                    ? `, ${formatMoney(refundTarget.refunded_minor, refundTarget.currency)} already refunded`
                    : ""}
                  .
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="refund-type" className="mb-1">
                Type
              </Label>
              <Select
                value={refundType}
                onValueChange={(v) => setRefundType((v ?? "refund") as "refund" | "chargeback")}
              >
                <SelectTrigger id="refund-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="refund">Refund</SelectItem>
                  <SelectItem value="chargeback">Chargeback</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Recorded in the dispute trail and audit.</p>
            </div>
            <div>
              <Label htmlFor="refund-amount" className="mb-1">
                Amount (minor units)
              </Label>
              <Input
                id="refund-amount"
                type="number"
                min={0}
                value={refundAmount}
                aria-invalid={Boolean(refundAmountError)}
                onChange={(e) => {
                  setRefundAmount(e.target.value);
                  setRefundAmountError("");
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                in paise (₹ amounts × 100) — e.g. ₹1,999.00 = 199900. Clear the field to refund the
                full remainder ({formatMoney(
                  refundTarget ? refundTarget.amount_minor - (refundTarget.refunded_minor || 0) : 0,
                  refundTarget?.currency
                )}{" "}
                remaining).
              </p>
              {refundAmountError && <p className="mt-1 text-xs text-destructive">{refundAmountError}</p>}
            </div>
            <div>
              <Label htmlFor="refund-reason" className="mb-1">
                Reason
              </Label>
              <Textarea
                id="refund-reason"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Recorded in the audit log and shown to ops…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitRefund()} disabled={refundSubmitting}>
              {refundSubmitting ? "Refunding…" : "Issue refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================== payout mark_paid dialog (provider evidence) */}
      <Dialog
        open={Boolean(payoutPaidTarget)}
        onOpenChange={(open) => {
          if (!open) setPayoutPaidTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark payout {payoutPaidTarget?.reference} as paid</DialogTitle>
            <DialogDescription>
              A payout is never confirmed without provider evidence — the backend rejects mark_paid
              without a provider reference.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="payout-provider-id" className="mb-1">
              Provider payout reference
            </Label>
            <Input
              id="payout-provider-id"
              className="font-mono"
              value={payoutProviderId}
              aria-invalid={Boolean(payoutProviderError)}
              onChange={(e) => {
                setPayoutProviderId(e.target.value);
                setPayoutProviderError("");
              }}
              placeholder="e.g. razorpayx payout id or bank reference"
            />
            {payoutProviderError && (
              <p className="mt-1 text-xs text-destructive">{payoutProviderError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutPaidTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitPayoutPaid()} disabled={payoutSubmitting}>
              {payoutSubmitting ? "Working…" : "Mark paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================== payout mark_failed dialog (reason → note) */}
      <Dialog
        open={Boolean(payoutFailTarget)}
        onOpenChange={(open) => {
          if (!open) setPayoutFailTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark payout {payoutFailTarget?.reference} as failed</DialogTitle>
            <DialogDescription>
              The reason is stored on the payout (failure_reason) and visible to the creator.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="payout-fail-note" className="mb-1">
              Failure reason
            </Label>
            <Textarea
              id="payout-fail-note"
              value={payoutFailNote}
              onChange={(e) => setPayoutFailNote(e.target.value)}
              placeholder="e.g. Beneficiary account name mismatch at the bank…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutFailTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitPayoutFail()}
              disabled={payoutSubmitting}
            >
              {payoutSubmitting ? "Working…" : "Mark failed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================= payout cancel confirm (AlertDialog) */}
      <AlertDialog
        open={Boolean(payoutCancelTarget)}
        onOpenChange={(open) => {
          if (!open) setPayoutCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel payout {payoutCancelTarget?.reference}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The payout is marked cancelled. Only cancel when no money has left the platform —
              withdrawn transfers should be marked paid or failed instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPayoutCancelTarget(null)}>
              Keep payout
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={payoutSubmitting}
              onClick={() => {
                const target = payoutCancelTarget;
                setPayoutCancelTarget(null);
                if (target) void runPayoutAction(target, "cancel");
              }}
            >
              Cancel payout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ==================================== agent moderation destructive confirm */}
      <AlertDialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction ? CONFIRM_COPY[confirmAction.action]?.title : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && (
                <>
                  <span className="font-medium text-foreground">{confirmAction.agent.name}</span> (#
                  {confirmAction.agent.id}) — {CONFIRM_COPY[confirmAction.action]?.body} This is
                  recorded in the audit log under your account.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAction(null)}>Never mind</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmAction;
                setConfirmAction(null);
                if (target) void applyAgentAction(target.agent, target.action);
              }}
            >
              {confirmAction
                ? AGENT_ACTIONS.find((a) => a.action === confirmAction.action)?.label ?? "Confirm"
                : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ==================================================== report resolve dialog */}
      <Dialog
        open={Boolean(resolveTarget)}
        onOpenChange={(open) => {
          if (!open) setResolveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve report #{resolveTarget?.report.id}</DialogTitle>
            <DialogDescription>
              {resolveTarget && (
                <>Agent {resolveTarget.report.agent_id} — “{resolveTarget.report.reason}”</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="resolve-outcome" className="mb-1">
                Outcome
              </Label>
              <Select
                value={resolveTarget?.outcome ?? "resolved"}
                onValueChange={(v) =>
                  setResolveTarget((t) =>
                    t ? { ...t, outcome: (v ?? "resolved") as "resolved" | "dismissed" } : t
                  )
                }
              >
                <SelectTrigger id="resolve-outcome" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">resolved — actioned on the listing</SelectItem>
                  <SelectItem value="dismissed">dismissed — no action needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="resolve-note" className="mb-1">
                Resolution note
              </Label>
              <Textarea
                id="resolve-note"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="Optional — stored on the report for the audit trail."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitResolve()} disabled={resolveSubmitting}>
              {resolveSubmitting ? "Saving…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
