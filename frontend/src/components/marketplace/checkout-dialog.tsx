"use client";

/**
 * Real-money checkout flow (Razorpay).
 *
 * Server rules mirrored here:
 *  - "success" from the gateway callback is NEVER treated as access — the
 *    backend /checkouts/verify call (HMAC + provider check) grants access.
 *  - Free agents are claimed without any gateway call.
 *  - When the deployment has no gateway keys the intent call returns 503 with
 *    an explanatory message; we surface it verbatim instead of faking a
 *    transaction.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { API_BASE } from "@/lib/api";
import { formatMoney, pricingLabel, planDescriptor } from "@/lib/money";

/* --- Razorpay checkout.js typing (script is loaded from the CDN) ----------- */

type PaymentPayload = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature?: string;
};

type RazorpayOptions = {
  key: string;
  name: string;
  description: string;
  amount?: number;
  currency?: string;
  order_id?: string;
  subscription_id?: string;
  handler?: (payload: PaymentPayload) => void;
  prefill?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = {
  open(): void;
  on(event: string, callback: () => void): void;
};

type WindowWithRazorpay = Window & {
  Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
};

/* --- API shapes ------------------------------------------------------------ */

interface Plan {
  model: string;
  currency: string;
  amount_minor: number;
  billing_interval?: string | null;
  runs_per_pack?: number | null;
}

interface IntentResponse {
  mode: string;
  provider?: string | null;
  provider_mode?: string | null;
  order_id?: string | null;
  razorpay_key_id?: string | null;
  purchase_reference?: string | null;
  agent_slug?: string | null;
  name?: string | null;
  pricing?: Plan | null;
  message?: string | null;
}

interface VerifyResponse {
  status: string;
  message?: string | null;
  purchase_reference?: string | null;
  agent_slug?: string | null;
  redirect_to?: string | null;
}

function loadRazorpayScript(): Promise<boolean> {
  // Only trusted from Razorpay's own CDN; loaded once.
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && (window as WindowWithRazorpay).Razorpay) {
      resolve(true);
      return;
    }
    const existing = document.querySelector('script[src$="checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function CheckoutDialog({
  agentId,
  agentName,
  pricing,
  token,
  onOpenChange,
  onSuccess,
}: {
  agentId: number;
  agentName: string;
  pricing?: Plan | null;
  token: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ message: string; access: boolean } | null>(null);
  const [providerMode, setProviderMode] = useState<string | null>(null);

  // The parent mounts this component when checkout is requested, so
  // "mounted" ⇒ "open"; `onOpenChange(false)` from the parent closes it too.
  const [open, setOpen] = useState(true);
  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    onOpenChange(value);
  };

  const isPaid = Boolean(pricing && pricing.model !== "free" && Number(pricing.amount_minor) > 0);

  /** Surface a hard failure inline (alert slot) and as a toast. */
  const complain = (message: string) => {
    setError(message);
    toast.error(message);
  };

  /** Surface an access verdict inline; toasts reflect the actual state only. */
  const announce = (message: string, access: boolean) => {
    setResult({ message, access });
    if (access) toast.success(message);
    else toast.info(message);
  };

  /** Server-side, twice-over verification of the gateway callback. */
  const verify = async (
    purchaseReference: string,
    payload: PaymentPayload
  ) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/checkouts/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          purchase_reference: purchaseReference,
          razorpay_order_id: payload.razorpay_order_id ?? payload.razorpay_subscription_id,
          razorpay_payment_id: payload.razorpay_payment_id,
          razorpay_signature: payload.razorpay_signature,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as VerifyResponse & { detail?: string };
      if (!res.ok) {
        complain(String(data.detail || data.message || "Payment verification failed."));
        return;
      }
      if (data.status === "paid" || data.status === "already_paid") {
        announce(data.message || "Payment verified — access granted.", true);
        onSuccess?.();
      } else if (data.status === "pending") {
        announce(
          data.message ||
            "Payment accepted. Access activates as soon as the provider confirms it (usually seconds).",
          false
        );
      } else {
        complain(data.message || "Payment was not completed. No access was granted.");
      }
    } catch (e) {
      complain(`Verification error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startCheckout = async () => {
    setBusy(true);
    setError("");
    setResult(null);

    if (!token) {
      setBusy(false);
      complain("You need to be signed in to get access.");
      return;
    }

    let intent: IntentResponse;
    try {
      const res = await fetch(`${API_BASE}/checkouts/intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setBusy(false);
        complain(String(err.detail || `Checkout could not start (HTTP ${res.status}).`));
        return;
      }
      intent = (await res.json()) as IntentResponse;
    } catch (e) {
      setBusy(false);
      complain(`Network error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setProviderMode(intent.provider_mode ?? null);

    // Free claim → entitlement already granted server-side.
    if (intent.mode === "free") {
      announce(intent.message || "Access granted.", true);
      setBusy(false);
      onSuccess?.();
      return;
    }
    // One-time already owned / already subscribed.
    if (intent.mode === "already_owned") {
      announce(intent.message || "You already have access.", true);
      setBusy(false);
      onSuccess?.();
      return;
    }
    // Gateway never returned key/order — never fake a transaction.
    if (!intent.razorpay_key_id || !intent.order_id || !intent.purchase_reference) {
      setBusy(false);
      complain(
        intent.message ||
          "Payment gateway returned an incomplete checkout session. No payment was taken."
      );
      return;
    }

    const scriptLoaded = await loadRazorpayScript();
    if (!scriptLoaded) {
      setBusy(false);
      complain("Could not load the Razorpay checkout script. Check your network/ad-blocker.");
      return;
    }

    const purchaseReference = intent.purchase_reference;
    const plan = intent.pricing ?? pricing;
    const Razorpay = (window as WindowWithRazorpay).Razorpay;
    if (!Razorpay) {
      setBusy(false);
      complain("Razorpay is not available in this browser.");
      return;
    }
    // The callback signature is verified server-side; never trusted here.
    const rzp = new Razorpay({
      key: intent.razorpay_key_id,
      name: "AI Agent Space",
      description: agentName,
      amount: plan?.amount_minor ?? undefined,
      currency: plan?.currency ?? "INR",
      ...(intent.mode === "subscription"
        ? { subscription_id: intent.order_id as string }
        : { order_id: intent.order_id as string }),
      handler: (payload) => {
        void verify(purchaseReference, payload);
      },
      prefill: {},
      theme: { color: "#18181b" },
      modal: { ondismiss: () => setBusy(false) },
    });
    rzp.on("payment.failed", () => {
      setBusy(false);
      complain("The payment failed or was declined. No access was granted.");
    });
    setBusy(false);
    rzp.open();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isPaid ? "Buy" : "Get access"} · {agentName}
          </DialogTitle>
          <DialogDescription>
            {isPaid
              ? "Payments run through Razorpay and are verified on our servers before access is granted."
              : "Claimed straight on the platform — no gateway involved."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* price block — same look as the landing-page pricing card */}
          {pricing && (
            <div className="rounded-xl bg-muted/60 px-4 py-3 ring-1 ring-foreground/10">
              <p className="text-3xl font-medium tracking-tight">
                {pricing.model === "free" ? "Free" : pricingLabel(pricing)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{planDescriptor(pricing)}</p>
            </div>
          )}
          {isPaid && pricing && (
            <p className="font-mono text-[10px] text-muted-foreground">
              amount charged: {formatMoney(pricing.amount_minor, pricing.currency)} ·{" "}
              {planDescriptor(pricing).toLowerCase()}
            </p>
          )}

          {/* status-driven verdicts */}
          {result && (result.access ? (
            <Alert className="border-success/30 bg-success/10 [&>svg]:text-success">
              <CheckCircle2Icon />
              <AlertTitle>{result.message}</AlertTitle>
              <AlertDescription>
                Access is active — open the console to use the agent.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-warning/30 bg-warning/10 [&>svg]:text-warning">
              <TriangleAlertIcon />
              <AlertTitle>{result.message}</AlertTitle>
              <AlertDescription>
                Refresh this page in a few seconds to see the status change.
              </AlertDescription>
            </Alert>
          ))}
          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Checkout problem</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {providerMode === "test" && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                TEST MODE
              </Badge>
              Live keys are not configured — checkout runs in the provider sandbox. No real charges.
            </p>
          )}
          {isPaid && (
            <p className="text-xs text-muted-foreground">
              Access is granted only after the backend verifies the payment signature and amount
              with the provider. Nothing here is simulated.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {result?.access ? "Close" : "Cancel"}
          </Button>
          {result?.access ? (
            <Button
              onClick={() => {
                handleOpenChange(false);
                router.push(`/agents/${agentId}`);
              }}
            >
              Open console
            </Button>
          ) : (
            <Button onClick={startCheckout} disabled={busy || Boolean(error)}>
              {busy ? (
                <>
                  <Loader2Icon className="animate-spin" /> Preparing…
                </>
              ) : isPaid ? (
                "Continue to payment"
              ) : (
                "Claim access"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
