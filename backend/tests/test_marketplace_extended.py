"""Marketplace integration tests: credit ledger on purchase + leaderboard ranking."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import CreditTransaction


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


_AGENT_NAMES = iter(("Premier Coding Agent Alpha", "Premier Coding Agent Beta"))


def _make_priced_agent(client: TestClient) -> int:
    """Create a priced, published agent under the shared seller account."""
    seller_headers = _register(client, "seller_lb@example.com")
    create = client.post(
        "/api/v1/agents/",
        headers=seller_headers,
        json={
            "name": next(_AGENT_NAMES),
            "description": "Writes and fixes code autonomously.",
            "system_prompt": "You are an expert coding agent.",
            "model_name": "gpt-4o-mini",
            "temperature": 0.3,
            "max_steps": 40,
            "autonomy_level": "autonomous",
            "sandbox_enabled": True,
            "advanced_config": {"planning_enabled": True, "reflection_enabled": True},
            "is_public": True,
            "is_published": True,
            "price": 25,
        },
    )
    assert create.status_code == 201, create.text
    return create.json()["id"]


def test_purchase_writes_credit_ledger(client: TestClient, db: Session):
    agent_id = _make_priced_agent(client)
    buyer_headers = _register(client, "buyer_lb@example.com")

    purchase = client.post(f"/api/v1/marketplace/agents/{agent_id}/purchase", headers=buyer_headers)
    assert purchase.status_code == 200, purchase.text
    body = purchase.json()
    assert body["price_paid"] == 25
    assert body["credits_remaining"] == 975  # fresh user starts at 1000
    assert body["cloned_agent_id"]

    # Ledger invariants: exactly one debit (buyer) and one credit (seller)
    txs = (
        db.query(CreditTransaction)
        .filter(CreditTransaction.agent_id == agent_id, CreditTransaction.reason != "run_meter")
        .all()
    )
    assert len(txs) == 2
    by_reason = {tx.reason: tx for tx in txs}
    buyer_tx = by_reason["agent_purchase"]
    seller_tx = by_reason["agent_sale"]
    assert buyer_tx.amount == -25 and seller_tx.amount == 25
    assert buyer_tx.balance_after == 975 and seller_tx.balance_after == 1025
    # Shared reference id links both sides of the trade
    assert buyer_tx.reference_id == seller_tx.reference_id

    # Seller dashboard sees the earnings
    stats = client.get(
        "/api/v1/users/me/stats", headers=_register(client, "seller_lb@example.com")
    ).json()
    assert stats["earnings"] >= 25
    assert stats["credits"] >= 1025


def test_leaderboard_ranks_published_agents(client: TestClient):
    agent_id = _make_priced_agent(client)
    rater_headers = _register(client, "rater_lb@example.com")
    client.post(f"/api/v1/marketplace/agents/{agent_id}/rate",
                headers=rater_headers, json={"rating": 5, "review": "excellent"})

    lb = client.get("/api/v1/marketplace/leaderboard", headers=rater_headers)
    assert lb.status_code == 200, lb.text
    entries = lb.json()
    assert isinstance(entries, list) and entries

    entry = next(e for e in entries if e["agent_id"] == agent_id)
    assert entry["rank"] >= 1
    assert entry["rating_count"] == 1 and entry["avg_rating"] == 5.0
    assert entry["score"] == 102.0  # 5*20 + 1*2, no usage yet
    assert entry["sandbox_enabled"] is True
    assert entry["owner_email"] == "seller_lb@example.com"
    # Ranks are unique and ascending across the board
    ranks = [e["rank"] for e in entries]
    assert ranks == sorted(ranks) and len(set(ranks)) == len(ranks)


def test_leaderboard_requires_auth(client: TestClient):
    resp = client.get("/api/v1/marketplace/leaderboard")
    assert resp.status_code in (401, 403)


# --- Clone gating: paid agents require purchase; free agents clone freely ----


def _make_custom_agent(client: TestClient, seller_headers: dict, name: str, price: int) -> int:
    create = client.post(
        "/api/v1/agents/",
        headers=seller_headers,
        json={
            "name": name,
            "description": f"{name} agent",
            "system_prompt": "You are a helpful agent.",
            "model_name": "gpt-4o-mini",
            "is_public": True,
            "is_published": True,
            "price": price,
        },
    )
    assert create.status_code == 201, create.text
    return create.json()["id"]


def test_free_agent_clonable_without_purchase(client: TestClient):
    seller = _register(client, "clone_free_seller@example.com")
    free_id = _make_custom_agent(client, seller, "Clone Gating Free Agent", price=0)

    buyer = _register(client, "clone_free_buyer@example.com")
    clone = client.post(f"/api/v1/marketplace/agents/{free_id}/clone", headers=buyer)
    assert clone.status_code == 200, clone.text
    body = clone.json()
    assert body["name"].endswith("(Clone)")
    assert body["price"] == 0 and body["is_published"] is False


def test_paid_agent_clone_blocked_until_purchase(client: TestClient):
    seller = _register(client, "clone_paid_seller@example.com")
    paid_id = _make_custom_agent(client, seller, "Clone Gating Paid Agent", price=30)

    buyer = _register(client, "clone_paid_buyer@example.com")

    # Blocked before purchase
    denied = client.post(f"/api/v1/marketplace/agents/{paid_id}/clone", headers=buyer)
    assert denied.status_code == 402, denied.text
    assert "purchase" in str(denied.json().get("detail", "")).lower()

    # Owner can always clone their own agent
    owner_clone = client.post(f"/api/v1/marketplace/agents/{paid_id}/clone", headers=seller)
    assert owner_clone.status_code == 200, owner_clone.text

    # Purchase (auto-clones) then clone is unlocked
    purchase = client.post(f"/api/v1/marketplace/agents/{paid_id}/purchase", headers=buyer)
    assert purchase.status_code == 200, purchase.text
    assert purchase.json()["cloned_agent_id"]

    again = client.post(f"/api/v1/marketplace/agents/{paid_id}/clone", headers=buyer)
    assert again.status_code == 200, again.text


def test_marketplace_listing_exposes_clonable_flags(client: TestClient):
    seller = _register(client, "flags_seller@example.com")
    paid_id = _make_custom_agent(client, seller, "Flags Paid Agent", price=25)
    free_id = _make_custom_agent(client, seller, "Flags Free Agent", price=0)

    buyer = _register(client, "flags_buyer@example.com")
    listing = client.get("/api/v1/marketplace/agents", headers=buyer).json()
    paid = next(a for a in listing if a["id"] == paid_id)
    free = next(a for a in listing if a["id"] == free_id)

    # Not bought yet: paid agent is locked, free agent is cloneable
    assert paid["purchased"] is False and paid["clonable"] is False
    assert free["purchased"] is False and free["clonable"] is True

    # Seller sees their own paid agent as owned/clonable
    seller_listing = client.get("/api/v1/marketplace/agents", headers=seller).json()
    owned = next(a for a in seller_listing if a["id"] == paid_id)
    assert owned["purchased"] is True and owned["clonable"] is True

    # After purchase the paid agent unlocks for the buyer
    client.post(f"/api/v1/marketplace/agents/{paid_id}/purchase", headers=buyer)
    listing_after = client.get("/api/v1/marketplace/agents", headers=buyer).json()
    paid_after = next(a for a in listing_after if a["id"] == paid_id)
    assert paid_after["purchased"] is True and paid_after["clonable"] is True
