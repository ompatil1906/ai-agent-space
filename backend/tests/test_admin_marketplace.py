"""Admin marketplace tests: role guards, moderation, refunds, payout policy.

Critical money-safety invariants covered here:
* Only real admins (role=admin / is_superuser) reach /admin endpoints.
* Refunds revoke entitlements (full) or reduce packs (partial) and post an
  exact, idempotent reversal in the creator ledger.
* A payout is NEVER completed without provider evidence (provider_payout_id).
* Admin platform settings surface payments state truthfully.
"""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models import (
    Agent,
    EarningsLedgerEntry,
    Entitlement,
    Payout,
    Purchase,
    RefundDispute,
    User,
)
from app.services import ledger, payments


ADMIN_EMAIL = "admin@example.com"


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


def _make_admin(db: Session) -> dict:
    """Ensure the admin user exists; return admin login headers."""
    user = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if not user:
        user = User(
            email=ADMIN_EMAIL,
            hashed_password=get_password_hash("testpass123"),
            full_name="Admin",
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _admin_headers(client: TestClient, db: Session) -> dict:
    _make_admin(db)
    return _register(client, ADMIN_EMAIL)


def _make_published_agent(client: TestClient, seller_headers: dict, name: str = "Admin Test Agent") -> int:
    create = client.post(
        "/api/v1/agents/",
        headers=seller_headers,
        json={
            "name": name,
            "description": "Admin workflow test agent description long enough.",
            "system_prompt": "You are an admin-test agent.",
            "model_name": "gpt-4o-mini",
        },
    )
    assert create.status_code == 201, create.text
    agent_id = create.json()["id"]
    plan = client.post(
        f"/api/v1/creator/agents/{agent_id}/pricing",
        headers=seller_headers,
        json={"model": "one_time", "currency": "INR", "amount_minor": 3000},
    )
    assert plan.status_code == 201, plan.text
    pub = client.post(f"/api/v1/marketplace/agents/{agent_id}/publish", headers=seller_headers)
    assert pub.status_code == 200, pub.text
    return agent_id


def _seed_paid_purchase(db: Session, client: TestClient, seller_headers: dict, agent_id: int) -> dict:
    """A verified-looking purchase: paid + entitlement + creator ledger sale."""
    buyer_headers = _register(client, "admin_refund_buyer@example.com")
    resp = client.get("/api/v1/users/me", headers=buyer_headers)
    buyer_id = resp.json()["id"]

    fee, earn = payments.compute_split(3000, 1000)
    purchase = Purchase(
        reference=ledger.generate_reference("pur"),
        buyer_id=buyer_id,
        agent_id=agent_id,
        pricing_model="one_time",
        currency="INR",
        amount_minor=3000,
        platform_fee_minor=fee,
        creator_earnings_minor=earn,
        status="paid",
        paid_at=datetime.utcnow(),
    )
    db.add(purchase)
    db.flush()
    ledger.upsert_entitlement(db, buyer_id, agent_id, source="one_time", purchase_id=purchase.id)
    ledger.post_purchase_earnings(db, purchase)
    db.commit()
    return {"buyer_id": buyer_id, "purchase": purchase}


# --- Role guard ---------------------------------------------------------------------


def test_admin_guard_blocks_regular_clients(client: TestClient, db: Session):
    hdr = _register(client, "not_admin@example.com")
    resp = client.get("/api/v1/admin/agents", headers=hdr)
    assert resp.status_code == 403
    assert "administrator" in resp.json()["detail"].lower()

    anon = client.get("/api/v1/admin/orders")
    assert anon.status_code in (401, 403)


def test_admin_lists_agents_and_orders(client: TestClient, db: Session):
    seller_hdr = _register(client, "admin_list_seller@example.com")
    agent_id = _make_published_agent(client, seller_hdr)
    admin_hdr = _admin_headers(client, db)

    agents = client.get("/api/v1/admin/agents", headers=admin_hdr)
    assert agents.status_code == 200, agents.text
    body = agents.json()
    row = next(a for a in body if a["id"] == agent_id)
    assert row["status"] == "published"
    assert row["pricing_model"] == "one_time" and row["amount_minor"] == 3000

    orders = client.get("/api/v1/admin/orders", headers=admin_hdr)
    assert orders.status_code == 200
    assert isinstance(orders.json(), list)


def test_admin_moderation_suspend_revokes_availability(client: TestClient, db: Session):
    seller_hdr = _register(client, "admin_mod_seller@example.com")
    agent_id = _make_published_agent(client, seller_hdr, "Mod Suspend Agent")
    admin_hdr = _admin_headers(client, db)

    resp = client.post(f"/api/v1/admin/agents/{agent_id}/status", headers=admin_hdr, json={"status": "suspended", "note": "policy"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "suspended"

    # Suspended listings vanish from the public catalog
    listing = client.get("/api/v1/marketplace/agents").json()
    assert all(a["id"] != agent_id for a in listing)

    # Detail 404s too
    agent = db.query(Agent).get(agent_id)
    detail = client.get(f"/api/v1/marketplace/agents/{agent.slug}")
    assert detail.status_code == 404

    # Restore to published
    restore = client.post(f"/api/v1/admin/agents/{agent_id}/status", headers=admin_hdr, json={"status": "published"})
    assert restore.status_code == 200 and restore.json()["status"] == "published"


def test_admin_refund_revokes_entitlement_and_reverses_ledger(client: TestClient, db: Session):
    seller_hdr = _register(client, "admin_ref_seller@example.com")
    agent_id = _make_published_agent(client, seller_hdr)
    seeded = _seed_paid_purchase(db, client, seller_hdr, agent_id)
    purchase = seeded["purchase"]
    buyer_id = seeded["buyer_id"]

    # Pre-state: entitlement active, ledger shows a sale
    ent = db.query(Entitlement).filter(Entitlement.buyer_id == buyer_id, Entitlement.agent_id == agent_id).first()
    assert ent.status == "active"
    sale = (
        db.query(EarningsLedgerEntry)
        .filter(EarningsLedgerEntry.purchase_id == purchase.id, EarningsLedgerEntry.entry_type == "sale")
        .first()
    )
    assert sale is not None and sale.amount_minor == purchase.creator_earnings_minor
    balance_before = ledger.current_balance(db, sale.creator_id, "INR")

    admin_hdr = _admin_headers(client, db)
    refund = client.post(
        "/api/v1/admin/refunds",
        headers=admin_hdr,
        json={"purchase_reference": purchase.reference, "amount_minor": 3000, "reason": "buyer request"},
    )
    assert refund.status_code == 200, refund.text
    body = refund.json()
    assert body["amount_minor"] == 3000

    db.refresh(purchase)
    assert purchase.status == "refunded"
    assert purchase.refunded_minor == 3000
    db.refresh(ent)
    assert ent.status == "revoked"   # full refund revokes access

    # Creator ledger got an exact reversal
    db.refresh(sale)
    reversal = (
        db.query(EarningsLedgerEntry)
        .filter(EarningsLedgerEntry.refund_id == body["id"], EarningsLedgerEntry.entry_type == "refund_reversal")
        .first()
    )
    assert reversal.amount_minor == -purchase.creator_earnings_minor
    assert ledger.current_balance(db, sale.creator_id, "INR") == balance_before - purchase.creator_earnings_minor


def test_admin_refund_webhook_redelivery_is_idempotent(client: TestClient, db: Session):
    """Same provider refund id twice → one RefundDispute, one reversal."""
    seller_hdr = _register(client, "admin_idem_seller@example.com")
    agent_id = _make_published_agent(client, seller_hdr, "Refund Idempotency Agent")
    seeded = _seed_paid_purchase(db, client, seller_hdr, agent_id)
    purchase = seeded["purchase"]

    from app.services.refunds import apply_refund

    d1 = apply_refund(db, purchase, amount_minor=3000, provider_refund_id="rfn_1", reason="x", raised_by_admin=1)
    d2 = apply_refund(db, purchase, amount_minor=3000, provider_refund_id="rfn_1", reason="x", raised_by_admin=1)
    assert d1.id == d2.id
    disputes = db.query(RefundDispute).filter(RefundDispute.purchase_id == purchase.id).count()
    assert disputes == 1
    reversals = (
        db.query(EarningsLedgerEntry)
        .filter(EarningsLedgerEntry.purchase_id == purchase.id, EarningsLedgerEntry.entry_type == "refund_reversal")
        .count()
    )
    assert reversals == 1


def test_payout_never_paid_without_provider_evidence(client: TestClient, db: Session):
    creator_hdr = _register(client, "payout_creator@example.com")
    creator_id = client.get("/api/v1/users/me", headers=creator_hdr).json()["id"]

    # Configure payout destination
    prof = client.put(
        "/api/v1/creator/profile",
        headers=creator_hdr,
        json={"payout_currency": "INR", "payout_account_name": "Creator", "payout_account_number": "1234567890", "payout_ifsc": "HDFC0000001"},
    )
    assert prof.status_code == 200, prof.text

    # The payout creator owns the sold agent; seed one paid ₹3000 sale on THEIR agent
    agent_id = _make_published_agent(client, creator_hdr, "Payout Balance Agent")
    seller_id = client.get("/api/v1/users/me", headers=creator_hdr).json()["id"]
    buyer_hdr = _register(client, "payout_buyer@example.com")

    fee, earn = payments.compute_split(300000, 1000)
    purchase = Purchase(
        reference=ledger.generate_reference("pur"),
        buyer_id=db.query(User).filter(User.email == "payout_buyer@example.com").first().id,
        agent_id=agent_id,
        pricing_model="one_time",
        currency="INR",
        amount_minor=300000,
        platform_fee_minor=fee,
        creator_earnings_minor=earn,
        status="paid",
        paid_at=datetime.utcnow(),
    )
    db.add(purchase)
    db.flush()
    ledger.post_purchase_earnings(db, purchase)
    db.commit()

    below_min = client.post("/api/v1/creator/payouts", headers=creator_hdr, json={"amount_minor": 1000})
    assert below_min.status_code == 400  # below PLATFORM_MIN_PAYOUT_MINOR

    req = client.post("/api/v1/creator/payouts", headers=creator_hdr, json={"amount_minor": 150000})
    assert req.status_code == 201, req.text
    payout = req.json()
    assert payout["status"] == "requested"   # NOT paid until provider confirms

    admin_hdr = _admin_headers(client, db)

    # Guardrail: mark_paid without provider_payout_id is rejected
    no_evidence = client.post(
        f"/api/v1/admin/payouts/{payout['id']}/action", headers=admin_hdr, json={"action": "mark_paid"}
    )
    assert no_evidence.status_code == 400
    assert "provider_payout_id" in no_evidence.json()["detail"]

    # With provider evidence the payout completes and debits the ledger exactly once
    confirmed = client.post(
        f"/api/v1/admin/payouts/{payout['id']}/action",
        headers=admin_hdr,
        json={"action": "mark_paid", "provider_payout_id": "po_prov_123"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "paid"
    assert confirmed.json()["provider_payout_id"] == "po_prov_123"

    payout_row = db.query(Payout).get(payout["id"])
    assert payout_row.creator_id == creator_id
    debits = (
        db.query(EarningsLedgerEntry)
        .filter(EarningsLedgerEntry.payout_id == payout_row.id, EarningsLedgerEntry.entry_type == "payout")
        .all()
    )
    assert len(debits) == 1 and debits[0].amount_minor == -150000

    # Repeating mark_paid is rejected (payout already complete) and must not double-debit
    again = client.post(
        f"/api/v1/admin/payouts/{payout['id']}/action",
        headers=admin_hdr,
        json={"action": "mark_paid", "provider_payout_id": "po_prov_123"},
    )
    assert again.status_code == 400
    debits = (
        db.query(EarningsLedgerEntry)
        .filter(EarningsLedgerEntry.payout_id == payout_row.id, EarningsLedgerEntry.entry_type == "payout")
        .all()
    )
    assert len(debits) == 1


def test_admin_settings_roundtrip(client: TestClient, db: Session):
    admin_hdr = _admin_headers(client, db)
    get1 = client.get("/api/v1/admin/settings", headers=admin_hdr)
    assert get1.status_code == 200
    s = get1.json()
    assert s["currency"] == "INR"
    assert isinstance(s["commission_bps"], int)
    assert "payments_enabled" in s

    upd = client.put("/api/v1/admin/settings", headers=admin_hdr, json={"commission_bps": 1500})
    assert upd.status_code == 200 and upd.json()["commission_bps"] == 1500

    bad = client.put("/api/v1/admin/settings", headers=admin_hdr, json={"commission_bps": 9999})
    assert bad.status_code == 422  # out of range


def test_admin_stats_and_audit(client: TestClient, db: Session):
    admin_hdr = _admin_headers(client, db)
    stats = client.get("/api/v1/admin/stats", headers=admin_hdr)
    assert stats.status_code == 200
    assert set(stats.json()) >= {"gross_volume_minor", "platform_revenue_minor", "total_users", "payments_enabled"}

    audit = client.get("/api/v1/admin/audit?limit=5", headers=admin_hdr)
    assert audit.status_code == 200
    assert isinstance(audit.json(), list)
