"""Marketplace integration tests — REAL-MONEY model.

Replaces the legacy credit-ledger tests. The credit columns still exist in the
DB but are never written by marketplace flows; payments go through Razorpay
(or a manual refund path in admin tests), entitlements gate execution, and the
creator earnings ledger holds the money truth.
"""
from typing import Optional

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session


def _register(client: TestClient, email: str) -> dict:
    """Ensure the user exists and return auth headers (idempotent)."""
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "testpass123", "full_name": email.split("@")[0]},
    )
    if resp.status_code not in (200, 201):
        # Re-registering the same email within one test session is fine
        assert "already" in str(resp.json().get("detail", "")).lower(), resp.text
    login = client.post("/api/v1/auth/login", data={"username": email, "password": "testpass123"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _make_agent(
    client: TestClient,
    seller_headers: dict,
    name: str,
    description: str = "Writes and fixes code autonomously for paying customers.",
    price_minor: Optional[int] = None,
    pricing_model: str = "free",
    publish: bool = True,
) -> dict:
    """Create an agent (default FREE active plan), optionally price + publish it."""
    create = client.post(
        "/api/v1/agents/",
        headers=seller_headers,
        json={
            "name": name,
            "description": description,
            "system_prompt": "You are an expert coding agent.",
            "model_name": "gpt-4o-mini",
            "temperature": 0.3,
            "autonomy_level": "autonomous",
            "sandbox_enabled": True,
        },
    )
    assert create.status_code == 201, create.text
    agent = create.json()
    assert agent["slug"], agent  # slug is mandatory now

    if pricing_model != "free":
        body: dict = {"model": pricing_model, "currency": "INR"}
        if pricing_model == "one_time":
            body["amount_minor"] = price_minor or 2500
        elif pricing_model == "pay_per_execution":
            body["amount_minor"] = price_minor or 500
            body["runs_per_pack"] = 10
        plan = client.post(f"/api/v1/creator/agents/{agent['id']}/pricing", headers=seller_headers, json=body)
        assert plan.status_code == 201, plan.text
        assert plan.json()["is_active"] is True

    if publish:
        pub = client.post(f"/api/v1/marketplace/agents/{agent['id']}/publish", headers=seller_headers)
        assert pub.status_code == 200, pub.text
        assert pub.json()["status"] == "published"
    return agent


# --- Public catalog: no secrets leak, viewer flags ---------------------------------


def test_public_catalog_hides_prompts(client: TestClient):
    headers = _register(client, "catalog_seller@example.com")
    agent = _make_agent(client, headers, "Catalog Secret Agent", publish=True)

    # Anonymous browse is allowed
    listing = client.get("/api/v1/marketplace/agents")
    assert listing.status_code == 200, listing.text
    card = next(a for a in listing.json() if a["id"] == agent["id"])
    for forbidden in ("system_prompt", "tools_config", "memory_config", "advanced_config"):
        assert forbidden not in card, forbidden

    detail = client.get(f"/api/v1/marketplace/agents/{agent['slug']}")
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    for forbidden in ("system_prompt", "tools_config", "memory_config", "advanced_config"):
        assert forbidden not in detail_body, forbidden
    assert detail_body["slug"] == agent["slug"]
    assert detail_body["pricing"]["model"] == "free"


def test_public_detail_404_for_draft(client: TestClient):
    headers = _register(client, "draft_seller@example.com")
    agent = _make_agent(client, headers, "Draft Only Agent", publish=False)
    resp = client.get(f"/api/v1/marketplace/agents/{agent['slug']}")
    assert resp.status_code == 404


def test_unpublished_agents_not_in_catalog(client: TestClient):
    headers = _register(client, "hidden_seller@example.com")
    agent = _make_agent(client, headers, "Unlisted Draft", publish=False)
    listing = client.get("/api/v1/marketplace/agents").json()
    assert all(a["id"] != agent["id"] for a in listing)


def _grant_paid_access(db: Session, buyer_id: int, agent_id: int, source: str = "one_time") -> None:
    """Simulate a verified purchase by inserting the purchase + entitlement
    exactly as the verified-checkout path would."""
    import datetime

    from app.models import Purchase
    from app.services import ledger

    purchase = Purchase(
        reference=ledger.generate_reference("pur"),
        buyer_id=buyer_id,
        agent_id=agent_id,
        pricing_model="pay_per_execution" if source == "pay_per_pack" else source,
        currency="INR",
        amount_minor=2500,
        platform_fee_minor=250,
        creator_earnings_minor=2250,
        status="paid",
        paid_at=datetime.datetime.utcnow(),
    )
    db.add(purchase)
    db.flush()
    ledger.upsert_entitlement(db, buyer_id, agent_id, source=source, purchase_id=purchase.id)
    db.commit()


# --- Clone gating: paid agents require (verified) purchase; free clone freely ----


def test_free_agent_clonable_without_purchase(client: TestClient):
    seller = _register(client, "clone_free_seller@example.com")
    free = _make_agent(client, seller, "Clone Gating Free Agent")

    buyer = _register(client, "clone_free_buyer@example.com")
    clone = client.post(f"/api/v1/marketplace/agents/{free['id']}/clone", headers=buyer)
    assert clone.status_code == 200, clone.text
    body = clone.json()
    assert body["name"].endswith("(Clone)")
    assert body["price"] == 0 and body["is_published"] is False


def test_paid_agent_clone_blocked_until_purchase(client: TestClient, db: Session):
    seller = _register(client, "clone_paid_seller@example.com")
    paid = _make_agent(client, seller, "Clone Gating Paid Agent", pricing_model="one_time")

    buyer_headers = _register(client, "clone_paid_buyer@example.com")
    buyer_id = client.get("/api/v1/users/me", headers=buyer_headers).json()["id"]

    # Blocked before purchase
    denied = client.post(f"/api/v1/marketplace/agents/{paid['id']}/clone", headers=buyer_headers)
    assert denied.status_code == 402, denied.text
    assert "purchase" in str(denied.json().get("detail", "")).lower()

    # Owner can always clone their own agent
    owner_clone = client.post(f"/api/v1/marketplace/agents/{paid['id']}/clone", headers=seller)
    assert owner_clone.status_code == 200, owner_clone.text

    # A verified entitlement (as granted by a real verified checkout) unlocks cloning
    _grant_paid_access(db, buyer_id, paid["id"])
    again = client.post(f"/api/v1/marketplace/agents/{paid['id']}/clone", headers=buyer_headers)
    assert again.status_code == 200, again.text


# --- Listing flags -----------------------------------------------------------------


def test_marketplace_listing_exposes_flags(client: TestClient):
    seller = _register(client, "flags_seller@example.com")
    paid = _make_agent(client, seller, "Flags Paid Agent", pricing_model="one_time")
    free = _make_agent(client, seller, "Flags Free Agent")

    buyer = _register(client, "flags_buyer@example.com")
    listing = client.get("/api/v1/marketplace/agents", headers=buyer).json()
    paid_card = next(a for a in listing if a["id"] == paid["id"])
    free_card = next(a for a in listing if a["id"] == free["id"])

    # Not bought yet: paid agent is locked, free agent is cloneable
    assert paid_card["purchased"] is False and not paid_card["owned_by_viewer"]
    assert free_card["pricing"]["model"] == "free"
    assert paid_card["pricing"]["model"] == "one_time"
    assert paid_card["pricing"]["amount_minor"] == 2500

    # Seller sees their own paid agent as owned
    seller_listing = client.get("/api/v1/marketplace/agents", headers=seller).json()
    owned = next(a for a in seller_listing if a["id"] == paid["id"])
    assert owned["owned_by_viewer"] is True and owned["purchased"] is True


# --- Ratings -----------------------------------------------------------------------


def test_rating_flow_verified_flag(client: TestClient, db: Session):
    from app.models import AgentRating, User

    seller = _register(client, "rate_seller@example.com")
    agent = _make_agent(client, seller, "Rated Free Agent")
    rater = _register(client, "rate_buyer@example.com")

    rating = client.post(
        f"/api/v1/marketplace/agents/{agent['id']}/rate", headers=rater, json={"rating": 5, "review": "great"}
    )
    assert rating.status_code == 200, rating.text
    assert rating.json()["rating"] == 5

    summary = client.get(f"/api/v1/marketplace/agents/{agent['id']}/rating-summary").json()
    assert summary["average_rating"] == 5.0
    assert summary["rating_count"] == 1

    lst = client.get(f"/api/v1/marketplace/agents/{agent['id']}/ratings").json()
    assert len(lst) == 1 and lst[0]["review"] == "great"

    # Second rating overwrites (upsert)
    rating2 = client.post(
        f"/api/v1/marketplace/agents/{agent['id']}/rate", headers=rater, json={"rating": 3, "review": "ok"}
    )
    assert rating2.status_code == 200
    rows = db.query(AgentRating).filter(AgentRating.agent_id == agent["id"]).all()
    assert len(rows) == 1 and rows[0].rating == 3

    # Rating another user's unpublished agent 404s
    headers_other = _register(client, "rate_other@example.com")
    other_agent = _make_agent(client, headers_other, "Rate Draft", publish=False)
    resp = client.post(
        f"/api/v1/marketplace/agents/{other_agent['id']}/rate", headers=rater, json={"rating": 5}
    )
    assert resp.status_code == 404


# --- Leaderboard -------------------------------------------------------------------


def test_leaderboard_ranks_published_agents(client: TestClient):
    agent = _make_agent(client, _register(client, "seller_lb@example.com"), "Premier Coding Agent Alpha")
    rater_headers = _register(client, "rater_lb@example.com")
    client.post(
        f"/api/v1/marketplace/agents/{agent['id']}/rate", headers=rater_headers, json={"rating": 5, "review": "excellent"}
    )

    lb = client.get("/api/v1/marketplace/leaderboard", headers=rater_headers)
    assert lb.status_code == 200, lb.text
    entries = lb.json()
    assert isinstance(entries, list) and entries

    entry = next(e for e in entries if e["agent_id"] == agent["id"])
    assert entry["rank"] >= 1
    assert entry["rating_count"] == 1 and entry["avg_rating"] == 5.0
    assert entry["score"] == 102.0  # 5*20 + 1*2, no usage yet
    assert entry["sandbox_enabled"] is True
    assert entry["owner_email"] == "seller_lb@example.com"
    assert entry["pricing_model"] == "free"
    # Ranks are unique and ascending across the board
    ranks = [e["rank"] for e in entries]
    assert ranks == sorted(ranks) and len(set(ranks)) == len(ranks)


def test_leaderboard_requires_auth(client: TestClient):
    resp = client.get("/api/v1/marketplace/leaderboard")
    assert resp.status_code in (401, 403)


# --- Moderation reports ------------------------------------------------------------


def test_report_published_agent(client: TestClient, db: Session):
    from app.models import ModerationReport, User

    seller = _register(client, "report_seller@example.com")
    agent = _make_agent(client, seller, "Reportable Agent")
    reporter = _register(client, "reporter@example.com")

    resp = client.post(
        f"/api/v1/marketplace/agents/{agent['id']}/report",
        headers=reporter,
        json={"reason": "spam", "details": "listing is misleading"},
    )
    assert resp.status_code == 201, resp.text

    row = db.query(ModerationReport).filter(ModerationReport.agent_id == agent["id"]).first()
    assert row is not None and row.status == "open"

    # Requires auth
    anon = client.post(
        f"/api/v1/marketplace/agents/{agent['id']}/report", json={"reason": "spam"}
    )
    assert anon.status_code in (401, 403)


# --- Categories --------------------------------------------------------------------


def test_categories_endpoint_returns_seeds(client: TestClient):
    cats = client.get("/api/v1/marketplace/categories").json()
    assert isinstance(cats, list) and len(cats) >= 5
    names = {c["slug"] for c in cats}
    assert "data-analysis" in names and "coding" in names
