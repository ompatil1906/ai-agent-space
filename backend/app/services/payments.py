"""Razorpay payment gateway adapter.

Design rules enforced here:
* Every payment-success signal is verified server-side (HMAC signatures and,
  when configured, a second confirmation against the Razorpay REST API).
* The frontend NEVER receives secret keys.
* Sandbox ("test" mode) and production ("live" mode) are explicit config, and
  the mode is always surfaced to the client so nobody can mistake test
  payments for real revenue.
* All provider calls go through httpx basic auth (key_id / key_secret).
  No new dependencies required.
"""
import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RAZORPAY_API_BASE = "https://api.razorpay.com/v1"


class PaymentConfigError(Exception):
    """Raised when the payment provider is not configured for a required action."""


class PaymentProviderError(Exception):
    """Raised when the provider rejects/errs on an operation."""


def payments_enabled() -> bool:
    """True when a real provider is configured. When False, checkout only
    processes free agents and every paid action returns a clear error."""
    if (settings.PAYMENT_PROVIDER or "none").lower() == "none":
        return False
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)


def payment_mode() -> str:
    """'test' or 'live' — surfaced to the client so test mode is never mistaken
    for production revenue."""
    return settings.RAZORPAY_MODE if settings.RAZORPAY_MODE in ("test", "live") else "test"


def platform_currency() -> str:
    return (settings.PLATFORM_CURRENCY or "INR").upper()


def platform_commission_bps(db=None) -> int:
    """Commission in basis points, admin-overridable at runtime."""
    if db is None:
        return int(settings.PLATFORM_COMMISSION_BPS)
    from app.models import PlatformSetting

    row = db.query(PlatformSetting).filter(PlatformSetting.key == "commission_bps").first()
    try:
        return int(row.value) if row and row.value else int(settings.PLATFORM_COMMISSION_BPS)
    except (TypeError, ValueError):
        return int(settings.PLATFORM_COMMISSION_BPS)


def compute_split(amount_minor: int, commission_bps: int) -> tuple[int, int]:
    """Returns (platform_fee_minor, creator_earnings_minor). Exact integer math."""
    fee = (int(amount_minor) * int(commission_bps)) // 10000
    return fee, int(amount_minor) - fee


class RazorpayClient:
    """Thin httpx client over the Razorpay REST API."""

    def __init__(self, key_id: str, key_secret: str, base_url: str = RAZORPAY_API_BASE, client: Optional[httpx.Client] = None):
        self._key_id = key_id
        self._key_secret = key_secret
        self._base = base_url.rstrip("/")
        self._client = client  # injectable for tests

    def _auth(self) -> tuple[str, str]:
        return (self._key_id, self._key_secret)

    def request(self, method: str, path: str, json_body: Optional[dict] = None, timeout: float = 20.0) -> Dict[str, Any]:
        if self._client is not None:
            return dict(self._client.request(method, path, json_body=json_body).raise_for_status().json())
        url = path if path.startswith("http") else f"{self._base}/{path.lstrip('/')}"
        try:
            resp = httpx.request(
                method,
                url,
                json=json_body,
                auth=self._auth(),
                timeout=timeout,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:  # provider rejected
            detail = None
            try:
                detail = e.response.json().get("error", {}).get("description")
            except Exception:
                pass
            raise PaymentProviderError(
                f"Razorpay returned {e.response.status_code}: {detail or e.response.text[:300]}"
            ) from e
        except httpx.HTTPError as e:
            raise PaymentProviderError(f"Payment provider unreachable: {e}") from e

    # --- Orders / Payments -------------------------------------------------
    def create_order(self, amount_minor: int, currency: str, receipt: str, notes: Optional[dict] = None) -> Dict[str, Any]:
        return self.request(
            "POST",
            "orders",
            {
                "amount": int(amount_minor),
                "currency": currency,
                "receipt": receipt[:40],
                "notes": notes or {},
            },
        )

    def fetch_order(self, order_id: str) -> Dict[str, Any]:
        return self.request("GET", f"orders/{order_id}")

    def fetch_payment(self, payment_id: str) -> Dict[str, Any]:
        return self.request("GET", f"payments/{payment_id}")

    def create_refund(self, payment_id: str, amount_minor: Optional[int] = None, notes: Optional[dict] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"notes": notes or {}}
        if amount_minor is not None:
            body["amount"] = int(amount_minor)
        return self.request("POST", f"payments/{payment_id}/refund", body)

    # --- Subscriptions ------------------------------------------------------
    def create_plan(self, period: str, interval: int, item_name: str, amount_minor: int, currency: str) -> Dict[str, Any]:
        return self.request(
            "POST",
            "plans",
            {
                "period": period,  # monthly | yearly
                "interval": int(interval),
                "item": {"name": item_name[:50], "amount": int(amount_minor), "currency": currency},
            },
        )

    def create_subscription(self, plan_id: str, customer_email: str, total_count: int = 12) -> Dict[str, Any]:
        return self.request(
            "POST",
            "subscriptions",
            {
                "plan_id": plan_id,
                "customer_notify": 1,
                "total_count": total_count,
                "notes": {"customer_email": customer_email},
            },
        )

    def cancel_subscription(self, subscription_id: str, at_cycle_end: bool = True) -> Dict[str, Any]:
        suffix = "cancel_at_period_end" if at_cycle_end else "cancel_now"
        return self.request("POST", f"subscriptions/{subscription_id}/{suffix}")

    # --- RazorpayX payouts (creator disbursements) ---------------------------
    def xpayout_create(
        self,
        account_number: str,
        amount_minor: int,
        currency: str,
        contact_name: str,
        contact_email: str,
        fund_account: Optional[dict] = None,
    ) -> Dict[str, Any]:
        """Create a RazorpayX payout (https://api.razorpay.com/v1/payouts).
        Requires platform RazorpayX credentials + a verified fund account for the creator."""
        payload: Dict[str, Any] = {
            "account_number": account_number,
            "amount": int(amount_minor),
            "currency": currency,
            "mode": "IMPS",
            "purpose": "payout",
            "contact": {
                "name": contact_name,
                "email": contact_email,
                "type": "vendor",
            },
        }
        if fund_account:
            payload["fund_account"] = fund_account
        return self.request("POST", "payouts", payload)


def razorpay_client() -> RazorpayClient:
    if not payments_enabled():
        raise PaymentConfigError("Payment gateway is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing).")
    return RazorpayClient(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)


def razorpayx_client() -> RazorpayClient:
    if not (settings.RAZORPAYX_KEY_ID and settings.RAZORPAYX_KEY_SECRET):
        raise PaymentConfigError("RazorpayX payout credentials are not configured (RAZORPAYX_KEY_ID / RAZORPAYX_KEY_SECRET).")
    return RazorpayClient(settings.RAZORPAYX_KEY_ID, settings.RAZORPAYX_KEY_SECRET)


# ---------------------------------------------------------------------------
# Signature verification (server-side, the only accepted truth)
# ---------------------------------------------------------------------------

def verify_checkout_signature(order_id: str, payment_id: str, signature: str, key_secret: Optional[str] = None) -> bool:
    """Checkout callback verification:
    expected = HMAC_SHA256(order_id + '|' + payment_id, key_secret), hex-encoded.
    Constant-time comparison.
    """
    secret = key_secret or settings.RAZORPAY_KEY_SECRET
    if not secret:
        return False
    payload = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (signature or ""))


def verify_webhook_signature(body_bytes: bytes, signature: str, webhook_secret: Optional[str] = None) -> bool:
    """Razorpay webhooks sign the *raw* body with X-Razorpay-Signature."""
    secret = webhook_secret or settings.RAZORPAY_WEBHOOK_SECRET
    if not secret:
        return False
    expected = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
