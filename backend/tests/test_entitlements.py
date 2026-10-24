"""Entitlement/execution billing tests.

authorize_run / bill_run / refund_run replace the legacy credit metering:
* Free agents run for any signed-in user, creators run their own agents free.
* Paid agents need an active entitlement — 402 otherwise.
* pay_per_execution packs debit atomically and refund on failed runs.
* Daily usage caps trigger 429.
* Retries with the same client_request_id replay without double charging.
"""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Agent, Entitlement, Purchase, User
from app.services.execution_auth import (
    RunDenied,
    RunIdempotentReplay,
    authorize_run,
    bill_run,
    refund_run,
)


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


def _make_agent(client: TestClient, seller_headers: dict, name: str, model: str = "free", amount: int = 0, runs: int = None, limits: dict = None):
    create = client.post(
        "/api/v1/agents/",
        headers=seller_headers,
        json={
            "name": name,
            "description": "Entitlement test listing description that is long enough.",
            "system_prompt": "You are an expert agent.",
            "model_name": "gpt-4o-mini",
        },
    )
    assert create.status_code == 201, create.text
    agent = create.json()
    if model != "free":
        body = {"model": model, "currency": "INR", "amount_minor": amount}
        if runs:
            body["runs_per_pack"] = runs
        if model == "subscription":
            body["billing_interval"] = "month"
        if limits:
            body["limits"] = limits
        plan = client.post(f"/api/v1/creator/agents/{agent['id']}/pricing", headers=seller_headers, json=body)
        assert plan.status_code == 201, plan.text
    pub = client.post(f"/api/v1/marketplace/agents/{agent['id']}/publish", headers=seller_headers)
    assert pub.status_code == 200, pub.text
    return agent


def _grant(db: Session, buyer_id: int, agent_id: int, source: str, runs: int = None, amount: int = 2500):
    """Seed a paid purchase + entitlement exactly like a verified checkout would."""
    from app.services import ledger

    purchase = Purchase(
        reference=ledger.generate_reference("pur"),
        buyer_id=buyer_id,
        agent_id=agent_id,
        pricing_model="pay_per_execution" if source == "pay_per_pack" else ("subscription" if source == "subscription" else "one_time"),
        currency="INR",
        amount_minor=amount,
        platform_fee_minor=amount // 10,
        creator_earnings_minor=amount - amount // 10,
        runs_included=runs,
        status="paid",
        paid_at=datetime.utcnow(),
    )
    db.add(purchase)
    db.flush()
    ledger.upsert_entitlement(
        db, buyer_id, agent_id, source=source, purchase_id=purchase.id, runs_per_pack=runs
    )
    db.commit()
    return db.query(Entitlement).filter(Entitlement.buyer_id == buyer_id, Entitlement.agent_id == agent_id).first()


def _user_id(db: Session, email: str) -> int:
    return db.query(User).filter(User.email == email).first().id


# --- Service-level gating -------------------------------------------------------------


def test_owner_runs_free_and_free_agent_is_free(client: TestClient, db: Session):
    seller_hdr = _register(client, "ent_owner_seller@example.com")
    agent = _make_agent(client, seller_hdr, "Owner Free Run Agent")
    seller_id = _user_id(db, "ent_owner_seller@example.com")
    seller = db.query(User).get(seller_id)
    agent_obj = db.query(Agent).get(agent["id"])

    # Owner: no entitlement needed
    assert authorize_run(db, agent_obj, seller, None) is None

    # Any signed-in user: free agent needs no purchase
    buyer_hdr = _register(client, "ent_free_buyer@example.com")
    buyer_id = _user_id(db, "ent_free_buyer@example.com")
    buyer = db.query(User).get(buyer_id)
    assert authorize_run(db, agent_obj, buyer, None) is None


def test_paid_agent_requires_entitlement(client: TestClient, db: Session):
    seller_hdr = _register(client, "ent_paid_seller@example.com")
    agent = _make_agent(client, seller_hdr, "Gated One Time Agent", model="one_time", amount=2500)
    buyer_hdr = _register(client, "ent_paid_buyer@example.com")
    buyer_id = _user_id(db, "ent_paid_buyer@example.com")

    agent_obj = db.query(Agent).get(agent["id"])
    buyer = db.query(User).get(buyer_id)

    with pytest.raises(RunDenied) as exc:
        authorize_run(db, agent_obj, buyer, None)
    assert exc.value.status_code == 402
    assert "purchase" in exc.value.detail.lower()
    assert exc.value.pricing["amount_minor"] == 2500

    # After a verified purchase the gate opens
    _grant(db, buyer_id, agent["id"], source="one_time")
    ent = authorize_run(db, agent_obj, buyer, None)
    assert ent is not None and ent.status == "active"


def test_run_endpoint_402_before_llm_call(client: TestClient):
    """The HTTP run endpoint must deny (402) BEFORE reaching the model provider."""
    seller_hdr = _register(client, "ent_http_seller@example.com")
    agent = _make_agent(client, seller_hdr, "HTTP Gate Agent", model="one_time", amount=1000)
    buyer_hdr = _register(client, "ent_http_buyer@example.com")
    resp = client.post(
        f"/api/v1/agents/{agent['id']}/run", headers=buyer_hdr, json={"input": "hello"}
    )
    assert resp.status_code == 402, resp.text
    assert resp.headers.get("X-Purchase-Required") == "true"


def test_pay_per_execution_pack_debit_and_refund(client: TestClient, db: Session):
    seller_hdr = _register(client, "ent_ppe_seller@example.com")
    agent = _make_agent(client, seller_hdr, "PPE Pack Agent", model="pay_per_execution", amount=500, runs=5)
    buyer_hdr = _register(client, "ent_ppe_buyer@example.com")
    buyer_id = _user_id(db, "ent_ppe_buyer@example.com")
    buyer = db.query(User).get(buyer_id)
    agent_obj = db.query(Agent).get(agent["id"])

    ent = _grant(db, buyer_id, agent["id"], source="pay_per_pack", runs=5)
    assert ent.runs_remaining == 5

    # First run: debits one credit from the pack
    e1 = authorize_run(db, agent_obj, buyer, None)
    db.refresh(e1)
    assert e1.runs_remaining == 4

    # Drain the pack
    while True:
        try:
            authorize_run(db, agent_obj, buyer, None)
        except RunDenied as e:
            assert e.status_code == 402
            assert "used up" in e.detail.lower()
            break
    assert ent.runs_remaining == 0

    # Failed executions refund the debit
    run = db.query(Entitlement).filter(Entitlement.id == ent.id).first()
    from app.models import AgentRun

    agent_run = AgentRun(agent_id=agent["id"], user_id=buyer_id, input="x", status="error", entitlement_id=ent.id, execution_cost_minor=50, charge_status="charged")
    db.add(agent_run)
    db.commit()
    refund_run(db, agent_run)
    db.refresh(ent)
    assert ent.runs_remaining == 1
    assert agent_run.charge_status == "refunded"


def test_daily_cap_429(client: TestClient, db: Session):
    seller_hdr = _register(client, "ent_cap_seller@example.com")
    agent = _make_agent(
        client, seller_hdr, "Daily Cap Agent", model="subscription", amount=1000, limits={"max_runs_per_day": 2}
    )
    buyer_hdr = _register(client, "ent_cap_buyer@example.com")
    buyer_id = _user_id(db, "ent_cap_buyer@example.com")
    buyer = db.query(User).get(buyer_id)
    agent_obj = db.query(Agent).get(agent["id"])

    _grant(db, buyer_id, agent["id"], source="subscription")
    # Seed two runs from today (the cap applies to non-owner users)
    from app.models import AgentRun

    for _ in range(2):
        db.add(AgentRun(agent_id=agent["id"], user_id=buyer_id, input="seed", status="completed"))
    db.commit()

    with pytest.raises(RunDenied) as exc:
        authorize_run(db, agent_obj, buyer, None)
    assert exc.value.status_code == 429
    assert "limit" in exc.value.detail.lower()
    # 402 responses must NOT be confused with purchase-possible daily caps
    assert exc.value.pricing["billing_interval"] == "month"


def test_client_request_id_replay_no_double_charge(client: TestClient, db: Session):
    seller_hdr = _register(client, "ent_idem_seller@example.com")
    agent = _make_agent(client, seller_hdr, "Idempotent Retry Agent", model="pay_per_execution", amount=500, runs=5)
    buyer_hdr = _register(client, "ent_idem_buyer@example.com")
    buyer_id = _user_id(db, "ent_idem_buyer@example.com")
    buyer = db.query(User).get(buyer_id)
    agent_obj = db.query(Agent).get(agent["id"])

    ent = _grant(db, buyer_id, agent["id"], source="pay_per_pack", runs=5)
    assert ent.runs_remaining == 5

    from app.models import AgentRun
    from app.services import ledger

    # First attempt: authorize (debit) then persist the retry key on the run
    authorize_run(db, agent_obj, buyer, "retry-key-42")
    db.refresh(ent)
    assert ent.runs_remaining == 4
    prior = AgentRun(agent_id=agent["id"], user_id=buyer_id, input="x", status="running", client_request_id="retry-key-42")
    db.add(prior)
    db.commit()

    # Network retry with the SAME key: must replay, not debit again
    with pytest.raises(RunIdempotentReplay) as replay:
        authorize_run(db, agent_obj, buyer, "retry-key-42")
    assert replay.value.run.id == prior.id
    db.refresh(ent)
    assert ent.runs_remaining == 4  # unchanged

    # A different key debits normally
    authorize_run(db, agent_obj, buyer, "retry-key-43")
    db.refresh(ent)
    assert ent.runs_remaining == 3


def test_expired_subscription_runs_denied(client: TestClient, db: Session):
    seller_hdr = _register(client, "ent_sub_seller@example.com")
    agent = _make_agent(client, seller_hdr, "Sub Expiry Agent", model="subscription", amount=1000)
    buyer_hdr = _register(client, "ent_sub_buyer@example.com")
    buyer_id = _user_id(db, "ent_sub_buyer@example.com")
    buyer = db.query(User).get(buyer_id)
    agent_obj = db.query(Agent).get(agent["id"])

    ent = _grant(db, buyer_id, agent["id"], source="subscription")
    ent.valid_until = datetime.utcnow() - timedelta(days=1)
    db.commit()

    with pytest.raises(RunDenied) as exc:
        authorize_run(db, agent_obj, buyer, None)
    assert exc.value.status_code == 402
    # The past-dated entitlement is expired by the gate itself — access gone
    db.refresh(ent)
    assert ent.status == "expired"


def test_subscription_cancelled_by_webhook_revokes(client: TestClient, db: Session):
    """subscription.cancelled webhook marks entitlement revoked immediately."""
    import hashlib
    import hmac
    import json as _json

    from app.core.config import settings

    seller_hdr = _register(client, "hooksub_seller@example.com")
    agent = _make_agent(client, seller_hdr, "Hook Sub Agent", model="subscription", amount=1000)
    buyer_hdr = _register(client, "hooksub_buyer@example.com")
    buyer_id = _user_id(db, "hooksub_buyer@example.com")

    secret_backup = settings.RAZORPAY_WEBHOOK_SECRET
    key_backup = (settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
    try:
        settings.RAZORPAY_WEBHOOK_SECRET = "whsec_test_456"
        settings.RAZORPAY_KEY_ID = "rzp_test_fakekey"
        settings.RAZORPAY_KEY_SECRET = "test_secret_123"
        # Seed subscription + entitlement exactly like a real webhook flow would
        from app.models import Subscription

        sub = Subscription(
            buyer_id=buyer_id,
            agent_id=agent["id"],
            provider="razorpay",
            provider_subscription_id="sub_hooks1",
            status="active",
            interval="month",
            currency="INR",
            amount_minor=1000,
        )
        db.add(sub)
        db.commit()
        ent = _grant(db, buyer_id, agent["id"], source="subscription")
        # Link the entitlement to the subscription row (checkout path does this)
        ent.subscription_id = sub.id
        db.commit()

        payload = {
            "id": "evt_sub_cancel_1",
            "event": "subscription.cancelled",
            "payload": {"subscription": {"entity": {"id": "sub_hooks1", "status": "cancelled"}}},
        }
        raw = _json.dumps(payload).encode()
        sig = hmac.new(b"whsec_test_456", raw, hashlib.sha256).hexdigest()
        resp = client.post("/api/v1/checkouts/webhooks/razorpay", content=raw, headers={"X-Razorpay-Signature": sig})
        assert resp.status_code == 200, resp.text

        ent = db.query(Entitlement).filter(Entitlement.buyer_id == buyer_id, Entitlement.agent_id == agent["id"]).first()
        assert ent.status == "cancelled"
    finally:
        settings.RAZORPAY_WEBHOOK_SECRET = secret_backup
        settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET = key_backup
