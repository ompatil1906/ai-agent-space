"""Checkout: real-money purchase flow (Razorpay).

Server-side rules enforced here:
* The frontend never receives secrets and its "success" callback is NEVER
  trusted alone: every capture is verified by HMAC signature AND (when the
  provider is reachable) confirmed against the Razorpay API.
* Entitlements are granted only from verified captures (callback verification
  or signed webhook — both provider-signed, server-verified).
* Webhook deliveries are deduplicated by event id (exactly-once).
* Purchases/transactions carry unique references for atomic idempotency.
* Free agents claim without any payment call.
"""
import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import (
    Agent,
    AgentPricingPlan,
    Entitlement,
    PaymentTransaction,
    Purchase,
    Subscription,
    User,
    WebhookEvent,
)
from app.schemas import (
    CheckoutIntentRequest,
    CheckoutIntentResponse,
    CheckoutStatusResponse,
    VerifyCheckoutRequest,
    VerifyCheckoutResponse,
)
from app.services import ledger, payments

logger = logging.getLogger(__name__)

router = APIRouter()


def _plan_for_checkout(db: Session, agent: Agent, plan_id: Optional[int]) -> AgentPricingPlan:
    if plan_id:
        plan = (
            db.query(AgentPricingPlan)
            .filter(AgentPricingPlan.id == plan_id, AgentPricingPlan.agent_id == agent.id)
            .first()
        )
        if not plan or not plan.is_active:
            raise HTTPException(status_code=400, detail="Pricing plan not available")
        return plan
    plan = ledger.active_plan_for(db, agent.id)
    if not plan:
        raise HTTPException(status_code=400, detail="This agent has no purchasable plan")
    return plan


def _pricing_dict(plan: AgentPricingPlan) -> dict:
    return {
        "model": plan.model,
        "currency": plan.currency,
        "amount_minor": plan.amount_minor,
        "billing_interval": plan.billing_interval,
        "runs_per_pack": plan.runs_per_pack,
        "limits": plan.limits or {},
    }


@router.post("/intents", response_model=CheckoutIntentResponse)
def create_checkout_intent(
    body: CheckoutIntentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Start checkout for a published agent.

    * free plan  -> no payment call; entitlement granted immediately
    * paid plans -> creates a provider order / provider subscription and returns
      the public key id + order id for the gateway widget
    * provider unconfigured -> clear 503; never fakes a transaction
    """
    agent = db.query(Agent).filter(Agent.id == body.agent_id, Agent.status == "published").first()
    if not agent:
        raise HTTPException(status_code=404, detail="Published agent not found")
    if agent.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="You own this agent")

    plan = _plan_for_checkout(db, agent, body.plan_id)

    if plan.model == "free":
        ledger.upsert_entitlement(db, current_user.id, agent.id, source="free")
        created_at_day = datetime.utcnow().strftime("%Y%m%d")
        reference = f"pur_free_{agent.id}_{current_user.id}_{created_at_day}"
        existing = db.query(Purchase).filter(Purchase.reference == reference).first()
        if not existing:
            existing = Purchase(
                reference=reference,
                buyer_id=current_user.id,
                agent_id=agent.id,
                plan_id=plan.id,
                pricing_model="free",
                currency=plan.currency,
                amount_minor=0,
                platform_fee_minor=0,
                creator_earnings_minor=0,
                status="free",
            )
            db.add(existing)
        db.commit()
        return CheckoutIntentResponse(
            mode="free",
            message="Free agent — added to your workspace.",
            purchase_reference=existing.reference,
            agent_slug=agent.slug,
            name=agent.name,
            pricing=_pricing_dict(plan),
        )

    existing_ent = ledger.get_entitlement(db, current_user.id, agent.id)
    if plan.model == "one_time" and existing_ent and existing_ent.status == "active":
        return CheckoutIntentResponse(
            mode="already_owned",
            message="You already have access to this agent.",
            agent_slug=agent.slug,
            name=agent.name,
            pricing=_pricing_dict(plan),
        )

    if not payments.payments_enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                "Real payments are not configured on this deployment. "
                "Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to enable checkout. "
                "No purchase is simulated."
            ),
        )

    client = payments.razorpay_client()
    purchase = Purchase(
        reference=ledger.generate_reference("pur"),
        buyer_id=current_user.id,
        agent_id=agent.id,
        plan_id=plan.id,
        pricing_model=plan.model,
        currency=plan.currency,
        amount_minor=plan.amount_minor,
        status="created",
        payment_provider="razorpay",
    )
    if plan.model == "pay_per_execution":
        purchase.runs_included = plan.runs_per_pack
    db.add(purchase)
    db.flush()

    try:
        if plan.model == "subscription":
            if not plan.external_plan_id:
                period = "monthly" if plan.billing_interval == "month" else "yearly"
                provider_plan = client.create_plan(
                    period=period,
                    interval=1,
                    item_name=f"{agent.name} ({plan.billing_interval})",
                    amount_minor=plan.amount_minor,
                    currency=plan.currency,
                )
                plan.external_plan_id = provider_plan["id"]
                db.add(plan)
                db.flush()
            sub_payload = client.create_subscription(plan.external_plan_id, current_user.email)
            subscription = Subscription(
                buyer_id=current_user.id,
                agent_id=agent.id,
                plan_id=plan.id,
                provider="razorpay",
                provider_subscription_id=sub_payload["id"],
                status=sub_payload.get("status", "created"),
                interval=plan.billing_interval,
                currency=plan.currency,
                amount_minor=plan.amount_minor,
            )
            db.add(subscription)
            db.flush()
            purchase.status = "created"
            db.add(purchase)
            db.commit()
            return CheckoutIntentResponse(
                mode="subscription",
                provider="razorpay",
                provider_mode=payments.payment_mode(),
                razorpay_key_id=settings.RAZORPAY_KEY_ID,
                order_id=sub_payload["id"],
                purchase_reference=purchase.reference,
                agent_slug=agent.slug,
                name=agent.name,
                pricing=_pricing_dict(plan),
                message="Complete the subscription in the Razorpay window (test mode until keys go live).",
            )

        order = client.create_order(
            amount_minor=plan.amount_minor,
            currency=plan.currency,
            receipt=purchase.reference,
            notes={"agent_id": str(agent.id), "buyer_id": str(current_user.id)},
        )
        tx = PaymentTransaction(
            provider="razorpay",
            provider_order_id=order["id"],
            purchase_id=purchase.id,
            user_id=current_user.id,
            agent_id=agent.id,
            currency=plan.currency,
            amount_minor=plan.amount_minor,
            status="created",
        )
        db.add(tx)
        db.commit()
        return CheckoutIntentResponse(
            mode="paid",
            provider="razorpay",
            provider_mode=payments.payment_mode(),
            razorpay_key_id=settings.RAZORPAY_KEY_ID,
            order_id=order["id"],
            purchase_reference=purchase.reference,
            agent_slug=agent.slug,
            name=agent.name,
            pricing=_pricing_dict(plan),
        )
    except payments.PaymentProviderError as e:
        db.rollback()
        logger.warning("Payment provider error: %s", e)
        raise HTTPException(status_code=502, detail=f"Payment provider error: {e}")
    finally:
        # no external session to close; placeholder for future client pooling
        pass


@router.post("/verify", response_model=VerifyCheckoutResponse)
def verify_checkout(
    body: VerifyCheckoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """Frontend checkout callback verification (server-side, twice-over)."""
    purchase = db.query(Purchase).filter(Purchase.reference == body.purchase_reference).first()
    if not purchase or purchase.buyer_id != current_user.id:
        raise HTTPException(status_code=404, detail="Checkout not found")
    if purchase.status in ("paid", "partially_refunded"):
        slug = _agent_slug(db, purchase.agent_id)
        return VerifyCheckoutResponse(
            status="already_paid",
            message="This purchase is already verified.",
            purchase_reference=purchase.reference,
            agent_slug=slug,
            redirect_to=f"/agents/{slug}",
        )
    if purchase.pricing_model == "subscription":
        return VerifyCheckoutResponse(
            status="pending",
            message="Subscription confirmation arrives from the provider (webhook).",
            purchase_reference=purchase.reference,
            agent_slug=_agent_slug(db, purchase.agent_id),
        )
    if not payments.payments_enabled():
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")

    client = payments.razorpay_client()

    # 1) Cryptographic verification — HMAC recomputed server-side
    sig_ok = payments.verify_checkout_signature(
        body.razorpay_order_id or "",
        body.razorpay_payment_id or "",
        body.razorpay_signature or "",
    )
    if not sig_ok:
        _tx_failed(db, purchase, body.razorpay_payment_id, "checkout signature verification failed")
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    payment: dict = {}
    verified_mode = "signature"
    # 2) Independent provider confirmation: payment status + exact amount
    try:
        payment = client.fetch_payment(body.razorpay_payment_id)
        payment_status = payment.get("status")
        payment_amount = int(payment.get("amount") or 0)
        if payment_status not in ("captured", "authorized"):
            _tx_failed(db, purchase, body.razorpay_payment_id, f"provider status: {payment_status}")
            return VerifyCheckoutResponse(
                status="failed",
                message=f"Payment is not complete (provider status: {payment_status}). Access was not granted.",
                purchase_reference=purchase.reference,
                agent_slug=_agent_slug(db, purchase.agent_id),
            )
        if payment_amount != purchase.amount_minor:
            _tx_failed(db, purchase, body.razorpay_payment_id, "amount mismatch")
            raise HTTPException(status_code=400, detail="Payment amount does not match the listing price")
        verified_mode = "provider"
    except payments.PaymentProviderError as e:
        # Provider unreachable: the provider-signed callback signature alone is
        # valid cryptographic proof; the signed webhook double-confirms later.
        logger.warning("Provider confirmation fetch failed (continuing on signature proof): %s", e)

    _tx_captured(
        db,
        purchase,
        body.razorpay_payment_id,
        payment.get("method"),
        order_id=body.razorpay_order_id,
        via=verified_mode,
    )
    db.commit()
    slug = _agent_slug(db, purchase.agent_id)
    return VerifyCheckoutResponse(
        status="paid",
        message="Payment verified — access granted.",
        purchase_reference=purchase.reference,
        agent_slug=slug,
        redirect_to=f"/agents/{slug}",
    )


@router.get("/{reference}/status", response_model=CheckoutStatusResponse)
def checkout_status(
    reference: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Any:
    purchase = db.query(Purchase).filter(Purchase.reference == reference).first()
    if not purchase or purchase.buyer_id != current_user.id:
        raise HTTPException(status_code=404, detail="Checkout not found")
    agent = db.query(Agent).filter(Agent.id == purchase.agent_id).first()
    resp = CheckoutStatusResponse(
        status="pending" if purchase.status == "created" else purchase.status,
        purchase_reference=purchase.reference,
        amount_minor=purchase.amount_minor,
        currency=purchase.currency,
        provider_mode=payments.payment_mode() if payments.payments_enabled() else None,
        agent_slug=agent.slug if agent else None,
    )
    if purchase.status == "paid":
        resp.message = "Payment verified — access granted."
        resp.redirect_to = f"/agents/{agent.slug}"
    elif purchase.status == "failed":
        resp.message = "Payment failed — no access was granted."
    elif purchase.status == "free":
        resp.message = "Free agent — added to your workspace."
        resp.redirect_to = f"/agents/{agent.slug}"
    return resp


# --- Webhook -------------------------------------------------------------------

@router.post("/webhooks/razorpay")
async def razorpay_webhook(
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    """Signed provider webhook: verifies raw-body HMAC, dedupes by event id and
    applies state changes exactly once. Missing webhook secret => rejected."""
    body_bytes = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not payments.payments_enabled():
        return {"status": "ignored", "reason": "gateway not configured"}
    if not payments.verify_webhook_signature(body_bytes, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    event_type = payload.get("event", "")
    dedupe_key = str(payload.get("id") or f"{event_type}:{payload.get('created_at')}")
    existing = (
        db.query(WebhookEvent)
        .filter(WebhookEvent.provider == "razorpay", WebhookEvent.event_id == dedupe_key)
        .first()
    )
    if existing and existing.processed_at:
        return {"status": "duplicate_ignored"}

    webhook_row = existing or WebhookEvent(provider="razorpay", event_id=dedupe_key)
    webhook_row.event_type = event_type
    webhook_row.signature_valid = True
    webhook_row.payload = payload
    if not existing:
        db.add(webhook_row)
        db.flush()

    try:
        if event_type in ("payment.captured", "order.paid", "subscription.activated"):
            _handle_payment_captured(db, payload, via="webhook")
        elif event_type == "payment.failed":
            _handle_payment_failed(db, payload)
        elif event_type == "subscription.charged":
            _handle_subscription_charged(db, payload)
        elif event_type in ("subscription.cancelled", "subscription.halt"):
            _handle_subscription_cancelled(db, payload)
        elif event_type in ("refund.processed", "refund.speed_changed"):
            _handle_refund_processed(db, payload)
        # other event types: recorded, no state change
    except Exception as e:
        db.rollback()
        # refresh row & record error (never 500 on the webhook channel without recording)
        webhook_row = (
            db.query(WebhookEvent)
            .filter(WebhookEvent.provider == "razorpay", WebhookEvent.event_id == dedupe_key)
            .first()
        ) or webhook_row
        webhook_row.error = str(e)[:2000]
        db.commit()
        logger.exception("Webhook processing failed")
        raise HTTPException(status_code=500, detail="Webhook processing failed")

    webhook_row.processed_at = datetime.utcnow()
    db.commit()
    return {"status": "processed", "event": event_type}


# --- internals ---------------------------------------------------------------

def _agent_slug(db: Session, agent_id: int) -> Optional[str]:
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    return agent.slug if agent else None


def _grant_access(db: Session, purchase: Purchase, payment_row: Optional[PaymentTransaction], via: str) -> None:
    plan = purchase.plan or ledger.active_plan_for(db, purchase.agent_id)
    purchase.status = "paid"
    purchase.paid_at = purchase.paid_at or datetime.utcnow()
    # Commission split snapshot (idempotent — never re-split a purchase)
    if not (purchase.platform_fee_minor or purchase.creator_earnings_minor):
        bps = payments.platform_commission_bps(db)
        purchase.platform_fee_minor, purchase.creator_earnings_minor = payments.compute_split(
            purchase.amount_minor, bps
        )
    db.add(purchase)

    if payment_row is not None:
        payment_row.status = "captured"
        payment_row.verified = via
        db.add(payment_row)

    if purchase.pricing_model == "subscription":
        sub = (
            db.query(Subscription)
            .filter(
                Subscription.buyer_id == purchase.buyer_id,
                Subscription.agent_id == purchase.agent_id,
            )
            .order_by(Subscription.created_at.desc())
            .first()
        )
        interval = purchase.period_interval or (plan.billing_interval if plan else "month")
        if sub:
            sub.status = "active"
            sub.current_period_start = datetime.utcnow()
            sub.current_period_end = ledger.subscription_period_end(interval)
            db.add(sub)
            ledger.upsert_entitlement(
                db,
                purchase.buyer_id,
                purchase.agent_id,
                source="subscription",
                purchase_id=purchase.id,
                subscription_id=sub.id,
                valid_until=sub.current_period_end,
            )
        else:
            ledger.upsert_entitlement(
                db,
                purchase.buyer_id,
                purchase.agent_id,
                source="subscription",
                purchase_id=purchase.id,
                valid_until=ledger.subscription_period_end(interval),
            )
    elif purchase.pricing_model == "pay_per_execution":
        ledger.upsert_entitlement(
            db,
            purchase.buyer_id,
            purchase.agent_id,
            source="pay_per_pack",
            purchase_id=purchase.id,
            runs_per_pack=purchase.runs_included,
        )
    else:
        ledger.upsert_entitlement(
            db,
            purchase.buyer_id,
            purchase.agent_id,
            source="one_time",
            purchase_id=purchase.id,
        )

    ledger.post_purchase_earnings(db, purchase)
    ledger.log_audit(
        db,
        None,
        "purchase.paid",
        "purchase",
        purchase.id,
        {
            "buyer_id": purchase.buyer_id,
            "agent_id": purchase.agent_id,
            "amount_minor": purchase.amount_minor,
            "via": via,
        },
    )


def _tx_captured(db: Session, purchase: Purchase, payment_id: Optional[str], method: Optional[str], order_id: Optional[str], via: str) -> None:
    tx = None
    if payment_id:
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_payment_id == payment_id)
            .first()
        )
    if tx is None:
        tx = PaymentTransaction(
            provider="razorpay",
            provider_order_id=order_id or f"order-{purchase.reference}",
            provider_payment_id=payment_id,
            purchase_id=purchase.id,
            user_id=purchase.buyer_id,
            agent_id=purchase.agent_id,
            currency=purchase.currency,
            amount_minor=purchase.amount_minor,
            status="captured",
        )
        db.add(tx)
        db.flush()
    if order_id:
        tx.provider_order_id = order_id
    tx.payment_method = method
    _grant_access(db, purchase, tx, via)


def _tx_failed(db: Session, purchase: Purchase, payment_id: Optional[str], reason: str) -> None:
    if payment_id:
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_payment_id == payment_id)
            .first()
        )
        if tx:
            tx.status = "failed"
            tx.error = reason
            db.add(tx)
    if purchase.status == "created":
        purchase.status = "failed"
        db.add(purchase)
    db.commit()


def _handle_payment_captured(db: Session, payload: dict, via: str) -> None:
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {}) or {}
    order_entity = payload.get("payload", {}).get("order", {}).get("entity", {}) or {}
    purchase = None

    receipt = entity.get("receipt") or order_entity.get("receipt")
    if receipt:
        purchase = db.query(Purchase).filter(Purchase.reference == receipt).first()
    if purchase is None and entity.get("order_id"):
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_order_id == entity["order_id"])
            .first()
        )
        if tx and tx.purchase_id:
            purchase = db.query(Purchase).filter(Purchase.id == tx.purchase_id).first()
    if purchase is None and entity.get("id"):
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_payment_id == entity["id"])
            .first()
        )
        if tx and tx.purchase_id:
            purchase = db.query(Purchase).filter(Purchase.id == tx.purchase_id).first()
    if purchase is None:
        logger.info("payment capture did not match any purchase: %s", entity.get("id"))
        return
    if purchase.status in ("paid", "partially_refunded"):
        return  # idempotent
    if int(entity.get("amount") or 0) != purchase.amount_minor:
        logger.warning(
            "webhook amount mismatch for %s: %s != %s",
            purchase.reference,
            entity.get("amount"),
            purchase.amount_minor,
        )
        return
    _tx_captured(
        db,
        purchase,
        entity.get("id"),
        entity.get("method"),
        entity.get("order_id"),
        via="webhook",
    )


def _handle_payment_failed(db: Session, payload: dict) -> None:
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {}) or {}
    purchase = None
    receipt = entity.get("receipt")
    if receipt:
        purchase = db.query(Purchase).filter(Purchase.reference == receipt).first()
    if purchase is None and entity.get("order_id"):
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_order_id == entity["order_id"])
            .first()
        )
        if tx and tx.purchase_id:
            purchase = db.query(Purchase).filter(Purchase.id == tx.purchase_id).first()
    if purchase is None:
        return
    if purchase.status == "created":
        purchase.status = "failed"
        db.add(purchase)
    if entity.get("id"):
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_payment_id == entity["id"])
            .first()
        )
        if tx:
            tx.status = "failed"
            tx.error = entity.get("error_description") or "provider reported failure"
            db.add(tx)


def _handle_subscription_charged(db: Session, payload: dict) -> None:
    sub_entity = payload.get("payload", {}).get("subscription", {}).get("entity", {}) or {}
    payment_entity = payload.get("payload", {}).get("payment", {}).get("entity", {}) or {}
    sub = None
    if sub_entity.get("id"):
        sub = (
            db.query(Subscription)
            .filter(Subscription.provider_subscription_id == sub_entity["id"])
            .first()
        )
    if sub is None:
        logger.info("subscription.charged for unknown subscription %s", sub_entity.get("id"))
        return
    plan = (
        db.query(AgentPricingPlan).filter(AgentPricingPlan.id == sub.plan_id).first()
        if sub.plan_id
        else ledger.active_plan_for(db, sub.agent_id)
    )
    interval = sub.interval or (plan.billing_interval if plan else "month")
    period_start = datetime.utcnow()
    period_end = ledger.subscription_period_end(interval, period_start)
    sub.status = "active"
    sub.current_period_start = period_start
    sub.current_period_end = period_end
    db.add(sub)

    bps = payments.platform_commission_bps(db)
    fee, earn = payments.compute_split(sub.amount_minor, bps)
    purchase = Purchase(
        reference=ledger.generate_reference("pur"),
        buyer_id=sub.buyer_id,
        agent_id=sub.agent_id,
        plan_id=plan.id if plan else None,
        pricing_model="subscription",
        currency=sub.currency,
        amount_minor=sub.amount_minor,
        platform_fee_minor=fee,
        creator_earnings_minor=earn,
        period_interval=interval,
        status="paid",
        payment_provider="razorpay",
        paid_at=period_start,
    )
    db.add(purchase)
    db.flush()

    if payment_entity.get("id"):
        tx = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.provider_payment_id == payment_entity["id"])
            .first()
        )
        if not tx:
            tx = PaymentTransaction(
                provider="razorpay",
                provider_order_id=payment_entity.get("order_id") or sub.provider_subscription_id or "subscription",
                provider_payment_id=payment_entity["id"],
                provider_subscription_id=sub.provider_subscription_id,
                purchase_id=purchase.id,
                user_id=sub.buyer_id,
                agent_id=sub.agent_id,
                currency=sub.currency,
                amount_minor=sub.amount_minor,
                status="captured",
                verified="webhook",
            )
            db.add(tx)
        db.flush()

    ledger.upsert_entitlement(
        db,
        sub.buyer_id,
        sub.agent_id,
        source="subscription",
        purchase_id=purchase.id,
        subscription_id=sub.id,
        valid_until=period_end,
    )
    ledger.post_purchase_earnings(db, purchase)
    ledger.log_audit(
        db, None, "subscription.charged", "subscription", sub.id,
        {"period_end": period_end.isoformat() if period_end else None},
    )


def _handle_subscription_cancelled(db: Session, payload: dict) -> None:
    sub_entity = payload.get("payload", {}).get("subscription", {}).get("entity", {}) or {}
    sub = None
    if sub_entity.get("id"):
        sub = (
            db.query(Subscription)
            .filter(Subscription.provider_subscription_id == sub_entity["id"])
            .first()
        )
    if sub is None:
        return
    sub.status = "cancelled"
    sub.cancelled_at = datetime.utcnow()
    db.add(sub)
    ent = db.query(Entitlement).filter(Entitlement.subscription_id == sub.id).first()
    if ent:
        # "cancel_at_period_end" keeps access until valid_until; immediate halt/cancel revokes now.
        cancel_at = sub_entity.get("cancel_at")
        if cancel_at and sub_entity.get("status") in ("cancelled", "halted") and int(cancel_at) <= datetime.utcnow().timestamp():
            ent.status = "cancelled"
        elif sub_entity.get("status") == "cancelled" and not cancel_at:
            ent.status = "cancelled"
        db.add(ent)
    ledger.log_audit(db, None, "subscription.cancelled", "subscription", sub.id)


def _handle_refund_processed(db: Session, payload: dict) -> None:
    refund_entity = payload.get("payload", {}).get("refund", {}).get("entity", {}) or {}
    payment_id = refund_entity.get("payment_id")
    if not payment_id:
        return
    tx = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.provider_payment_id == payment_id)
        .first()
    )
    if not tx or not tx.purchase_id:
        return
    purchase = db.query(Purchase).filter(Purchase.id == tx.purchase_id).first()
    if not purchase:
        return
    from app.services.refunds import apply_refund

    apply_refund(
        db,
        purchase,
        amount_minor=int(refund_entity.get("amount") or 0),
        provider_refund_id=refund_entity.get("id") or payment_id,
        reason="Provider webhook: refund.processed",
        raised_by_admin=None,
        dispute_type="refund",
    )
