"""Real-money marketplace models.

Everything is additive to the existing schema. Money is stored in minor units
(paise for INR, cents for USD) as integers plus an ISO currency code, so all
arithmetic stays exact and auditable. Balances are *never* stored on users:
they are derived from the earnings ledger.
"""
from datetime import datetime
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import backref, relationship

from app.core.database import Base


class CreatorProfile(Base):
    """Public identity of a creator (1:1 with a user)."""
    __tablename__ = "creator_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    avatar_url = Column(String, nullable=True)
    website_url = Column(String, nullable=True)
    # Payout destination (RazorpayX contact info is provisioned at payout time)
    payout_currency = Column(String, nullable=True)           # e.g. INR
    payout_account_name = Column(String, nullable=True)
    payout_account_number = Column(String, nullable=True)     # bank/UPI account for payouts
    payout_ifsc = Column(String, nullable=True)
    payout_vpa = Column(String, nullable=True)                # UPI handle
    onboarding_status = Column(String, default="unverified")  # unverified | pending | verified
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", backref=backref("creator_profile", uselist=False))


class AgentCategory(Base):
    """Marketplace taxonomy. Seeded by migration, manageable by admins."""
    __tablename__ = "agent_categories"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AgentPricingPlan(Base):
    """Pricing for a published agent.

    model:
      - free               : no charge; runs available to any signed-in user
      - one_time           : single payment unlocks the agent forever
      - subscription       : recurring (billing_interval: month | year)
      - pay_per_execution  : buyer purchases a pack of `runs_per_pack` runs
    """
    __tablename__ = "agent_pricing_plans"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    model = Column(String, nullable=False, default="free")  # free|one_time|subscription|pay_per_execution
    currency = Column(String, nullable=False, default="INR")
    amount_minor = Column(Integer, nullable=False, default=0)
    billing_interval = Column(String, nullable=True)  # month | year (subscription only)
    runs_per_pack = Column(Integer, nullable=True)    # pay_per_execution only
    limits = Column(JSON, nullable=False, default=dict)  # {"max_runs_per_day": int}
    is_active = Column(Boolean, default=False)        # exactly one active plan per agent
    external_plan_id = Column(String, nullable=True)  # provider plan id (subscriptions)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    agent = relationship("Agent", back_populates="pricing_plans")

    __table_args__ = (
        Index("ix_pricing_plan_active", "agent_id", "is_active"),
    )


class Purchase(Base):
    """A buyer's paid order for an agent, with an immutable pricing snapshot."""
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)  # e.g. "pur_ab12cd34"
    buyer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    plan_id = Column(Integer, ForeignKey("agent_pricing_plans.id"), nullable=True)
    pricing_model = Column(String, nullable=False)   # snapshot: one_time|subscription|pay_per_execution
    currency = Column(String, nullable=False, default="INR")
    amount_minor = Column(Integer, nullable=False, default=0)
    platform_fee_minor = Column(Integer, nullable=False, default=0)
    creator_earnings_minor = Column(Integer, nullable=False, default=0)
    runs_included = Column(Integer, nullable=True)   # snapshot for pay_per_execution
    period_interval = Column(String, nullable=True)  # subscription snapshot
    status = Column(String, default="created")       # created|paid|failed|refunded|partially_refunded|free
    payment_provider = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)
    refunded_minor = Column(Integer, nullable=False, default=0)

    buyer = relationship("User", foreign_keys=[buyer_id])
    agent = relationship("Agent", back_populates="purchases")
    plan = relationship("AgentPricingPlan")


class Entitlement(Base):
    """Grants a buyer access to an agent. One row per (buyer, agent)."""
    __tablename__ = "entitlements"

    id = Column(Integer, primary_key=True, index=True)
    buyer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    source = Column(String, nullable=False, default="one_time")  # one_time|subscription|pay_per_pack|free
    status = Column(String, default="active")  # active|expired|cancelled|revoked
    runs_remaining = Column(Integer, nullable=True)  # pay_per_execution balance
    valid_until = Column(DateTime, nullable=True)    # subscription period end
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    buyer = relationship("User", foreign_keys=[buyer_id])
    agent = relationship("Agent")
    subscription = relationship("Subscription", foreign_keys=[subscription_id])

    __table_args__ = (
        UniqueConstraint("buyer_id", "agent_id", name="uq_entitlement_buyer_agent"),
    )


class Subscription(Base):
    """Recurring access to an agent (provider-driven or platform-tracked renewals)."""
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    buyer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    plan_id = Column(Integer, ForeignKey("agent_pricing_plans.id"), nullable=True)
    provider = Column(String, nullable=True)
    provider_subscription_id = Column(String, unique=True, nullable=True, index=True)
    status = Column(String, default="active")  # active|cancelled|expired|past_due
    interval = Column(String, nullable=True)   # month | year
    currency = Column(String, nullable=False, default="INR")
    amount_minor = Column(Integer, nullable=False, default=0)
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    plan = relationship("AgentPricingPlan")
    entitlement = relationship("Entitlement", back_populates="subscription")


class PaymentTransaction(Base):
    """Provider payment/attempt record — the bridge between gateway and purchases."""
    __tablename__ = "payment_transactions"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=False, default="razorpay")
    provider_order_id = Column(String, index=True, nullable=False)
    provider_payment_id = Column(String, unique=True, index=True, nullable=True)
    provider_subscription_id = Column(String, index=True, nullable=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True, index=True)
    currency = Column(String, nullable=False, default="INR")
    amount_minor = Column(Integer, nullable=False, default=0)
    status = Column(String, default="created")  # created|captured|failed|refunded
    payment_method = Column(String, nullable=True)
    verified = Column(String, default="unverified")  # unverified|signature|provider|webhook
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RefundDispute(Base):
    """Refunds and chargebacks against purchases."""
    __tablename__ = "refund_disputes"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False, index=True)
    type = Column(String, default="refund")  # refund | chargeback
    amount_minor = Column(Integer, nullable=False, default=0)
    currency = Column(String, nullable=False, default="INR")
    status = Column(String, default="pending")  # pending | processed | rejected | failed
    reason = Column(Text, nullable=True)
    provider_refund_id = Column(String, nullable=True, index=True)
    raised_by_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    purchase = relationship("Purchase", back_populates="refunds")


class EarningsLedgerEntry(Base):
    """Append-only creator earnings ledger. Balances are SUM()-derived only.

    amount_minor > 0 => money owed to creator grows (a sale).
    amount_minor < 0 => reversal (refund) or payout debit.
    """
    __tablename__ = "earnings_ledger"

    id = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    entry_type = Column(String, nullable=False)  # sale | refund_reversal | payout | fee_correction
    amount_minor = Column(Integer, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    balance_after_minor = Column(Integer, nullable=False)  # running balance keyed by creator+currency
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=True, index=True)
    refund_id = Column(Integer, ForeignKey("refund_disputes.id"), nullable=True)
    payout_id = Column(Integer, ForeignKey("payouts.id"), nullable=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    reference = Column(String, unique=True, nullable=True, index=True)  # idempotency key
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    purchase = relationship("Purchase", foreign_keys=[purchase_id])
    payout = relationship("Payout", foreign_keys=[payout_id])


class Payout(Base):
    """A creator payout request. `paid` only with a provider reference/confirmation."""
    __tablename__ = "payouts"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount_minor = Column(Integer, nullable=False)
    currency = Column(String, nullable=False, default="INR")
    status = Column(String, default="requested")  # requested|processing|paid|failed|cancelled
    provider = Column(String, nullable=True)      # razorpay_x | manual
    provider_payout_id = Column(String, nullable=True, index=True)
    destination = Column(String, nullable=True)   # masked destination summary
    failure_reason = Column(Text, nullable=True)
    requested_by_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    requested_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)

    creator = relationship("User", foreign_keys=[creator_id])
    __table_args__ = (
        Index("ix_payout_creator_status", "creator_id", "status"),
    )


class WebhookEvent(Base):
    """Raw provider webhook events, keyed for exactly-once processing."""
    __tablename__ = "webhook_events"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, nullable=False, default="razorpay")
    event_id = Column(String, nullable=False, index=True)  # provider event id (may be empty)
    event_type = Column(String, nullable=False)
    signature_valid = Column(Boolean, default=True)
    payload = Column(JSON, nullable=True)
    processed_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_webhook_provider_event"),
    )


class AuditLog(Base):
    """Append-only audit trail for critical actions (money, publish, admin)."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String, nullable=False, index=True)      # e.g. agent.publish, admin.refund
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    details = Column(JSON, nullable=True)
    ip = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ModerationReport(Base):
    """User-submitted reports on listings, triaged by admins."""
    __tablename__ = "moderation_reports"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(String, nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String, default="open")  # open | resolved | dismissed
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)


class PlatformSetting(Base):
    """Key/value runtime settings (commission, moderation mode, policies)."""
    __tablename__ = "platform_settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(String, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


Purchase.refunds = relationship(
    "RefundDispute", back_populates="purchase", foreign_keys=[RefundDispute.purchase_id]
)
Payout.ledger_entries = relationship(
    "EarningsLedgerEntry", back_populates="payout", foreign_keys=[EarningsLedgerEntry.payout_id]
)
EarningsLedgerEntry.payout = relationship(
    "Payout", foreign_keys=[EarningsLedgerEntry.payout_id], back_populates="ledger_entries"
)
