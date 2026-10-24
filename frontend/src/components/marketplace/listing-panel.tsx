"use client";

/**
 * Creator-side panel for one agent: listing content, pricing plan and
 * publish lifecycle. Used inside AgentBuilder when editing an existing agent
 * (the agent must exist before it can be listed).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/api";
import { formatMoney, pricingLabel } from "@/lib/money";

interface AgentListingState {
  id: number;
  name: string;
  description?: string | null;
  tagline?: string | null;
  slug?: string | null;
  status: string;
  is_public: boolean;
  is_published: boolean;
  category_id?: number | null;
  tags: string[];
  problem_statement?: string | null;
  target_audience?: string | null;
  usage_instructions?: string | null;
  refund_window_days?: number | null;
}

interface Plan {
  id: number;
  model: string;
  currency: string;
  amount_minor: number;
  billing_interval?: string | null;
  runs_per_pack?: number | null;
  is_active: boolean;
}

interface Category {
  id: number;
  slug: string;
  name: string;
}

const STATUS_HINT: Record<string, string> = {
  draft: "Private — only you can run it.",
  pending_review: "Queued for moderation. Buyers can't see it yet.",
  published: "Live on the marketplace.",
  rejected: "Moderation rejected it — see the note from our team.",
  suspended: "Suspended — hidden from the marketplace.",
};

const MODELS = [
  { value: "free", label: "Free" },
  { value: "one_time", label: "One-time purchase" },
  { value: "subscription", label: "Subscription" },
  { value: "pay_per_execution", label: "Prepaid run pack" },
];

export default function ListingPanel({ agentId }: { agentId: number }) {
  const [state, setState] = useState<AgentListingState | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // pricing form
  const [planModel, setPlanModel] = useState("free");
  const [planAmount, setPlanAmount] = useState("");
  const [planInterval, setPlanInterval] = useState("month");
  const [planRuns, setPlanRuns] = useState("");
  const [planCurrency, setPlanCurrency] = useState("INR");
  // listing form
  const [tagsText, setTagsText] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || !agentId) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_BASE}/agents/${agentId}`, { headers }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/creator/agents/${agentId}/pricing`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([agent, plans]: [AgentListingState | null, Plan[]]) => {
        if (agent) {
          setState(agent);
          setTagsText((agent.tags || []).join(", "));
        }
        const active = plans.find((p: Plan) => p.is_active) ?? plans[0];
        if (active) {
          setPlan(active);
          setPlanModel(active.model);
          setPlanAmount(active.amount_minor ? String(active.amount_minor / 100) : "");
          setPlanInterval(active.billing_interval || "month");
          setPlanRuns(active.runs_per_pack ? String(active.runs_per_pack) : "");
        }
      })
      .catch(() => setMsg("Could not load listing details"));
    fetch(`${API_BASE}/marketplace/categories`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategories)
      .catch(() => {});
  }, [agentId]);

  const flipPublish = async (publish: boolean) => {
    if (!state) return;
    setBusy(true);
    setMsg("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/marketplace/agents/${agentId}/${publish ? "publish" : "unpublish"}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({ ...state, status: data.status, is_published: data.status === "published" });
        setMsg(publish && data.status === "pending_review" ? "Submitted for review — moderators check it before it goes live." : publish ? "Your agent is live on the marketplace." : "Unlisted — back to draft.");
      } else {
        setMsg(data.detail || "Action failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const saveListing = async () => {
    if (!state) return;
    setBusy(true);
    setMsg("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tagline: state.tagline || null,
          category_id: state.category_id || null,
          tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          problem_statement: state.problem_statement || null,
          target_audience: state.target_audience || null,
          usage_instructions: state.usage_instructions || null,
          refund_window_days: state.refund_window_days ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({ ...state, ...data });
        setMsg("Listing content saved.");
      } else {
        setMsg(data.detail || "Could not save listing");
      }
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async () => {
    setBusy(true);
    setMsg("");
    try {
      const token = localStorage.getItem("token");
      const amount = Math.round(parseFloat(planAmount || "0") * 100);
      const res = await fetch(`${API_BASE}/creator/agents/${agentId}/pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: planModel,
          currency: planCurrency,
          amount_minor: planModel === "free" ? 0 : amount,
          billing_interval: planModel === "subscription" ? planInterval : null,
          runs_per_pack: planModel === "pay_per_execution" ? parseInt(planRuns || "0", 10) || null : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPlan(data);
        setMsg("Pricing updated.");
      } else {
        setMsg(data.detail || "Could not save pricing");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <p className="text-sm text-muted-foreground">loading marketplace panel…</p>;
  }

  const published = state.status === "published" || state.is_published;
  const cur = plan?.currency || planCurrency;

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono text-sm text-muted-foreground uppercase">Marketplace Listing</h3>
        <div className="flex items-center gap-2">
          <Badge
            variant={published ? "default" : state.status === "pending_review" ? "secondary" : "outline"}
            className="font-mono text-[10px]"
          >
            {state.status}
          </Badge>
          {published ? (
            <>
              {state.slug && (
                <Link href={`/agents/${state.slug}`} className="text-xs underline underline-offset-2 hover:text-foreground">
                  view listing
                </Link>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => flipPublish(false)}>
                Unlist
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => flipPublish(true)}>
              {state.status === "pending_review" ? "Pending review…" : "Publish…"}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{STATUS_HINT[state.status] || ""}</p>

      {/* Listing content */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Tagline (one crisp selling sentence)"
          value={state.tagline || ""}
          onChange={(e) => setState({ ...state, tagline: e.target.value })}
        />
        <select
          className="rounded-md border border-input bg-transparent px-2 py-2 text-sm"
          value={state.category_id ?? ""}
          onChange={(e) => setState({ ...state, category_id: e.target.value ? Number(e.target.value) : null })}
          aria-label="Category"
        >
          <option value="">Category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <Input
          placeholder="Tags (comma separated)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
        <Input
          type="number"
          min={0}
          max={365}
          placeholder="Refund window (days)"
          value={state.refund_window_days ?? ""}
          onChange={(e) => setState({ ...state, refund_window_days: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Input
          className="sm:col-span-2"
          placeholder="Who is this for? (target audience)"
          value={state.target_audience || ""}
          onChange={(e) => setState({ ...state, target_audience: e.target.value })}
        />
        <Textarea
          className="sm:col-span-2"
          rows={2}
          placeholder="The problem it solves (shown on the listing page)"
          value={state.problem_statement || ""}
          onChange={(e) => setState({ ...state, problem_statement: e.target.value })}
        />
        <Textarea
          className="sm:col-span-2"
          rows={2}
          placeholder="Usage instructions (how buyers should start)"
          value={state.usage_instructions || ""}
          onChange={(e) => setState({ ...state, usage_instructions: e.target.value })}
        />
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={saveListing}>
        Save listing content
      </Button>

      {/* Pricing */}
      <div className="border-t pt-3">
        <p className="mb-2 font-mono text-xs text-muted-foreground">
          Current plan: <span className="text-foreground">{plan ? pricingLabel(plan) : "none"}</span>
          {plan && plan.amount_minor > 0 ? ` (${formatMoney(plan.amount_minor, cur)})` : ""}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 py-0 text-sm"
            value={planModel}
            onChange={(e) => setPlanModel(e.target.value)}
            aria-label="Pricing model"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          {planModel !== "free" && (
            <Input
              type="number"
              min={1}
              step="0.01"
              className="w-28"
              placeholder="Unit price"
              value={planAmount}
              onChange={(e) => setPlanAmount(e.target.value)}
            />
          )}
          {planModel !== "free" && (
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 py-0 text-sm"
              value={planCurrency}
              onChange={(e) => setPlanCurrency(e.target.value)}
              aria-label="Currency"
            >
              <option value="INR">INR ₹</option>
              <option value="USD">USD $</option>
              <option value="EUR">EUR €</option>
              <option value="GBP">GBP £</option>
            </select>
          )}
          {planModel === "subscription" && (
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 py-0 text-sm"
              value={planInterval}
              onChange={(e) => setPlanInterval(e.target.value)}
            >
              <option value="month">/mo</option>
              <option value="year">/yr</option>
            </select>
          )}
          {planModel === "pay_per_execution" && (
            <Input
              type="number"
              min={1}
              className="w-24"
              placeholder="runs"
              value={planRuns}
              onChange={(e) => setPlanRuns(e.target.value)}
            />
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={savePlan}>
            Save pricing
          </Button>
        </div>
        {planModel !== "free" && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            You earn the order minus platform commission, credited to your ledger at payment time.{" "}
            Failed pack runs are auto-refunded to buyers.
          </p>
        )}
      </div>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
