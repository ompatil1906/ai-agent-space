"""Customer purchase/entitlement/subscription dashboard API."""
from datetime import datetime
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import (
    Agent,
    Entitlement,
    PaymentTransaction,
    Purchase,
    Subscription,
    User,
)
from app.schemas import (
    EntitlementPublic,
    PurchasePublic,
    SubscriptionPublic,
)
from app.services import ledger, payments
from app.services.ledger import log_audit

router = APIRouter()


@router.get("", response_model=List[EntitlementPublic])
def my_agents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """My Agents: every agent the user has access to + its entitlement state."""
    ents = (
        db.query(Entitlement)
        .filter(Entitlement.buyer_id == current_user.id)
        .order_by(Entitlement.updated_at.desc())
        .all()
    )
    out: List[EntitlementPublic] = []
    for ent in ents:
        agent = db.query(Agent).filter(Agent.id == ent.agent_id).first()
        item = EntitlementPublic(
            id=ent.id,
            agent_id=ent.agent_id,
            source=ent.source,
            status=ent.status,
            runs_remaining=ent.runs_remaining,
            valid_until=ent.valid_until,
            created_at=ent.created_at,
            agent_name=agent.name if agent else None,
            agent_slug=agent.slug if agent else None,
            agent_status=agent.status if agent else None,
            avatar_url=agent.avatar_url if agent else None,
        )
        # Surface expired subscription state
        if ent.status == "active" and ent.valid_until and ent.valid_until < datetime.utcnow():
            item.status = "expired"
        out.append(item)
    return out


@router.get("/history", response_model=List[PurchasePublic])
def purchase_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    limit: int = 100,
) -> Any:
    """Receipts / purchase history with money amounts."""
    purchases = (
        db.query(Purchase)
        .filter(Purchase.buyer_id == current_user.id)
        .order_by(Purchase.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for p in purchases:
        agent = db.query(Agent).filter(Agent.id == p.agent_id).first()
        item = PurchasePublic(
            id=p.id,
            reference=p.reference,
            agent_id=p.agent_id,
            pricing_model=p.pricing_model,
            currency=p.currency,
            amount_minor=p.amount_minor,
            platform_fee_minor=p.platform_fee_minor,
            creator_earnings_minor=p.creator_earnings_minor,
            runs_included=p.runs_included,
            status=p.status,
            created_at=p.created_at,
            paid_at=p.paid_at,
            refunded_minor=p.refunded_minor,
            receipt_number=f"RCPT-{p.id:08d}",
            agent_name=agent.name if agent else None,
            agent_slug=agent.slug if agent else None,
        )
        out.append(item)
    return out


@router.get("/subscriptions", response_model=List[SubscriptionPublic])
def my_subscriptions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """My subscriptions (buyer side) — listed so they can be cancelled."""
    subs = (
        db.query(Subscription)
        .filter(Subscription.buyer_id == current_user.id)
        .order_by(Subscription.created_at.desc())
        .limit(100)
        .all()
    )
    out: List[SubscriptionPublic] = []
    for sub in subs:
        agent = db.query(Agent).filter(Agent.id == sub.agent_id).first()
        out.append(
            SubscriptionPublic(
                id=sub.id,
                agent_id=sub.agent_id,
                plan_id=sub.plan_id,
                provider=sub.provider,
                provider_subscription_id=sub.provider_subscription_id,
                status="expired" if sub.status == "active" and sub.current_period_end and sub.current_period_end < datetime.utcnow() else sub.status,
                interval=sub.interval,
                currency=sub.currency,
                amount_minor=sub.amount_minor,
                current_period_start=sub.current_period_start,
                current_period_end=sub.current_period_end,
                cancelled_at=sub.cancelled_at,
                agent_name=agent.name if agent else None,
                agent_slug=agent.slug if agent else None,
            )
        )
    return out


@router.get("/{reference}", response_model=PurchasePublic)
def purchase_receipt(
    reference: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    p = (
        db.query(Purchase)
        .filter(Purchase.reference == reference, Purchase.buyer_id == current_user.id)
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    agent = db.query(Agent).filter(Agent.id == p.agent_id).first()
    tx = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.purchase_id == p.id)
        .order_by(PaymentTransaction.created_at.desc())
        .first()
    )
    return PurchasePublic(
        id=p.id,
        reference=p.reference,
        agent_id=p.agent_id,
        pricing_model=p.pricing_model,
        currency=p.currency,
        amount_minor=p.amount_minor,
        platform_fee_minor=p.platform_fee_minor,
        creator_earnings_minor=p.creator_earnings_minor,
        runs_included=p.runs_included,
        status=p.status,
        created_at=p.created_at,
        paid_at=p.paid_at,
        refunded_minor=p.refunded_minor,
        receipt_number=f"RCPT-{p.id:08d}",
        agent_name=agent.name if agent else None,
        agent_slug=agent.slug if agent else None,
        provider_mode=payments.payment_mode() if tx and tx.provider == "razorpay" else None,
    )


@router.post("/subscriptions/{subscription_id}/cancel")
def cancel_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Cancel a subscription. With the provider configured it calls provider
    cancel (at period end); otherwise the platform-side record stops renewals
    and access ends at the current period end."""
    sub = (
        db.query(Subscription)
        .filter(Subscription.id == subscription_id, Subscription.buyer_id == current_user.id)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if sub.status == "cancelled":
        return {"status": "already_cancelled", "at_period_end": True}

    at_period_end = True
    if sub.provider_subscription_id and payments.payments_enabled():
        try:
            client = payments.razorpay_client()
            client.cancel_subscription(sub.provider_subscription_id, at_cycle_end=True)
        except payments.PaymentProviderError as e:
            raise HTTPException(status_code=502, detail=f"Provider cancel failed: {e}")

    sub.status = "cancelled"
    sub.cancelled_at = datetime.utcnow()
    db.add(sub)
    ent = db.query(Entitlement).filter(Entitlement.subscription_id == sub.id).first()
    if ent and (not ent.valid_until or ent.valid_until <= datetime.utcnow()):
        # No future period: access already elapsed — mark expired; otherwise
        # cancelled subscriptions keep access until valid_until naturally expires.
        ent.status = "expired" if ent.valid_until and ent.valid_until <= datetime.utcnow() else ent.status
        db.add(ent)
    log_audit(db, current_user.id, "subscription.cancelled", "subscription", sub.id, {
        "at_period_end": at_period_end,
    })
    db.commit()
    return {"status": "cancelled", "at_period_end": at_period_end, "valid_until": ent.valid_until if ent else None}
