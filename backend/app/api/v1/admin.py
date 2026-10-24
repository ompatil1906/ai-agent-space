"""Admin API: moderation, orders, refunds, payouts, platform settings, audit."""
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_admin_user
from app.models import (
    Agent,
    EarningsLedgerEntry,
    ModerationReport,
    Payout,
    Purchase,
    User,
)
from app.schemas import (
    AdminAgentStatusIn,
    AdminPayoutActionIn,
    AdminRefundIn,
    AuditLogPublic,
    ModerationReportPublic,
    PlatformSettingsPublic,
    PlatformSettingsUpdate,
)
from app.services import ledger, payments
from app.services.refunds import apply_refund

router = APIRouter()


@router.get("/agents")
def admin_list_agents(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
    status: Optional[str] = Query(None, pattern="^(draft|pending_review|published|rejected|suspended)$"),
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(50, ge=1, le=200),
) -> Any:
    q = db.query(Agent)
    if status:
        q = q.filter(Agent.status == status)
    if search:
        q = q.filter(Agent.name.ilike(f"%{search}%"))
    agents = q.order_by(Agent.updated_at.desc()).offset(skip).limit(limit).all()
    out = []
    for a in agents:
        owner = db.query(User).filter(User.id == a.owner_id).first()
        plan = ledger.active_plan_for(db, a.id)
        sales = (
            db.query(func.count(Purchase.id))
            .filter(Purchase.agent_id == a.id, Purchase.status == "paid")
            .scalar()
            or 0
        )
        out.append(
            {
                "id": a.id,
                "slug": a.slug,
                "name": a.name,
                "owner_email": owner.email if owner else None,
                "status": a.status,
                "is_featured": a.is_featured,
                "pricing_model": plan.model if plan else "free",
                "amount_minor": plan.amount_minor if plan else 0,
                "currency": plan.currency if plan else settings.PLATFORM_CURRENCY,
                "sales_count": sales,
                "updated_at": a.updated_at,
                "moderation_note": a.moderation_note,
            }
        )
    return out


@router.post("/agents/{agent_id}/status")
def admin_set_agent_status(
    agent_id: int,
    body: AdminAgentStatusIn,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
) -> Any:
    """Moderation actions: approve / reject / suspend / restore / feature."""
    action = body.status
    if action not in ("approved", "rejected", "published", "pending_review", "suspended", "draft", "featured", "unfeatured"):
        raise HTTPException(status_code=400, detail="Unknown action")
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if action == "featured":
        agent.is_featured = True
        agent.featured_at = datetime.utcnow()
    elif action == "unfeatured":
        agent.is_featured = False
    else:
        agent.status = action
        agent.moderation_note = body.note or agent.moderation_note
        if action == "published":
            agent.is_published = True
            agent.is_public = True
            agent.published_at = agent.published_at or datetime.utcnow()
        elif action == "approved" and not agent.is_published:
            # approve a pending_review listing into the live marketplace
            agent.status = "published"
            agent.is_published = True
            agent.is_public = True
            agent.published_at = agent.published_at or datetime.utcnow()
        else:
            agent.is_published = False
    db.commit()
    ledger.log_audit(db, admin.id, f"admin.agent.{action}", "agent", agent.id, {"note": body.note})
    db.commit()
    return {"id": agent.id, "status": agent.status, "is_featured": agent.is_featured}


@router.get("/orders")
def admin_list_orders(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
    status_filter: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
) -> Any:
    q = db.query(Purchase)
    if status_filter:
        q = q.filter(Purchase.status == status_filter)
    purchases = q.order_by(Purchase.created_at.desc()).limit(limit).all()
    out = []
    for p in purchases:
        buyer = db.query(User).filter(User.id == p.buyer_id).first()
        agent = db.query(Agent).filter(Agent.id == p.agent_id).first()
        out.append(
            {
                "id": p.id,
                "reference": p.reference,
                "buyer_email": buyer.email if buyer else None,
                "agent_name": agent.name if agent else None,
                "agent_slug": agent.slug if agent else None,
                "pricing_model": p.pricing_model,
                "amount_minor": p.amount_minor,
                "platform_fee_minor": p.platform_fee_minor,
                "creator_earnings_minor": p.creator_earnings_minor,
                "currency": p.currency,
                "status": p.status,
                "created_at": p.created_at,
                "paid_at": p.paid_at,
                "refunded_minor": p.refunded_minor,
            }
        )
    return out


@router.post("/refunds")
def admin_create_refund(
    body: AdminRefundIn,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
) -> Any:
    """Issue a refund. When the gateway is configured the refund is created on
    the provider (real money back); otherwise recorded as a manual refund with
    provider_refund_id unset. Entitlements are revoked accordingly."""
    q = db.query(Purchase)
    if body.purchase_reference:
        q = q.filter(Purchase.reference == body.purchase_reference)
    purchase = q.order_by(Purchase.created_at.desc()).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.status not in ("paid", "partially_refunded"):
        raise HTTPException(status_code=400, detail=f"Purchase is not refundable (status={purchase.status})")

    amount = body.amount_minor or (purchase.amount_minor - (purchase.refunded_minor or 0))
    provider_refund_id = None
    if payments.payments_enabled():
        from app.models import PaymentTransaction

        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.purchase_id == purchase.id, PaymentTransaction.status == "captured")
            .order_by(PaymentTransaction.created_at.desc())
            .first()
        )
        client = payments.razorpay_client()
        payment_id = tx.provider_payment_id if tx else None
        if payment_id:
            try:
                refund_resp = client.create_refund(payment_id, amount_minor=amount)
                provider_refund_id = refund_resp.get("id")
            except payments.PaymentProviderError as e:
                provider_refund_id = None
                body_note = str(e)
                dispute = apply_refund(
                    db, purchase,
                    amount_minor=amount,
                    provider_refund_id=None,
                    reason=f"{body.reason or ''} (provider refund failed: {body_note}) — recorded as manual",
                    raised_by_admin=admin.id,
                    dispute_type=body.type,
                )
                db.commit()
                return {
                    "id": dispute.id, "status": "recorded", "provider_refund_id": None,
                    "amount_minor": amount, "warning": "Provider refund failed; recorded as manual platform refund.",
                }
    else:
        provider_refund_id = f"manual-{ledger.generate_reference('rf')}"

    dispute = apply_refund(
        db,
        purchase,
        amount_minor=amount,
        provider_refund_id=provider_refund_id,
        reason=body.reason,
        raised_by_admin=admin.id,
        dispute_type=body.type,
    )
    db.commit()
    return {"id": dispute.id, "status": dispute.status, "provider_refund_id": dispute.provider_refund_id, "amount_minor": dispute.amount_minor}


@router.get("/payouts")
def admin_list_payouts(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
    limit: int = Query(100, ge=1, le=500),
) -> Any:
    payouts = db.query(Payout).order_by(Payout.requested_at.desc()).limit(limit).all()
    out = []
    for p in payouts:
        creator = db.query(User).filter(User.id == p.creator_id).first()
        out.append(
            {
                "id": p.id,
                "reference": p.reference,
                "creator_email": creator.email if creator else None,
                "amount_minor": p.amount_minor,
                "currency": p.currency,
                "destination": p.destination,
                "status": p.status,
                "provider": p.provider,
                "provider_payout_id": p.provider_payout_id,
                "failure_reason": p.failure_reason,
                "requested_at": p.requested_at,
                "processed_at": p.processed_at,
            }
        )
    return out


@router.post("/payouts/{payout_id}/action")
def admin_payout_action(
    payout_id: int,
    body: AdminPayoutActionIn,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
) -> Any:
    """Drive the payout state machine.

    mark_paid requires a provider_payout_id (provider confirmation) OR RazorpayX
    fetch-confirmation; a payout is NEVER marked paid without provider evidence.
    """
    payout = db.query(Payout).filter(Payout.id == payout_id).first()
    if not payout:
        raise HTTPException(status_code=404, detail="Payout not found")

    if body.action == "mark_processing":
        if payout.status not in ("requested",):
            raise HTTPException(status_code=400, detail=f"Cannot process payout with status={payout.status}")
        # Prefer RazorpayX real payout when configured
        if payments.payments_enabled() and settings.RAZORPAYX_KEY_ID and settings.RAZORPAYX_ACCOUNT_NUMBER:
            try:
                client = payments.razorpayx_client()
                profile = ledger.ensure_creator_profile(db, payout.creator_id)
                db.flush()
                from app.models import CreatorProfile

                profile_row = db.query(CreatorProfile).filter(CreatorProfile.user_id == payout.creator_id).first()
                if not profile_row or not (profile_row.payout_account_number or profile_row.payout_vpa):
                    raise HTTPException(status_code=400, detail="Creator has no payout destination configured")
                fund_account = None
                if profile_row.payout_account_number:
                    fund_account = {
                        "account_type": "bank_account",
                        "bank_account": {
                            "name": profile_row.payout_account_name or creator_name(db, payout.creator_id),
                            "ifsc_code": profile_row.payout_ifsc,
                            "account_number": profile_row.payout_account_number,
                        },
                    }
                elif profile_row.payout_vpa:
                    fund_account = {
                        "account_type": "vpa",
                        "vpa": {"address": profile_row.payout_vpa},
                    }
                resp = client.xpayout_create(
                    account_number=settings.RAZORPAYX_ACCOUNT_NUMBER,
                    amount_minor=payout.amount_minor,
                    currency=payout.currency,
                    contact_name=profile_row.payout_account_name or creator_name(db, payout.creator_id),
                    contact_email=creator_email(db, payout.creator_id),
                    fund_account=fund_account,
                )
                payout.provider = "razorpay_x"
                payout.provider_payout_id = resp.get("id")
                payout.status = "processing" if resp.get("status") in ("pending", "processed") else payout.status
                if resp.get("status") == "processed":
                    # RazorpayX confirmed the transfer
                    _complete_payout(db, payout, provider="razorpay_x", reference=resp.get("id"), admin=admin)
            except payments.PaymentProviderError as e:
                payout.status = "requested"
                payout.failure_reason = str(e)
                db.add(payout)
                db.commit()
                raise HTTPException(status_code=502, detail=f"RazorpayX failed: {e}")
            except Exception as e:
                db.rollback()
                raise HTTPException(status_code=500, detail=str(e))
        else:
            payout.status = "processing"
        ledger.log_audit(db, admin.id, "admin.payout.mark_processing", "payout", payout.id, {"note": body.note})
    elif body.action == "mark_paid":
        if payout.status not in ("requested", "processing"):
            raise HTTPException(status_code=400, detail=f"Cannot complete payout with status={payout.status}")
        if not body.provider_payout_id:
            raise HTTPException(
                status_code=400,
                detail="mark_paid requires provider_payout_id — payouts must never be confirmed without provider evidence",
            )
        provider = payout.provider or "manual"
        _complete_payout(db, payout, provider=provider, reference=body.provider_payout_id, admin=admin)
    elif body.action == "mark_failed":
        payout.status = "failed"
        payout.failure_reason = body.note
        ledger.log_audit(db, admin.id, "admin.payout.failed", "payout", payout.id, {"note": body.note})
    elif body.action == "cancel":
        payout.status = "cancelled"
        ledger.log_audit(db, admin.id, "admin.payout.cancelled", "payout", payout.id, {"note": body.note})
    db.commit()
    db.refresh(payout)
    return {
        "id": payout.id,
        "reference": payout.reference,
        "status": payout.status,
        "provider_payout_id": payout.provider_payout_id,
        "failure_reason": payout.failure_reason,
    }


def _complete_payout(db: Session, payout: Payout, provider: str, reference: str, admin: User) -> None:
    """The ONLY path that moves a payout to 'paid' — requires provider evidence and
    posts the ledger debit exactly once."""
    existing = (
        db.query(EarningsLedgerEntry)
        .filter(EarningsLedgerEntry.payout_id == payout.id, EarningsLedgerEntry.entry_type == "payout")
        .first()
    )
    if payout.status != "paid":
        ledger.post_ledger(
            db,
            creator_id=payout.creator_id,
            entry_type="payout",
            amount_minor=-payout.amount_minor,
            currency=payout.currency,
            payout_id=payout.id,
            reference=f"payout:{reference}",
            note=f"Payout {payout.reference} via {provider}",
        )
    payout.status = "paid"
    payout.provider = provider
    payout.provider_payout_id = reference
    payout.processed_at = datetime.utcnow()
    db.add(payout)
    ledger.log_audit(db, admin.id, "admin.payout.paid", "payout", payout.id, {
        "provider_payout_id": reference,
        "provider": provider,
    })


def creator_email(db: Session, user_id: int) -> str:
    user = db.query(User).filter(User.id == user_id).first()
    return user.email if user else ""


def creator_name(db: Session, user_id: int) -> str:
    user = db.query(User).filter(User.id == user_id).first()
    return (user.full_name or user.email) if user else "Creator"


@router.get("/settings", response_model=PlatformSettingsPublic)
def admin_get_settings(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
) -> Any:
    return PlatformSettingsPublic(
        commission_bps=payments.platform_commission_bps(db),
        currency=payments.platform_currency(),
        min_payout_minor=settings.PLATFORM_MIN_PAYOUT_MINOR,
        moderation=settings.MARKETPLACE_MODERATION or "off",
        payment_mode=payments.payment_mode() if payments.payments_enabled() else None,
        payments_enabled=payments.payments_enabled(),
    )


@router.put("/settings", response_model=PlatformSettingsPublic)
def admin_update_settings(
    body: PlatformSettingsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
) -> Any:
    from app.models import PlatformSetting

    changed = False
    if body.commission_bps is not None:
        row = db.query(PlatformSetting).filter(PlatformSetting.key == "commission_bps").first()
        if not row:
            row = PlatformSetting(key="commission_bps")
            db.add(row)
        row.value = str(body.commission_bps)
        row.updated_by = admin.id
        changed = True
    if body.min_payout_minor is not None:
        row = db.query(PlatformSetting).filter(PlatformSetting.key == "min_payout_minor").first()
        if not row:
            row = PlatformSetting(key="min_payout_minor")
            db.add(row)
        row.value = str(body.min_payout_minor)
        row.updated_by = admin.id
        settings.PLATFORM_MIN_PAYOUT_MINOR = body.min_payout_minor  # runtime override is stateless-safe
        changed = True
    if body.moderation is not None:
        row = db.query(PlatformSetting).filter(PlatformSetting.key == "moderation").first()
        if not row:
            row = PlatformSetting(key="moderation")
            db.add(row)
        row.value = body.moderation
        row.updated_by = admin.id
        settings.MARKETPLACE_MODERATION = body.moderation
        changed = True
    if changed:
        ledger.log_audit(db, admin.id, "admin.settings.update", "settings", None, body.model_dump(exclude_unset=True))
    db.commit()
    return admin_get_settings(db=db, admin=admin)


@router.get("/reports", response_model=List[ModerationReportPublic])
def admin_list_reports(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
    status_filter: str = "open",
) -> Any:
    q = db.query(ModerationReport)
    if status_filter and status_filter != "all":
        q = q.filter(ModerationReport.status == status_filter)
    return q.order_by(ModerationReport.created_at.desc()).limit(200).all()


@router.post("/reports/{report_id}/resolve")
def admin_resolve_report(
    report_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
    note: Optional[str] = None,
    outcome: str = Query("resolved", pattern="^(resolved|dismissed)$"),
) -> Any:
    report = db.query(ModerationReport).filter(ModerationReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = outcome
    report.resolved_by = admin.id
    report.resolution_note = note
    report.resolved_at = datetime.utcnow()
    db.commit()
    ledger.log_audit(db, admin.id, "admin.report.resolve", "moderation_report", report.id, {"outcome": outcome})
    db.commit()
    return {"id": report.id, "status": report.status}


@router.get("/audit", response_model=List[AuditLogPublic])
def admin_audit_log(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
    limit: int = Query(200, ge=1, le=1000),
) -> Any:
    from app.models import AuditLog

    return (
        db.query(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/stats")
def admin_platform_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
) -> Any:
    paid = db.query(Purchase).filter(Purchase.status.in_(["paid", "partially_refunded", "refunded"])).all()
    gross = sum(p.amount_minor for p in paid)
    fees = sum(p.platform_fee_minor for p in paid)
    refunds = sum(p.refunded_minor for p in paid)
    return {
        "currency": payments.platform_currency(),
        "total_agents": db.query(func.count(Agent.id)).scalar() or 0,
        "published_agents": db.query(func.count(Agent.id)).filter(Agent.status == "published").scalar() or 0,
        "pending_review": db.query(func.count(Agent.id)).filter(Agent.status == "pending_review").scalar() or 0,
        "total_users": db.query(func.count(User.id)).scalar() or 0,
        "total_paid_purchases": len(paid),
        "gross_volume_minor": gross,
        "platform_revenue_minor": fees,
        "refunded_minor": refunds,
        "payments_enabled": payments.payments_enabled(),
        "payment_mode": payments.payment_mode() if payments.payments_enabled() else None,
    }
