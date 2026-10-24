"""Creator earnings ledger and money services.

Invariants:
* Balances are ONLY derived from EarningsLedgerEntry rows (never stored on
  users, never editable from the frontend).
* Every business movement writes a ledger entry with a unique `reference`,
  which makes all postings idempotent (webhook retries / manual replays safe).
"""
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Agent,
    AgentPricingPlan,
    AuditLog,
    CreatorProfile,
    EarningsLedgerEntry,
    Entitlement,
    Payout,
    Purchase,
    Subscription,
)


def ensure_creator_profile(db: Session, user_id: int) -> CreatorProfile:
    row = db.query(CreatorProfile).filter(CreatorProfile.user_id == user_id).first()
    if not row:
        row = CreatorProfile(user_id=user_id, payout_currency=platform_currency_default())
        db.add(row)
        db.flush()
    return row


DEFAULT_CATEGORIES = [
    ("data-analysis", "Data Analysis", "Crunch, clean and visualize datasets"),
    ("writing", "Writing & Content", "Drafts, rewrites, blogs and brand copy"),
    ("coding", "Coding & DevOps", "Code review, tests, migrations and pipelines"),
    ("marketing", "Marketing & Growth", "Funnels, SEO, ads and growth experiments"),
    ("design", "Design & Media", "Assets, briefs, alt text and creative QA"),
    ("finance", "Finance & Ops", "Forecasts, invoices, expense and vendor automation"),
    ("support", "Customer Support", "Ticket triage, macros and knowledge-base bots"),
    ("research", "Research", "Literature sweeps and competitive intelligence"),
    ("productivity", "Productivity", "Scheduling, summarizing and inbox zero"),
    ("legal", "Legal & Compliance", "Contracts, clauses and policy checks"),
]


def ensure_categories_seeded(db: Session) -> None:
    """Idempotent category seed for fresh DBs (also covered by the alembic migration)."""
    from app.models import AgentCategory

    if db.query(AgentCategory).count() > 0:
        return
    for slug, name, description in DEFAULT_CATEGORIES:
        db.add(AgentCategory(slug=slug, name=name, description=description))
    db.flush()


def platform_currency_default() -> str:
    from app.core.config import settings

    return (settings.PLATFORM_CURRENCY or "INR").upper()


def log_audit(
    db: Session,
    actor_id: Optional[int],
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        details=details,
    )
    db.add(entry)
    return entry


def generate_reference(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def post_purchase_earnings(db: Session, purchase: Purchase) -> Optional[EarningsLedgerEntry]:
    """Post the creator's gross earnings for a captured purchase (idempotent)."""
    if purchase.creator_earnings_minor <= 0:
        return None
    existing = (
        db.query(EarningsLedgerEntry)
        .filter(
            EarningsLedgerEntry.purchase_id == purchase.id,
            EarningsLedgerEntry.entry_type == "sale",
        )
        .first()
    )
    if existing:
        return existing
    agent: Optional[Agent] = db.query(Agent).filter(Agent.id == purchase.agent_id).first()
    creator = agent.owner_id if agent else None
    if creator is None:
        return None
    return post_ledger(
        db,
        creator_id=creator,
        entry_type="sale",
        amount_minor=purchase.creator_earnings_minor,
        currency=purchase.currency,
        purchase_id=purchase.id,
        agent_id=purchase.agent_id,
        reference=f"sale:{purchase.reference}",
        note=f"Earnings from purchase {purchase.reference}",
        at=purchase.paid_at or datetime.utcnow(),
    )


def post_refund_reversal(db: Session, purchase: Purchase, amount_minor: int, refund_id: Optional[int]) -> Optional[EarningsLedgerEntry]:
    """Reverse a creator earning when a refund/chargeback is processed."""
    if amount_minor <= 0:
        return None
    agent: Optional[Agent] = db.query(Agent).filter(Agent.id == purchase.agent_id).first()
    if not agent:
        return None
    refund = None
    if refund_id:
        from app.models import RefundDispute

        refund = db.query(RefundDispute).filter(RefundDispute.id == refund_id).first()
    reversal_ref = f"refund:{refund.provider_refund_id or refund_id or purchase.reference}" if refund else f"refund:{purchase.reference}"
    return post_ledger(
        db,
        creator_id=agent.owner_id,
        entry_type="refund_reversal",
        amount_minor=-int(amount_minor),
        currency=purchase.currency,
        purchase_id=purchase.id,
        refund_id=refund_id,
        agent_id=purchase.agent_id,
        reference=reversal_ref,
        note=f"Reversal for {purchase.reference}",
    )


def post_ledger(
    db: Session,
    *,
    creator_id: int,
    entry_type: str,
    amount_minor: int,
    currency: str,
    purchase_id: Optional[int] = None,
    refund_id: Optional[int] = None,
    payout_id: Optional[int] = None,
    agent_id: Optional[int] = None,
    reference: Optional[str] = None,
    note: Optional[str] = None,
    at: Optional[datetime] = None,
) -> Optional[EarningsLedgerEntry]:
    """Append a ledger entry and stamp the running balance. Idempotent on reference."""
    if amount_minor == 0:
        return None
    # Idempotency: reject a duplicate posting for the same logical event
    if reference:
        existing = db.query(EarningsLedgerEntry).filter(EarningsLedgerEntry.reference == reference).first()
        if existing:
            return existing
    now_balance = current_balance(db, creator_id, currency)
    entry = EarningsLedgerEntry(
        creator_id=creator_id,
        entry_type=entry_type,
        amount_minor=int(amount_minor),
        currency=currency,
        balance_after_minor=now_balance + int(amount_minor),
        purchase_id=purchase_id,
        refund_id=refund_id,
        payout_id=payout_id,
        agent_id=agent_id,
        reference=reference or generate_reference(entry_type),
        note=note,
    )
    if at is not None:
        entry.created_at = at
    db.add(entry)
    db.flush()
    return entry


def current_balance(db: Session, creator_id: int, currency: Optional[str] = None) -> int:
    """Available balance = sum(ledger) − sum(payouts already debited).

    Payout debits live in the ledger too; requested payouts (not yet confirmed
    by the provider) ALSO reserve funds via a pending-payout check so creators
    cannot request overlapping payouts.
    """
    q = db.query(func.coalesce(func.sum(EarningsLedgerEntry.amount_minor), 0)).filter(
        EarningsLedgerEntry.creator_id == creator_id
    )
    if currency:
        q = q.filter(EarningsLedgerEntry.currency == currency)
    return int(q.scalar() or 0)


def pending_payout_reserve(db: Session, creator_id: int, currency: Optional[str] = None) -> int:
    """Sum of payouts still in flight (requested/processing) which must not be
    double-requested or double-paid."""
    q = db.query(func.coalesce(func.sum(Payout.amount_minor), 0)).filter(
        Payout.creator_id == creator_id,
        Payout.status.in_(["requested", "processing"]),
    )
    if currency:
        q = q.filter(Payout.currency == currency)
    return int(q.scalar() or 0)


def creator_earnings_summary(db: Session, creator_id: int, currency: Optional[str] = None) -> dict:
    """Gross / fees / net / ledger balance, always from auditable records."""
    currency = currency or platform_currency_default()

    paid_purchases = (
        db.query(Purchase)
        .join(Agent, Purchase.agent_id == Agent.id)
        .filter(
            Agent.owner_id == creator_id,
            Purchase.status.in_(["paid", "refunded", "partially_refunded"]),
        )
    )
    if currency:
        paid_purchases = paid_purchases.filter(Purchase.currency == currency)

    gross = 0
    fees = 0
    for p in paid_purchases.all():
        gross += p.amount_minor
        fees += p.platform_fee_minor

    # Refund reversals recorded on the ledger (already negative amounts applied)
    refunds_q = db.query(func.coalesce(func.sum(-EarningsLedgerEntry.amount_minor), 0)).filter(
        EarningsLedgerEntry.creator_id == creator_id,
        EarningsLedgerEntry.entry_type == "refund_reversal",
    )
    if currency:
        refunds_q = refunds_q.filter(EarningsLedgerEntry.currency == currency)
    total_reversals = int(refunds_q.scalar() or 0)

    payouts_q = db.query(func.coalesce(func.sum(-EarningsLedgerEntry.amount_minor), 0)).filter(
        EarningsLedgerEntry.creator_id == creator_id,
        EarningsLedgerEntry.entry_type == "payout",
    )
    if currency:
        payouts_q = payouts_q.filter(EarningsLedgerEntry.currency == currency)
    total_paid_out = int(payouts_q.scalar() or 0)

    reserve = pending_payout_reserve(db, creator_id, currency)
    balance = current_balance(db, creator_id, currency)
    return {
        "currency": currency,
        "gross_sales_minor": gross,
        "platform_fees_minor": fees,
        "refund_reversals_total_minor": total_reversals,
        "net_earnings_minor": gross - fees - total_reversals,
        "ledger_balance_minor": balance,
        "pending_payout_minor": reserve,
        "available_to_payout_minor": max(balance - reserve, 0),
        "total_paid_out_minor": total_paid_out,
    }


def monthly_series(db: Session, creator_id: int, currency: str, months: int = 12) -> list[dict]:
    """Earnings by calendar month (for charts)."""
    start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(days=30 * (months - 1))
    rows = (
        db.query(EarningsLedgerEntry)
        .filter(
            EarningsLedgerEntry.creator_id == creator_id,
            EarningsLedgerEntry.currency == currency,
            EarningsLedgerEntry.created_at >= start,
        )
        .all()
    )
    buckets: dict[str, int] = {}
    for r in rows:
        key = r.created_at.strftime("%Y-%m")
        buckets.setdefault(key, 0)
        if r.entry_type == "sale":
            buckets[key] += r.amount_minor
        elif r.entry_type in ("refund_reversal", "payout"):
            buckets[key] += r.amount_minor  # negative
    return [{"month": k, "net_minor": buckets[k]} for k in sorted(buckets)]


def active_plan_for(db: Session, agent_id: int) -> Optional[AgentPricingPlan]:
    return (
        db.query(AgentPricingPlan)
        .filter(AgentPricingPlan.agent_id == agent_id, AgentPricingPlan.is_active == True)  # noqa: E712
        .first()
    )


def get_entitlement(db: Session, buyer_id: int, agent_id: int) -> Optional[Entitlement]:
    ent = (
        db.query(Entitlement)
        .filter(Entitlement.buyer_id == buyer_id, Entitlement.agent_id == agent_id)
        .first()
    )
    if ent and ent.status == "active" and ent.valid_until and ent.valid_until < datetime.utcnow():
        ent.status = "expired"
        db.commit()
    return ent


def upsert_entitlement(
    db: Session,
    buyer_id: int,
    agent_id: int,
    source: str,
    purchase_id: Optional[int] = None,
    subscription_id: Optional[int] = None,
    valid_until: Optional[datetime] = None,
    add_runs: Optional[int] = None,
    runs_per_pack: Optional[int] = None,
) -> Entitlement:
    """Create or extend an entitlement (idempotent extension semantics)."""
    ent = get_entitlement(db, buyer_id, agent_id)
    if ent is None:
        ent = Entitlement(buyer_id=buyer_id, agent_id=agent_id, source=source)
        if add_runs or runs_per_pack:
            ent.runs_remaining = add_runs or runs_per_pack or 0
        db.add(ent)
        db.flush()
    else:
        if ent.status in ("revoked",):
            pass  # admin revoked; require admin re-grant
        else:
            ent.status = "active"
    if source in ("one_time", "free") and ent.source != "subscription":
        ent.source = source
    if purchase_id:
        ent.purchase_id = purchase_id
    if subscription_id:
        ent.subscription_id = subscription_id
    if source == "subscription":
        ent.source = "subscription"
        if valid_until and (not ent.valid_until or valid_until > ent.valid_until):
            ent.valid_until = valid_until
    if add_runs and ent.runs_remaining is not None:
        ent.runs_remaining += add_runs
    elif add_runs and ent.runs_remaining is None:
        ent.runs_remaining = add_runs
    db.flush()
    return ent


def subscription_period_end(interval: Optional[str], start: Optional[datetime] = None) -> Optional[datetime]:
    """Compute the next period end for month/year intervals."""
    start = start or datetime.utcnow()
    if interval == "month":
        month = start.month == 12 and 1 or start.month + 1
        year = start.year + (1 if start.month == 12 else 0)
        day = min(start.day, 28)
        return datetime(year, month, day, start.hour, start.minute, start.second)
    if interval == "year":
        return datetime(start.year + 1, start.month, min(start.day, 28), start.hour, start.minute, start.second)
    return None
