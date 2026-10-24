"""Real-money payment flow tests.

Covers:
* Commission split math (exact integer paise).
* HMAC signature verification (checkout callback + webhooks) — rejects tampered
  and empty-signature payloads; requires a configured secret.
* Full checkout with a FAKED provider client: intent → verify → entitlement,
  without ever trusting the frontend alone.
* Signed webhook processing with exactly-once (idempotent) semantics.
* Un-configured gateway: every paid path fails loudly (503), nothing simulated.
"""
import hashlib
import hmac
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.models import Entitlement, PlatformSetting, Purchase, User, Subscription


def _register(client: TestClient, email: str) -> dict:
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "testpass123", "full_name": email.split("@")[0]},
    )
    if resp.status_code not in (200, 201):
        assert "already" in str(resp.json().get("detail", "")).lower(), resp.text
    login = client.post("/api/v1/auth/login", data={"username": email, "password": "testpass123"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _make_agent(client: TestClient, seller_headers: dict, name: str, model: str = "free", amount: int = 0, runs: int = None):
    create = client.post(
        "/api/v1/agents/",
        headers=seller_headers,
        json={
            "name": name,
            "description": "Paid listing description longer than twenty characters.",
            "system_prompt": "You are an expert agent.",
            "model_name": "gpt-4o-mini",
        },
    )
    assert create.status_code == 201, create.text
    agent = create.json()
    if model != "free":
        plan = client.post(
            f"/api/v1/creator/agents/{agent['id']}/pricing",
            headers=seller_headers,
            json={"model": model, "currency": "INR", "amount_minor": amount, "runs_per_pack": runs},
        )
        assert plan.status_code == 201, plan.text
    pub = client.post(f"/api/v1/marketplace/agents/{agent['id']}/publish", headers=seller_headers)
    assert pub.status_code == 200, pub.text
    return agent


@pytest.fixture
def fake_gateway(monkeypatch, db):
    """Patch payments razorpay_client with an in-memory fake and set keys."""
    class FakeRazorpay:
        def __init__(self):
            self.orders = {}
            self.payments = {}
            self.refunds = []

        def create_order(self, amount_minor, currency, receipt, notes=None):
            oid = f"order_fake_{len(self.orders) + 1}"
            self.orders[oid] = {"amount": amount_minor, "currency": currency, "receipt": receipt}
            return {"id": oid, "amount": amount_minor, "currency": currency, "receipt": receipt}

        def fetch_payment(self, payment_id):
            return self.payments.get(payment_id) or {"status": "created"}

    fake = FakeRazorpay()
    fake.payments["pay_fake1"] = {"id": "pay_fake1", "status": "captured", "amount": 2500, "method": "upi"}
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "rzp_test_fakekey", raising=False)
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "test_secret_123", raising=False)
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", "whsec_test_456", raising=False)
    monkeypatch.setattr("app.services.payments.razorpay_client", lambda: fake)
    # Some other tests mutate the runtime commission setting; the money math
    # below assumes the default 10%.
    for row in db.query(PlatformSetting).filter(PlatformSetting.key == "commission_bps").all():
        db.delete(row)
    db.commit()
    return fake


def _checkout_signature(order_id: str, payment_id: str, secret: str = "test_secret_123") -> str:
    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _webhook_signature(body: bytes, secret: str = "whsec_test_456") -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# --- Unit: split + signatures -------------------------------------------------------


def test_compute_split_exact(db):
    from app.services import payments

    fee, earn = payments.compute_split(2500, 1000)  # 10% of ₹25
    assert fee == 250 and earn == 2250
    fee, earn = payments.compute_split(999, 2000)   # 20% floor division
    assert fee == 199 and earn == 800
    fee, earn = payments.compute_split(12345, 100)
    assert fee + earn == 12345                     # always sums exactly


def test_signature_verification(db, monkeypatch):
    from app.services import payments

    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "s3cr3t", raising=False)
    assert payments.verify_checkout_signature("order_x", "pay_y", _checkout_signature("order_x", "pay_y", "s3cr3t"))
    assert not payments.verify_checkout_signature("order_x", "pay_y", _checkout_signature("order_tampered", "pay_y", "s3cr3t"))
    assert not payments.verify_checkout_signature("order_x", "pay_y", "")
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", "ws", raising=False)
    body = b'{"event":"payment.captured"}'
    assert payments.verify_webhook_signature(body, _webhook_signature(body, "ws"))
    assert not payments.verify_webhook_signature(body, _webhook_signature(body, "wrong"))
    # Missing secret -> reject (no accidental open channel)
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "", raising=False)
    assert not payments.verify_checkout_signature("o", "p", "anything")


def test_payments_disabled_by_default():
    from app.services import payments

    prev_key, prev_secret = settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET
    try:
        settings.RAZORPAY_KEY_ID = ""
        settings.RAZORPAY_KEY_SECRET = ""
        assert payments.payments_enabled() is False
    finally:
        settings.RAZORPAY_KEY_ID = prev_key
        settings.RAZORPAY_KEY_SECRET = prev_secret


# --- Checkout: free claim + paid intent/verify --------------------------------------


def test_free_agent_claim_grants_entitlement(client: TestClient, db):
    seller = _register(client, "pay_free_seller@example.com")
    agent = _make_agent(client, seller, "Free Claim Agent")
    buyer = _register(client, "pay_free_buyer@example.com")

    intent = client.post("/api/v1/checkouts/intents", headers=buyer, json={"agent_id": agent["id"]})
    assert intent.status_code == 200, intent.text
    body = intent.json()
    assert body["mode"] == "free"
    assert "razorpay_key_id" not in body or not body["razorpay_key_id"]  # no gateway needed

    user = db.query(User).filter(User.email == "pay_free_buyer@example.com").first()
    ent = db.query(Entitlement).filter(Entitlement.buyer_id == user.id).first()
    assert ent and ent.status == "active" and ent.source == "free"

    purchase = db.query(Purchase).filter(Purchase.buyer_id == user.id, Purchase.amount_minor == 0).first()
    assert purchase and purchase.status == "free"


def test_paid_intent_503_when_gateway_unconfigured(client: TestClient, db, monkeypatch):
    seller = _register(client, "pay_unconf_seller@example.com")
    agent = _make_agent(client, seller, "Unconfigured Paid Agent", model="one_time", amount=2500)
    buyer = _register(client, "pay_unconf_buyer@example.com")

    prev = (settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET, settings.PAYMENT_PROVIDER)
    try:
        settings.RAZORPAY_KEY_ID = ""
        settings.RAZORPAY_KEY_SECRET = ""
        settings.PAYMENT_PROVIDER = "razorpay"
        intent = client.post("/api/v1/checkouts/intents", headers=buyer, json={"agent_id": agent["id"]})
        assert intent.status_code == 503, intent.text
        assert "not configured" in intent.json()["detail"].lower()
        # No purchase row must have materialized
        assert db.query(Purchase).filter(Purchase.agent_id == agent["id"]).count() == 0
    finally:
        settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET, settings.PAYMENT_PROVIDER = prev


def test_checkout_verify_grants_access_and_split(client: TestClient, db, fake_gateway):
    seller = _register(client, "verif_seller@example.com")
    agent = _make_agent(client, seller, "Verified Paid Agent", model="one_time", amount=2500)
    buyer = _register(client, "verif_buyer@example.com")

    intent = client.post("/api/v1/checkouts/intents", headers=buyer, json={"agent_id": agent["id"]})
    assert intent.status_code == 200, intent.text
    body = intent.json()
    assert body["mode"] == "paid" and body["provider_mode"] == "test"
    assert body["razorpay_key_id"] == "rzp_test_fakekey"  # public id only
    order_id = body["order_id"]
    ref = body["purchase_reference"]

    # Tampered signature -> 400, no entitlement
    bad = client.post(
        "/api/v1/checkouts/verify",
        headers=buyer,
        json={
            "purchase_reference": ref,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_fake1",
            "razorpay_signature": "0" * 64,
        },
    )
    assert bad.status_code == 400, bad.text
    user = db.query(User).filter(User.email == "verif_buyer@example.com").first()
    ent = db.query(Entitlement).filter(Entitlement.buyer_id == user.id).first()
    assert ent is None  # nothing granted on a failed check

    # Valid signature -> paid + entitlement + split
    ok = client.post(
        "/api/v1/checkouts/verify",
        headers=buyer,
        json={
            "purchase_reference": ref,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_fake1",
            "razorpay_signature": _checkout_signature(order_id, "pay_fake1"),
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "paid"
    assert ok.json()["redirect_to"] == f"/agents/{body['agent_slug']}"

    db.refresh(user)
    purchase = db.query(Purchase).filter(Purchase.reference == ref).first()
    assert purchase.status == "paid"
    assert purchase.platform_fee_minor == 250 and purchase.creator_earnings_minor == 2250

    ent = db.query(Entitlement).filter(Entitlement.buyer_id == user.id, Entitlement.agent_id == agent["id"]).first()
    assert ent is not None and ent.status == "active" and ent.source == "one_time"

    # Re-sending the same verify is idempotent (already_paid, no double split)
    again = client.post(
        "/api/v1/checkouts/verify",
        headers=buyer,
        json={
            "purchase_reference": ref,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_fake1",
            "razorpay_signature": _checkout_signature(order_id, "pay_fake1"),
        },
    )
    assert again.status_code == 200 and again.json()["status"] == "already_paid"


def test_webhook_captured_exactly_once(client: TestClient, db, fake_gateway):
    seller = _register(client, "hook_seller@example.com")
    agent = _make_agent(client, seller, "Webhook Paid Agent", model="one_time", amount=2500)
    buyer = _register(client, "hook_buyer@example.com")

    intent = client.post("/api/v1/checkouts/intents", headers=buyer, json={"agent_id": agent["id"]})
    ref = intent.json()["purchase_reference"]
    order_id = intent.json()["order_id"]

    payload = {
        "id": "evt_hook_1",
        "event": "payment.captured",
        "payload": {
            "payment": {"entity": {"id": "pay_h1", "status": "captured", "amount": 2500, "order_id": order_id}},
            "order": {"entity": {"receipt": ref}},
        },
    }
    import json as _json

    raw = _json.dumps(payload).encode()
    headers = {"X-Razorpay-Signature": _webhook_signature(raw)}

    # Invalid signature rejected
    bad = client.post("/api/v1/checkouts/webhooks/razorpay", content=raw, headers={"X-Razorpay-Signature": "deadbeef"})
    assert bad.status_code == 400

    first = client.post("/api/v1/checkouts/webhooks/razorpay", content=raw, headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "processed"

    purchase = db.query(Purchase).filter(Purchase.reference == ref).first()
    assert purchase.status == "paid"
    assert purchase.platform_fee_minor == 250 and purchase.creator_earnings_minor == 2250

    user = db.query(User).filter(User.email == "hook_buyer@example.com").first()
    ent = db.query(Entitlement).filter(Entitlement.buyer_id == user.id, Entitlement.agent_id == agent["id"]).first()
    assert ent and ent.status == "active"

    # Provider redelivery: same event id → duplicate ignored, still ONE paid purchase
    second = client.post("/api/v1/checkouts/webhooks/razorpay", content=raw, headers=headers)
    assert second.status_code == 200
    assert second.json()["status"] == "duplicate_ignored"
    assert purchase.platform_fee_minor == 250  # split unchanged


def test_checkout_rejects_own_agent(client: TestClient):
    seller = _register(client, "own_seller@example.com")
    agent = _make_agent(client, seller, "Own Checkout Attempt")
    intent = client.post("/api/v1/checkouts/intents", headers=seller, json={"agent_id": agent["id"]})
    assert intent.status_code == 400
    assert "own" in intent.json()["detail"].lower()


def test_pay_per_execution_intent_carries_pack(client: TestClient, db, fake_gateway):
    seller = _register(client, "ppe_seller@example.com")
    agent = _make_agent(client, seller, "PPE Checkout Agent", model="pay_per_execution", amount=500, runs=10)
    buyer = _register(client, "ppe_buyer@example.com")

    intent = client.post("/api/v1/checkouts/intents", headers=buyer, json={"agent_id": agent["id"]})
    assert intent.status_code == 200, intent.text
    ref = intent.json()["purchase_reference"]
    purchase = db.query(Purchase).filter(Purchase.reference == ref).first()
    assert purchase.pricing_model == "pay_per_execution"
    assert purchase.runs_included == 10
    assert purchase.status == "created"  # not yet paid
