"""Refund / chargeback application — shared by admin actions and provider webhooks."""
from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Agent,
    Entitlement,
    PaymentTransaction,
    Purchase,
    RefundDispute,
    Subscription,
)
from app.services import ledger


def apply_refund(
    db: Session,
    purchase: Purchase,
    *,
    amount_minor: int,
    provider_refund_id: Optional[str],
    reason: Optional[str],
    raised_by_admin: Optional[int],
    dispute_type: str = "refund",
) -> RefundDispute:
    """Apply a refund/chargeback against a paid purchase.

    Idempotent by provider_refund_id (webhook retries) — a duplicate refund for
    the same provider refund id does nothing.
    """
    provider_refund_id = provider_refund_id or f"{dispute_type}-{purchase.reference}"
    existing = (
        db.query(RefundDispute)
        .filter(RefundDispute.provider_refund_id == provider_refund_id)
        .first()
    )
    if existing:
        return existing

    already_refunded = purchase.refunded_minor or 0
    refundable = purchase.amount_minor - already_refunded
    amount_minor = max(min(int(amount_minor), refundable), 0)

    dispute = RefundDispute(
        purchase_id=purchase.id,
        type=dispute_type,
        amount_minor=amount_minor,
        currency=purchase.currency,
        status="processed",
        reason=reason,
        provider_refund_id=provider_refund_id,
        raised_by_admin_id=raised_by_admin,
        resolved_at=datetime.utcnow(),
    )
    db.add(dispute)
    db.flush()

    purchase.refunded_minor = already_refunded + amount_minor
    purchase.status = "refunded" if purchase.refunded_minor >= purchase.amount_minor else "partially_refunded"
    db.add(purchase)

    tx = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.purchase_id == purchase.id, PaymentTransaction.status == "captured")
        .order_by(PaymentTransaction.created_at.desc())
        .first()
    )
    if tx:
        tx.status = "refunded"
        db.add(tx)

    # Reverse the creator's earnings (proportional to the refunded amount)
    if amount_minor > 0 and purchase.amount_minor > 0 and purchase.creator_earnings_minor > 0:
        creator_reversal = (purchase.creator_earnings_minor * amount_minor) // purchase.amount_minor
        if creator_reversal > 0:
            ledger.post_refund_reversal(
                db,
                purchase,
                amount_minor=creator_reversal,
                refund_id=dispute.id,
            )

    # Full refunds revoke the entitlement; partial refunds reduce per-run packs.
    if purchase.status == "refunded":
        ent = (
            db.query(Entitlement)
            .filter(Entitlement.buyer_id == purchase.buyer_id, Entitlement.agent_id == purchase.agent_id)
            .first()
        )
        if ent:
            ent.status = "revoked"
            db.add(ent)
            sub = (
                db.query(Subscription)
                .filter(Subscription.buyer_id == purchase.buyer_id, Subscription.agent_id == purchase.agent_id)
                .order_by(Subscription.created_at.desc())
                .first()
            )
            if sub and sub.status == "active":
                sub.status = "expired"
                db.add(sub)
    elif purchase.pricing_model == "pay_per_execution" and amount_minor > 0:
        runs_to_remove = amount_minor // (purchase.amount_minor // (purchase.runs_included or 1)) if (purchase.runs_included and purchase.amount_minor) else 0
        if runs_to_remove > 0:
            ent = (
                db.query(Entitlement)
                .filter(Entitlement.buyer_id == purchase.buyer_id, Entitlement.agent_id == purchase.agent_id)
                .first()
            )
            if ent and ent.runs_remaining is not None:
                ent.runs_remaining = max(ent.runs_remaining - runs_to_remove, 0)
                db.add(ent)

    ledger.log_audit(
        db,
        raised_by_admin,
        f"{dispute_type}.processed",
        "purchase",
        purchase.id,
        {
            "amount_minor": amount_minor,
            "provider_refund_id": provider_refund_id,
            "reason": reason,
        },
    )
    return dispute
