"""Slug and run-authorization helpers for the real-money marketplace."""
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Agent, AgentPricingPlan, AgentRun, Entitlement, Purchase
from app.services import ledger


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:60] or "agent"


def ensure_unique_slug(db: Session, name: str, exclude_agent_id: Optional[int] = None) -> str:
    """Generate a unique slug from the name; appends short random suffix on collision."""
    base = slugify(name)
    candidate = base
    query = db.query(Agent).filter(Agent.slug == candidate)
    if exclude_agent_id:
        query = query.filter(Agent.id != exclude_agent_id)
    tries = 0
    while query.first() is not None:
        tries += 1
        candidate = f"{base}-{uuid.uuid4().hex[:6]}".replace("--", "-")
        if tries > 50:  # pragma: no cover - practically unreachable
            candidate = f"{base}-{uuid.uuid4().hex}"
        query = db.query(Agent).filter(Agent.slug == candidate)
        if exclude_agent_id:
            query = query.filter(Agent.id != exclude_agent_id)
    return candidate


class RunDenied(Exception):
    """Raised when a user may not execute an agent (with an HTTP-ready status)."""

    def __init__(self, status_code: int, detail: str, extra: Optional[dict] = None):
        self.status_code = status_code
        self.detail = detail
        self.pricing = (extra or {}).get("pricing")
        super().__init__(detail)


def authorize_run(db: Session, agent: Agent, user, client_request_id: Optional[str] = None) -> Optional[Entitlement]:
    """Marketplace execution authorization (replaces legacy credit metering).

    Rules:
    * Creators run their own agents free.
    * `free` plan agents are runnable by any signed-in user.
    * Paid plans require an active entitlement:
        - one_time   : lifetime access
        - subscription: active until valid_until
        - pay_per_execution: consumes 1 run from the pack balance (atomically)
    * Daily usage caps from the plan `limits` apply to non-owner users.
    * Retries with the same client_request_id reuse the prior run (no double charge).

    Returns the Entitlement row for billable runs (None for free/owner), and
    may safely be called BEFORE creating the AgentRun row. Bill the run via
    `bill_run` after the run row exists; call `refund_run` on execution failure.
    """
    if agent.owner_id == user.id:
        return None

    plan: Optional[AgentPricingPlan] = ledger.active_plan_for(db, agent.id)
    plan_model = plan.model if plan else "free"
    if plan_model == "free":
        return None

    ent = ledger.get_entitlement(db, user.id, agent.id)
    if not ent or ent.status != "active":
        raise RunDenied(
            402,
            "Purchase required to run this agent",
            extra={"pricing": plan_pricing_info(plan)},
        )

    if ent.source == "subscription" and ent.valid_until and ent.valid_until < datetime.utcnow():
        ent.status = "expired"
        db.commit()
        raise RunDenied(402, "Your subscription has expired", extra={"pricing": plan_pricing_info(plan)})

    # Retry idempotency: same client_request_id on the same agent+user reuses the run
    if client_request_id:
        existing = (
            db.query(AgentRun)
            .filter(
                AgentRun.user_id == user.id,
                AgentRun.agent_id == agent.id,
                AgentRun.client_request_id == client_request_id,
            )
            .order_by(AgentRun.created_at.desc())
            .first()
        )
        if existing:
            raise RunIdempotentReplay(existing)

    # Daily cap
    limits = (plan.limits or {}) if plan else {}
    max_per_day = limits.get("max_runs_per_day")
    if max_per_day:
        day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        used = (
            db.query(func.count(AgentRun.id))
            .filter(
                AgentRun.agent_id == agent.id,
                AgentRun.user_id == user.id,
                AgentRun.created_at >= day_start,
            )
            .scalar()
            or 0
        )
        if used >= int(max_per_day):
            raise RunDenied(
                429,
                f"Daily usage limit reached ({max_per_day} runs/day for your plan)",
                extra={"pricing": plan_pricing_info(plan)},
            )

    # pay-per-execution: decrement the run balance atomically
    debited = False
    if ent.source == "pay_per_pack" and ent.runs_remaining is not None:
        updated = (
            db.query(Entitlement)
            .filter(
                Entitlement.id == ent.id,
                Entitlement.runs_remaining > 0,
            )
            .update({"runs_remaining": Entitlement.runs_remaining - 1}, synchronize_session=False)
        )
        if not updated:
            raise RunDenied(
                402,
                "Your run balance is used up — buy another pack to continue",
                extra={"pricing": plan_pricing_info(plan)},
            )
        db.commit()
        debited = True
    db.refresh(ent)
    if debited:
        ent._ppe_debited = True  # type: ignore[attr-defined]
    return ent


def plan_pricing_info(plan: Optional[AgentPricingPlan]) -> Optional[dict]:
    if not plan:
        return None
    return {
        "model": plan.model,
        "currency": plan.currency,
        "amount_minor": plan.amount_minor,
        "runs_per_pack": plan.runs_per_pack,
        "billing_interval": plan.billing_interval,
    }


class RunIdempotentReplay(Exception):
    def __init__(self, existing_run: AgentRun):
        self.run = existing_run
        super().__init__(client_request_id_hint(existing_run))


def client_request_id_hint(run: AgentRun) -> str:
    return run.client_request_id or ""


def bill_run(db: Session, run: AgentRun, agent: Agent, entitlement: Optional[Entitlement]) -> None:
    """Create a billable-run record linking the agent run to its pay-per-execution debit."""
    if entitlement is None:
        return
    plan = ledger.active_plan_for(db, agent.id)
    cost = plan.amount_minor // (plan.runs_per_pack or 1) if (plan and plan.runs_per_pack) else (plan.amount_minor if plan else 0)
    run.entitlement_id = entitlement.id
    run.execution_cost_minor = max(cost, 0)
    run.charge_status = "charged"
    db.add(run)


def refund_run(db: Session, run: AgentRun) -> None:
    """Refund a failed billable run: restore the pack balance, mark charge refunded."""
    if run.charge_status != "charged" or not run.entitlement_id:
        return
    ent = db.query(Entitlement).filter(Entitlement.id == run.entitlement_id).first()
    if ent and ent.runs_remaining is not None:
        ent.runs_remaining += 1
        db.add(ent)
    run.charge_status = "refunded"
    run.execution_cost_minor = 0
    db.add(run)
    db.commit()
