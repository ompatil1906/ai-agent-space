"""Creator Dashboard API: earnings, ledger, payouts, profile."""
import csv
import io
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import (
    Agent,
    AgentPricingPlan,
    CreatorProfile,
    EarningsLedgerEntry,
    Entitlement,
    Payout,
    Purchase,
    Subscription,
    User,
)
from app.schemas import (
    CreatorProfileIn,
    CreatorProfilePublic,
    CreatorOverviewResponse,
    LedgerEntryPublic,
    PayoutPublic,
    PayoutRequestIn,
)
from app.services import ledger, payments
from app.services.ledger import log_audit

router = APIRouter()


@router.get("/profile", response_model=CreatorProfilePublic)
def get_creator_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    profile = ledger.ensure_creator_profile(db, current_user.id)
    db.commit()
    out = CreatorProfilePublic.model_validate(profile)
    out.user_email = current_user.email
    return out


@router.put("/profile", response_model=CreatorProfilePublic)
def update_creator_profile(
    body: CreatorProfileIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    profile = ledger.ensure_creator_profile(db, current_user.id)
    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(profile, field, value)
    # Onboarding status moves to pending once payout details are provided.
    has_account = bool(profile.payout_account_number or profile.payout_vpa)
    if has_account and profile.onboarding_status == "unverified":
        profile.onboarding_status = "pending"
    db.commit()
    db.refresh(profile)
    out = CreatorProfilePublic.model_validate(profile)
    out.user_email = current_user.email
    return out


@router.get("/overview", response_model=CreatorOverviewResponse)
def creator_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Creator dashboard totals — always derived from the auditable ledger."""
    ledger.ensure_creator_profile(db, current_user.id)
    currency = payments.platform_currency()
    summary = ledger.creator_earnings_summary(db, current_user.id, currency)

    my_agents = db.query(Agent).filter(Agent.owner_id == current_user.id).all()
    agent_ids = [a.id for a in my_agents]
    published_agents = sum(1 for a in my_agents if a.status == "published")

    total_sales = (
        db.query(func.count(Purchase.id))
        .join(Agent, Purchase.agent_id == Agent.id)
        .filter(Agent.owner_id == current_user.id, Purchase.status == "paid")
        .scalar()
        or 0
    )
    active_subs = (
        db.query(func.count(Entitlement.id))
        .join(Agent, Entitlement.agent_id == Agent.id)
        .filter(Agent.owner_id == current_user.id, Entitlement.status == "active", Entitlement.source == "subscription")
        .scalar()
        or 0
    )
    distinct_buyers = (
        db.query(func.count(func.distinct(Purchase.buyer_id)))
        .join(Agent, Purchase.agent_id == Agent.id)
        .filter(Agent.owner_id == current_user.id, Purchase.status == "paid")
        .scalar()
        or 0
    )

    # Per-agent revenue breakdown
    per_agent_rows = (
        db.query(
            Agent.id,
            Agent.name,
            Agent.slug,
            func.count(Purchase.id),
            func.coalesce(func.sum(Purchase.amount_minor), 0),
        )
        .join(Purchase, Purchase.agent_id == Agent.id)
        .filter(Agent.owner_id == current_user.id, Purchase.status == "paid")
        .group_by(Agent.id, Agent.name, Agent.slug)
        .all()
    )
    per_agent = [
        {
            "agent_id": r[0],
            "name": r[1],
            "slug": r[2],
            "sales": r[3],
            "gross_minor": r[4],
        }
        for r in sorted(per_agent_rows, key=lambda r: r[4], reverse=True)
    ]

    return CreatorOverviewResponse(
        **summary,
        total_sales=int(total_sales),
        active_subscriptions=int(active_subs),
        published_agents=published_agents,
        customers=int(distinct_buyers),
        monthly_series=ledger.monthly_series(db, current_user.id, currency),
        per_agent=per_agent,
    )


@router.get("/earnings", response_model=List[LedgerEntryPublic])
def creator_ledger(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    entry_type: Optional[str] = Query(None, pattern="^(sale|refund_reversal|payout|fee_correction)$"),
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    skip: int = 0,
    limit: int = Query(200, ge=1, le=1000),
    format: Optional[str] = Query(None, pattern="^csv$"),
) -> Any:
    """Earnings ledger (filterable, CSV export via ?format=csv)."""
    q = db.query(EarningsLedgerEntry).filter(EarningsLedgerEntry.creator_id == current_user.id)
    if entry_type:
        q = q.filter(EarningsLedgerEntry.entry_type == entry_type)
    if from_date:
        try:
            q = q.filter(EarningsLedgerEntry.created_at >= datetime.strptime(from_date, "%Y-%m-%d"))
        except ValueError:
            raise HTTPException(status_code=400, detail="from_date must be YYYY-MM-DD")
    if to_date:
        try:
            end = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            q = q.filter(EarningsLedgerEntry.created_at <= end)
        except ValueError:
            raise HTTPException(status_code=400, detail="to_date must be YYYY-MM-DD")
    q = q.order_by(EarningsLedgerEntry.created_at.desc())
    rows = q.offset(skip).limit(limit).all()

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "created_at", "entry_type", "amount_minor", "currency", "balance_after_minor", "reference", "note"])
        for r in rows:
            writer.writerow(
                [r.id, r.created_at.isoformat(), r.entry_type, r.amount_minor, r.currency, r.balance_after_minor, r.reference, r.note]
            )
        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=earnings-{current_user.id}.csv"},
        )
    return rows


# --- Pricing plans (creator side) ------------------------------------------------

def _owned_agent(db: Session, agent_id: int, current_user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or agent.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agent not found or not owned")
    return agent


def _plan_out(db: Session, plan) -> dict:
    return {
        "id": plan.id,
        "agent_id": plan.agent_id,
        "model": plan.model,
        "currency": plan.currency,
        "amount_minor": plan.amount_minor,
        "billing_interval": plan.billing_interval,
        "runs_per_pack": plan.runs_per_pack,
        "limits": plan.limits or {},
        "is_active": bool(plan.is_active),
        "created_at": plan.created_at,
    }


@router.get("/agents/{agent_id}/pricing")
def list_agent_plans(
    agent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    agent = _owned_agent(db, agent_id, current_user)
    plans = (
        db.query(AgentPricingPlan)
        .filter(AgentPricingPlan.agent_id == agent.id)
        .order_by(AgentPricingPlan.created_at.desc())
        .all()
    )
    return [_plan_out(db, p) for p in plans]


@router.post("/agents/{agent_id}/pricing", status_code=201)
def upsert_agent_plan(
    agent_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Create or replace the agent's pricing plan.

    * One active plan per agent — activating this plan deactivates the others.
    * free            : amount must be 0
    * one_time        : amount_minor > 0
    * subscription    : amount_minor > 0 + billing_interval (month|year)
    * pay_per_execution: amount_minor > 0 + runs_per_pack >= 1
    """
    from app.schemas import PricingPlanIn

    agent = _owned_agent(db, agent_id, current_user)
    try:
        plan_in = PricingPlanIn(**body)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid pricing plan: {e}")

    model = plan_in.model
    if model == "free":
        amount = 0
        runs_per_pack = None
        interval = None
    elif model == "one_time":
        if plan_in.amount_minor <= 0:
            raise HTTPException(status_code=400, detail="one_time price must be greater than zero")
        amount = plan_in.amount_minor
        runs_per_pack = None
        interval = None
    elif model == "subscription":
        if plan_in.amount_minor <= 0:
            raise HTTPException(status_code=400, detail="subscription price must be greater than zero")
        if plan_in.billing_interval not in ("month", "year"):
            raise HTTPException(status_code=400, detail="subscription needs billing_interval of month or year")
        amount = plan_in.amount_minor
        runs_per_pack = None
        interval = plan_in.billing_interval
    elif model == "pay_per_execution":
        if plan_in.amount_minor <= 0:
            raise HTTPException(status_code=400, detail="pay_per_execution price must be greater than zero")
        if not plan_in.runs_per_pack or plan_in.runs_per_pack < 1:
            raise HTTPException(status_code=400, detail="pay_per_execution needs runs_per_pack >= 1")
        amount = plan_in.amount_minor
        runs_per_pack = plan_in.runs_per_pack
        interval = None
    else:
        raise HTTPException(status_code=400, detail="Unknown pricing model")

    # Deactivate previous plans: there is exactly one active plan at a time
    db.query(AgentPricingPlan).filter(AgentPricingPlan.agent_id == agent.id).update({"is_active": False})
    plan = AgentPricingPlan(
        agent_id=agent.id,
        model=model,
        currency=(plan_in.currency or payments.platform_currency()).upper(),
        amount_minor=amount,
        billing_interval=interval,
        runs_per_pack=runs_per_pack,
        limits=plan_in.limits or {},
        is_active=True,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    log_audit(db, current_user.id, "agent.pricing.set", "agent", agent.id, {
        "model": model, "amount_minor": amount,
    })
    db.commit()
    return _plan_out(db, plan)


# --- Payouts --------------------------------------------------------------------

@router.get("/payouts", response_model=List[PayoutPublic])
def list_my_payouts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    return (
        db.query(Payout)
        .filter(Payout.creator_id == current_user.id)
        .order_by(Payout.requested_at.desc())
        .limit(100)
        .all()
    )


@router.post("/payouts", response_model=PayoutPublic, status_code=201)
def request_payout(
    body: PayoutRequestIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Creator requests a payout of their available ledger balance.

    The payout stays `requested` until the payment provider confirms the
    money movement (admin confirm with provider reference / RazorpayX) — the
    platform never claims a payout has been paid without that confirmation.
    """
    profile = ledger.ensure_creator_profile(db, current_user.id)
    db.flush()
    currency = (body.currency or profile.payout_currency or payments.platform_currency()).upper()
    balance = ledger.current_balance(db, current_user.id, currency)
    pending = ledger.pending_payout_reserve(db, current_user.id, currency)
    available = balance - pending

    min_payout = settings.PLATFORM_MIN_PAYOUT_MINOR
    if body.amount_minor > available:
        raise HTTPException(
            status_code=400,
            detail=f"Requested amount exceeds available balance ({available} {currency} minor units)",
        )
    if body.amount_minor < min_payout:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum payout is {min_payout} minor units",
        )
    if not (profile.payout_account_number or profile.payout_vpa):
        raise HTTPException(status_code=400, detail="Add payout account details before requesting a payout")

    destination = (
        profile.payout_vpa
        if profile.payout_vpa
        else (f"****{profile.payout_account_number[-4:]}" if profile.payout_account_number else None)
    )
    payout = Payout(
        reference=ledger.generate_reference("po"),
        creator_id=current_user.id,
        amount_minor=body.amount_minor,
        currency=currency,
        status="requested",
        destination=destination,
    )
    db.add(payout)
    db.flush()
    log_audit(db, current_user.id, "payout.requested", "payout", payout.id, {
        "amount_minor": payout.amount_minor,
        "currency": currency,
    })
    db.commit()
    db.refresh(payout)
    return payout
