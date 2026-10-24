"""Purge all mock/demo agents from the dev database.

Deletes every agent row and all dependent rows (versions, runs, ratings,
evaluations, approvals, pricing plans, purchases, entitlements, subscriptions,
payments, refunds, ledger entries, moderation reports, provider API keys).
Users, creator profiles, categories, and platform settings are preserved.

Run:  ./venv/bin/python scripts/purge_mock_agents.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

warnings.filterwarnings("ignore")

from app.core.database import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Agent,
    AgentEvaluation,
    AgentPricingPlan,
    AgentRating,
    AgentRun,
    AgentVersion,
    ApiKey,
    CreditTransaction,
    Entitlement,
    ModerationReport,
    Purchase,
    Subscription,
    ToolApproval,
    User,
)
from app.models.marketplace import (  # noqa: E402
    EarningsLedgerEntry,
    PaymentTransaction,
    RefundDispute,
)

db = SessionLocal()
try:
    agent_ids = [row[0] for row in db.query(Agent.id).all()]
    if not agent_ids:
        print("No agents found — nothing to purge.")
        sys.exit(0)
    print(f"Purging {len(agent_ids)} agent(s): {agent_ids}")

    purchase_ids = [
        row[0]
        for row in db.query(Purchase.id).filter(Purchase.agent_id.in_(agent_ids)).all()
    ]

    STEPS = [
        ("tool_approvals", ToolApproval, ToolApproval.agent_id, agent_ids),
        ("agent_runs", AgentRun, AgentRun.agent_id, agent_ids),
        ("agent_versions", AgentVersion, AgentVersion.agent_id, agent_ids),
        ("agent_ratings", AgentRating, AgentRating.agent_id, agent_ids),
        ("agent_evaluations", AgentEvaluation, AgentEvaluation.agent_id, agent_ids),
        ("api_keys", ApiKey, ApiKey.agent_id, agent_ids),
        (
            "credit_transactions",
            CreditTransaction,
            CreditTransaction.agent_id,
            agent_ids,
        ),
        ("agent_pricing_plans", AgentPricingPlan, AgentPricingPlan.agent_id, agent_ids),
        ("entitlements", Entitlement, Entitlement.agent_id, agent_ids),
        (
            "refund_disputes",
            RefundDispute,
            RefundDispute.purchase_id,
            purchase_ids,
        ),
        (
            "payment_transactions",
            PaymentTransaction,
            PaymentTransaction.purchase_id,
            purchase_ids,
        ),
        ("purchases", Purchase, Purchase.agent_id, agent_ids),
        ("subscriptions", Subscription, Subscription.agent_id, agent_ids),
        (
            "earnings_ledger",
            EarningsLedgerEntry,
            EarningsLedgerEntry.agent_id,
            agent_ids,
        ),
        ("moderation_reports", ModerationReport, ModerationReport.agent_id, agent_ids),
    ]

    for table, model, column, ids in STEPS:
        if not ids:
            print(f"{table}: skip (no parent ids)")
            continue
        deleted = (
            db.query(model).filter(column.in_(ids)).delete(synchronize_session=False)
        )
        db.commit()
        print(f"{table}: {deleted} row(s) deleted")

    db.query(Agent).filter(Agent.id.in_(agent_ids)).delete(synchronize_session=False)
    db.commit()
    print(f"agents: {len(agent_ids)} row(s) deleted")

    users = db.query(User.id, User.email).order_by(User.id).all()
    print("remaining users:")
    for uid, email in users:
        print(f"  {uid} {email}")
    print(f"remaining agents: {db.query(Agent).count()}")
finally:
    db.close()
