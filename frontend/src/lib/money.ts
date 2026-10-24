/**
 * Money formatting — all amounts arrive as integer minor units (paise) with an
 * ISO currency code. Never float around money in the UI.
 */

const SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

export function currencySymbol(currency: string): string {
  return SYMBOLS[(currency || "INR").toUpperCase()] ?? `${currency} `;
}

/** 199900 + "INR" → "₹1,999.00" (or "₹1,999" for whole minor-zero paise) */
export function formatMoney(amountMinor: number | null | undefined, currency?: string | null): string {
  const minor = Number(amountMinor ?? 0);
  const cur = (currency || "INR").toUpperCase();
  const value = minor / 100;
  const formatted = value.toLocaleString("en-IN", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currencySymbol(cur)}${formatted}`;
}

export interface SimplePlan {
  model?: string;
  currency?: string | null;
  amount_minor?: number | null;
  billing_interval?: string | null;
  runs_per_pack?: number | null;
}

/** Human label of a pricing plan: "Free" / "₹499 one-time" / "₹99/mo" / "₹199 · 100 runs" */
export function pricingLabel(plan?: SimplePlan | null): string {
  if (!plan || !plan.model || plan.model === "free" || !plan.amount_minor) return "Free";
  const amount = formatMoney(plan.amount_minor, plan.currency);
  switch (plan.model) {
    case "one_time":
      return `${amount} one-time`;
    case "subscription":
      return plan.billing_interval === "year" ? `${amount}/yr` : `${amount}/mo`;
    case "pay_per_execution":
      return plan.runs_per_pack ? `${amount} · ${plan.runs_per_pack} runs` : `${amount} pack`;
    default:
      return amount;
  }
}

export function planDescriptor(plan?: SimplePlan | null): string {
  if (!plan || !plan.model || plan.model === "free" || !plan.amount_minor) {
    return "Free to use";
  }
  switch (plan.model) {
    case "one_time":
      return `One-time purchase — yours forever`;
    case "subscription":
      return plan.billing_interval === "year"
        ? "Subscription billed every year"
        : "Subscription billed every month";
    case "pay_per_execution":
      return plan.runs_per_pack
        ? `Prepaid pack of ${plan.runs_per_pack} runs (unspent runs are auto-refunded)`
        : "Prepaid run pack";
    default:
      return "Paid plan";
  }
}
