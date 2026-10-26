"""Temporary showcase seed — fills the marketplace with realistic demo data.

What it creates (idempotent — safe to re-run):
  1. Showcase users: a creator ("NovaForge Labs") and three buyers, all under
     *@showcase.dev, sharing password `Showcase@2026`. The account owner
     (patilom1906@gmail.com) owns 2 agents and purchases 2 things.
  2. Eight marketplace-ready agents with full listing payloads (tagline,
     problem statement, features, use cases, example prompts, FAQs, usage
     instructions, system prompts) and pricing plans covering every model:
     free / one_time / subscription / pay_per_execution.
  3. Clearly-labeled Showcase MCP servers for the owner and the creator.
  4. Social proof: verified + unverified ratings with reviews, view counts,
     featured placements.
  5. Money flows using REAL platform logic (compute_split, post_purchase_
     earnings, apply_refund, upsert_entitlement, subscription_period_end),
     mirroring checkout._grant_access exactly, so the earnings ledger,
     admin orders and creator dashboard stay internally consistent:
       - one_time purchases by several buyers
       - active subscriptions with mock provider subscription ids
       - pay_per_execution packs with runs_remaining balances
       - one processed partial refund (reverses creator earnings too)
       - one PAID payout (with provider evidence) + one requested payout
  6. Run history per agent (tokens, latency, success rate) and LLM-as-judge
     evaluation rows for the Quality checks panel.
  7. Audit entries and one open moderation report for the admin console.

`--purge` removes ONLY showcase-marked data: @showcase.dev users, agents they
own, agents tagged "showcase-demo", Showcase-named MCP servers and the mock
provider key. Real accounts (RT Checker, rt_* trio, patilom1906@gmail.com
non-showcase data) are never touched.

Usage (from backend/):
    venv/bin/python scripts/seed_showcase.py          # seed
    venv/bin/python scripts/seed_showcase.py --purge  # remove showcase data
"""

import argparse
import os
import random
import sys
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import (  # noqa: E402
    Agent,
    AgentCategory,
    AgentEvaluation,
    AgentPricingPlan,
    AgentRating,
    AgentRun,
    AgentVersion,
    AuditLog,
    ApiKey,
    CreditTransaction,
    Entitlement,
    MCPServer,
    ModerationReport,
    ProviderKey,
    Purchase,
    Payout,
    RefundDispute,
    Subscription,
    ToolApproval,
    User,
)
from app.models.marketplace import (  # noqa: E402
    CreatorProfile,
    EarningsLedgerEntry,
    PaymentTransaction,
)
from app.services import ledger, payments, refunds  # noqa: E402

DB = SessionLocal()
NOW = datetime.utcnow()

SHOWCASE_PASSWORD = "Showcase@2026"
SHOWCASE_TAG = "showcase-demo"
OWNER_EMAIL = "patilom1906@gmail.com"

FEATURED = {"support-triage-copilot", "sql-analyst-pro", "standup-recap-digest"}
VIEW_COUNTS = {  # stable per-slug so re-runs don't shuffle numbers
    "support-triage-copilot": 1284,
    "invoice-line-item-auditor": 862,
    "contract-clause-summarizer": 1209,
    "competitor-intelligence-briefs": 648,
    "blog-outline-engine": 1712,
    "ad-copy-tester": 733,
    "sql-analyst-pro": 1547,
    "standup-recap-digest": 926,
}
RUN_COUNTS = {
    "support-triage-copilot": 26,
    "invoice-line-item-auditor": 18,
    "contract-clause-summarizer": 15,
    "competitor-intelligence-briefs": 12,
    "blog-outline-engine": 20,
    "ad-copy-tester": 9,
    "sql-analyst-pro": 34,
    "standup-recap-digest": 14,
}


def days_ago(days: int, hours_jitter: int = 0) -> datetime:
    return NOW - timedelta(
        days=days,
        hours=random.randint(0, hours_jitter) if hours_jitter else 0,
        minutes=random.randint(0, 59),
    )


# ---------------------------------------------------------------------------
# Users / profiles / MCP servers
# ---------------------------------------------------------------------------

def ensure_user(email: str, full_name: str, role: str = "customer") -> User:
    user = DB.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            email=email,
            hashed_password=get_password_hash(SHOWCASE_PASSWORD),
            full_name=full_name,
            role=role,
            is_active=True,
        )
        DB.add(user)
        DB.flush()
    elif role and user.role != role:
        user.role = role
        DB.flush()
    return user


def sync_creator_profile(user: User, display_name: str, bio: str, vpa: str, website: str) -> None:
    profile = ledger.ensure_creator_profile(DB, user.id)
    if user.email.endswith("@showcase.dev"):
        profile.display_name = display_name
        profile.bio = bio
        profile.website_url = website
        profile.payout_vpa = profile.payout_vpa or vpa
        profile.payout_currency = profile.payout_currency or payments.platform_currency()
        profile.payout_account_name = profile.payout_account_name or display_name
        profile.onboarding_status = "verified"
        profile.is_verified = True
    else:
        # Only fill blanks on the real account owner — never stomp user data.
        profile.display_name = profile.display_name or display_name
        profile.bio = profile.bio or bio
    DB.flush()


def ensure_mcp_server(owner: User, name: str, category: str, description: str, config: dict) -> MCPServer:
    server = DB.query(MCPServer).filter(MCPServer.owner_id == owner.id, MCPServer.name == name).first()
    if not server:
        server = MCPServer(
            owner_id=owner.id,
            name=name,
            description=description,
            config=config,
            category=category,
            is_public=True,
            last_status="healthy",
            last_checked_at=NOW,
        )
        DB.add(server)
        DB.flush()
    server.description = description
    server.config = config
    server.last_status = "healthy"
    return server


# ---------------------------------------------------------------------------
# Agents / versions / plans
# ---------------------------------------------------------------------------

def make_version(agent: Agent, owner_id: int) -> None:
    if DB.query(AgentVersion).filter(AgentVersion.agent_id == agent.id).first():
        return
    snapshot = {
        "name": agent.name,
        "description": agent.description,
        "system_prompt": agent.system_prompt,
        "model_name": agent.model_name,
        "temperature": agent.temperature,
        "tools_config": agent.tools_config or [],
        "memory_config": agent.memory_config or {},
        "workflow_config": agent.workflow_config or {},
        "max_steps": agent.max_steps,
        "autonomy_level": agent.autonomy_level,
        "sandbox_enabled": bool(agent.sandbox_enabled),
        "advanced_config": agent.advanced_config or {},
        "is_public": agent.is_public,
        "is_published": agent.is_published,
        "price": agent.price,
    }
    DB.add(
        AgentVersion(
            agent_id=agent.id,
            version_number=1,
            name=agent.name,
            description=agent.description,
            system_prompt=agent.system_prompt,
            model_name=agent.model_name,
            temperature=agent.temperature,
            tools_config=agent.tools_config or [],
            memory_config=agent.memory_config or {},
            workflow_config=agent.workflow_config or {},
            snapshot=snapshot,
            created_by=owner_id,
            change_note="Initial listing snapshot",
        )
    )
    DB.flush()


def ensure_plan(agent: Agent, model: str, amount_minor: int, *, billing_interval=None, runs_per_pack=None) -> AgentPricingPlan:
    plan = DB.query(AgentPricingPlan).filter(AgentPricingPlan.agent_id == agent.id).first()
    if not plan:
        plan = AgentPricingPlan(
            agent_id=agent.id,
            model=model,
            currency=payments.platform_currency(),
            amount_minor=amount_minor,
            billing_interval=billing_interval,
            runs_per_pack=runs_per_pack,
            limits={},
            is_active=True,
        )
        DB.add(plan)
        DB.flush()
    plan.is_active = True
    return plan


def seed_agents_for(owner: User, spec: dict) -> tuple[Agent, AgentPricingPlan] | None:
    slug = spec["slug"]
    agent = DB.query(Agent).filter(Agent.slug == slug).first()
    if agent and agent.owner_id != owner.id:
        print(f"  WARN slug '{slug}' already owned by user {agent.owner_id} — skipped")
        return None
    if not agent:
        agent = Agent(
            slug=slug,
            name=spec["listing"]["name"],
            description=spec["listing"].get("description"),
            owner_id=owner.id,
        )
        DB.add(agent)
        DB.flush()

    for field, value in spec["listing"].items():
        setattr(agent, field, value)
    agent.tags = (spec["listing"].get("tags") or []) + [SHOWCASE_TAG]
    agent.status = "published"
    agent.is_published = True
    agent.is_public = True
    agent.is_featured = slug in FEATURED
    if agent.is_featured:
        agent.featured_at = agent.featured_at or days_ago(2)
    agent.published_at = agent.published_at or days_ago(random.randint(25, 45))
    agent.created_at = agent.created_at or agent.published_at
    DB.flush()
    make_version(agent, owner.id)

    plan = ensure_plan(
        agent,
        spec["plan_model"],
        spec["amount_minor"],
        billing_interval=spec.get("billing_interval"),
        runs_per_pack=spec.get("runs_per_pack"),
    )
    return agent, plan


# ---------------------------------------------------------------------------
# Money flows (mirrors checkout._grant_access)
# ---------------------------------------------------------------------------

def _split(amount_minor: int) -> tuple[int, int]:
    return payments.compute_split(amount_minor, payments.platform_commission_bps(DB))


def seed_payment_for(purchase: Purchase, days: int, *, provider_subscription_id: str | None = None) -> None:
    tx = (
        DB.query(PaymentTransaction)
        .filter(PaymentTransaction.purchase_id == purchase.id, PaymentTransaction.status == "captured")
        .first()
    )
    if tx:
        return
    paid_at = purchase.paid_at or days_ago(days)
    DB.add(
        PaymentTransaction(
            provider="razorpay",
            provider_order_id=f"order_mock_{uuid.uuid4().hex[:12]}",
            provider_payment_id=f"pay_mock_{uuid.uuid4().hex[:12]}",
            provider_subscription_id=provider_subscription_id,
            purchase_id=purchase.id,
            user_id=purchase.buyer_id,
            agent_id=purchase.agent_id,
            currency=purchase.currency,
            amount_minor=purchase.amount_minor,
            status="captured",
            payment_method="upi",
            verified="provider",
            created_at=paid_at,
        )
    )
    DB.flush()


def seed_one_time_sale(buyer: User, agent_agent_and_plan: tuple, days: int) -> Purchase:
    agent, plan = agent_agent_and_plan
    ref = f"pur_showcase_{agent.slug[:24]}_ot_{buyer.id}"
    purchase = DB.query(Purchase).filter(Purchase.reference == ref).first()
    created = False
    if not purchase:
        fee, earn = _split(plan.amount_minor)
        paid_at = days_ago(days)
        purchase = Purchase(
            reference=ref,
            buyer_id=buyer.id,
            agent_id=agent.id,
            plan_id=plan.id,
            pricing_model="one_time",
            currency=plan.currency,
            amount_minor=plan.amount_minor,
            platform_fee_minor=fee,
            creator_earnings_minor=earn,
            status="paid",
            payment_provider="razorpay",
            created_at=paid_at - timedelta(minutes=3),
            paid_at=paid_at,
        )
        DB.add(purchase)
        DB.flush()
        created = True
    if created or ledger.get_entitlement(DB, buyer.id, agent.id) is None:
        seed_payment_for(purchase, days)
        ledger.upsert_entitlement(DB, buyer.id, agent.id, source="one_time", purchase_id=purchase.id)
    ledger.post_purchase_earnings(DB, purchase)
    return purchase


def seed_subscription(buyer: User, agent_agent_and_plan: tuple, days: int) -> Purchase:
    """Mirror checkout._handle_subscription_charged for one billing cycle."""
    agent, plan = agent_agent_and_plan
    ref = f"pur_showcase_{agent.slug[:24]}_sub_{buyer.id}"
    purchase = DB.query(Purchase).filter(Purchase.reference == ref).first()
    if purchase:
        return purchase

    fee, earn = _split(plan.amount_minor)
    period_start = days_ago(days)
    period_end = ledger.subscription_period_end(plan.billing_interval, period_start)
    sub = Subscription(
        buyer_id=buyer.id,
        agent_id=agent.id,
        plan_id=plan.id,
        provider="razorpay",
        provider_subscription_id=f"sub_mock_{agent.slug[:18]}_{buyer.id}",
        status="active",
        interval=plan.billing_interval,
        currency=plan.currency,
        amount_minor=plan.amount_minor,
        current_period_start=period_start,
        current_period_end=period_end,
        created_at=period_start,
    )
    DB.add(sub)
    DB.flush()

    purchase = Purchase(
        reference=ref,
        buyer_id=buyer.id,
        agent_id=agent.id,
        plan_id=plan.id,
        pricing_model="subscription",
        currency=plan.currency,
        amount_minor=plan.amount_minor,
        platform_fee_minor=fee,
        creator_earnings_minor=earn,
        period_interval=plan.billing_interval,
        status="paid",
        payment_provider="razorpay",
        created_at=period_start,
        paid_at=period_start,
    )
    DB.add(purchase)
    DB.flush()
    seed_payment_for(purchase, days, provider_subscription_id=sub.provider_subscription_id)
    ledger.upsert_entitlement(
        DB,
        buyer.id,
        agent.id,
        source="subscription",
        purchase_id=purchase.id,
        subscription_id=sub.id,
        valid_until=period_end,
    )
    ledger.post_purchase_earnings(DB, purchase)
    return purchase


def seed_pack_sale(buyer: User, agent_agent_and_plan: tuple, days: int) -> Purchase:
    agent, plan = agent_agent_and_plan
    ref = f"pur_showcase_{agent.slug[:20]}_pk_{buyer.id}"
    purchase = DB.query(Purchase).filter(Purchase.reference == ref).first()
    created = False
    if not purchase:
        fee, earn = _split(plan.amount_minor)
        paid_at = days_ago(days)
        purchase = Purchase(
            reference=ref,
            buyer_id=buyer.id,
            agent_id=agent.id,
            plan_id=plan.id,
            pricing_model="pay_per_execution",
            currency=plan.currency,
            amount_minor=plan.amount_minor,
            platform_fee_minor=fee,
            creator_earnings_minor=earn,
            runs_included=plan.runs_per_pack,
            status="paid",
            payment_provider="razorpay",
            created_at=paid_at - timedelta(minutes=3),
            paid_at=paid_at,
        )
        DB.add(purchase)
        DB.flush()
        created = True
    # Mirror checkout._grant_access exactly: runs_per_pack only, never add_runs.
    if created or ledger.get_entitlement(DB, buyer.id, agent.id) is None:
        seed_payment_for(purchase, days)
        ledger.upsert_entitlement(
            DB,
            buyer.id,
            agent.id,
            source="pay_per_pack",
            purchase_id=purchase.id,
            runs_per_pack=plan.runs_per_pack,
        )
    ledger.post_purchase_earnings(DB, purchase)
    return purchase


def seed_free_claim(buyer: User, agent_agent_and_plan: tuple, days: int) -> None:
    """Mirror the checkout free path: pur_free_<agent>_<buyer>_<yyyymmdd>."""
    agent, plan = agent_agent_and_plan
    claim_day = days_ago(days)
    ref = f"pur_free_{agent.id}_{buyer.id}_{claim_day.strftime('%Y%m%d')}"
    purchase = DB.query(Purchase).filter(Purchase.reference == ref).first()
    if not purchase:
        purchase = Purchase(
            reference=ref,
            buyer_id=buyer.id,
            agent_id=agent.id,
            plan_id=plan.id,
            pricing_model="free",
            currency=plan.currency,
            amount_minor=0,
            platform_fee_minor=0,
            creator_earnings_minor=0,
            status="free",
            created_at=claim_day,
        )
        DB.add(purchase)
        DB.flush()
    ledger.upsert_entitlement(DB, buyer.id, agent.id, source="free", purchase_id=purchase.id)


def seed_partial_refund(purchase: Purchase, amount_minor: int, admin: User, reason: str) -> None:
    if DB.query(RefundDispute).filter(RefundDispute.purchase_id == purchase.id).first():
        return
    refunds.apply_refund(
        DB,
        purchase,
        amount_minor=amount_minor,
        provider_refund_id=f"rfnd_mock_{uuid.uuid4().hex[:10]}",
        reason=reason,
        raised_by_admin=admin.id,
        dispute_type="refund",
    )
    DB.flush()
    ledger.log_audit(
        DB,
        actor_id=admin.id,
        action="admin.refund",
        entity_type="purchase",
        entity_id=purchase.reference,
        details={"amount_minor": amount_minor, "type": "partial", "(mock)": True},
    )


# ---------------------------------------------------------------------------
# Runs / evaluations / ratings / payouts
# ---------------------------------------------------------------------------

SAMPLE_OUTPUTS = {
    "support-triage-copilot": "Triage complete: 34 tickets classified; 3 escalations (billing outage, churn risk, security). Draft replies saved for review.",
    "invoice-line-item-auditor": "Audit complete: 2 duplicate line items, 1 unit-price escalation (+6%), 1 wrong tax rate — worksheet ready for AP review.",
    "contract-clause-summarizer": "Digest ready: term-date Mar 2027, auto-renewal on p.12 needs 60-day notice, liability capped at fees paid, no broad IP grant.",
    "competitor-intelligence-briefs": "Monday brief ready: pricing page added an enterprise tier; hiring spiked 14%; review sentiment down 2 points on onboarding.",
    "blog-outline-engine": "Outline ready: 6 question-mapped H2s, counter-view on pricing opacity, lead draft in founder voice included.",
    "ad-copy-tester": "Variant matrix ready: top 3 by projected CTR isolated — proof-first headline leads; objection cell recommended for the retargeting set.",
    "sql-analyst-pro": "Query drafted with visible plan; revenue matches dashboard within 1.3% — discrepancy traced to timezone cutoff on the dashboard filter.",
    "standup-recap-digest": "Digest ready: 4 decisions, 2 blockers (auth refactor — Priya, Wed; data export — Sam, Thu), 7 follow-ups formatted for the tracker.",
}


def seed_runs(agent: Agent, runners: list[User], entitlements: dict, count: int) -> None:
    if DB.query(AgentRun).filter(AgentRun.agent_id == agent.id).count() >= count:
        return
    prompts = agent.example_prompts or [{"title": "Sample", "prompt": "Run the task"}]
    output_base = SAMPLE_OUTPUTS.get(agent.slug, "Task completed with the expected artifacts attached.")
    for i in range(count):
        user = runners[i % len(runners)]
        successful = random.random() < 0.92
        is_auto = i % 4 == 0
        in_tokens = random.randint(400, 4200)
        out_tokens = random.randint(200, 2400)
        DB.add(
            AgentRun(
                agent_id=agent.id,
                user_id=user.id,
                input=prompts[i % len(prompts)]["prompt"],
                output=f"{output_base} [{prompts[i % len(prompts)]['title']}]" if successful else None,
                status="completed" if successful else "error",
                error=None if successful else "Upstream model rate limit hit (showcase sample).",
                latency_ms=random.randint(900, 9500),
                steps_count=random.randint(2, 14),
                input_tokens=in_tokens,
                output_tokens=out_tokens if successful else 0,
                total_tokens=in_tokens + (out_tokens if successful else 0),
                estimated_cost_usd=round((in_tokens + out_tokens) * 0.000004, 6),
                thread_id=str(uuid.uuid4()),
                mode="automation" if is_auto else "chat",
                title=f"{prompts[i % len(prompts)]['title']} (auto)" if is_auto else None,
                entitlement_id=entitlements[user.id].id if user.id in entitlements else None,
                execution_cost_minor=0,
                charge_status="none",
                created_at=days_ago(random.randint(0, 24)),
            )
        )
    DB.flush()


def decrement_pack_balances(agent: Agent, plan: AgentPricingPlan) -> None:
    """Make pack balances reflect the seeded usage (display realism)."""
    for buyer_id in {r.user_id for r in DB.query(AgentRun).filter(AgentRun.agent_id == agent.id).all()}:
        ent = DB.query(Entitlement).filter(
            Entitlement.buyer_id == buyer_id,
            Entitlement.agent_id == agent.id,
            Entitlement.source == "pay_per_pack",
            Entitlement.status == "active",
        ).first()
        if not ent or ent.runs_remaining != plan.runs_per_pack:
            continue
        used = DB.query(AgentRun).filter(AgentRun.agent_id == agent.id, AgentRun.user_id == buyer_id).count()
        ent.runs_remaining = max(plan.runs_per_pack - used, 3)
        DB.add(ent)
    DB.flush()


def seed_evaluations(agent: Agent, judge: User, count: int) -> None:
    if DB.query(AgentEvaluation).filter(AgentEvaluation.agent_id == agent.id).count() >= count:
        return
    prompts = agent.example_prompts or [{"prompt": "Sample"}]
    base_scores = [8.4, 7.6, 9.1]
    for i in range(count):
        score = base_scores[i % len(base_scores)]
        DB.add(
            AgentEvaluation(
                agent_id=agent.id,
                user_id=judge.id,
                input=prompts[i % len(prompts)]["prompt"],
                agent_output=SAMPLE_OUTPUTS.get(agent.slug, "Completed with expected artifacts."),
                score=score,
                explanation="Grounded, on-schema and appropriately concise; minor verbosity on edge cases.",
                criteria="accuracy|completeness|format",
                criteria_scores={
                    "accuracy": min(round(score + 0.4, 1), 10.0),
                    "completeness": score,
                    "format": 9.5,
                },
                created_at=days_ago(random.randint(1, 20)),
            )
        )
    DB.flush()


def seed_ratings(agent: Agent, notes: list[tuple[str, int, str, bool, int]]) -> None:
    for email, rating, review, verified, days in notes:
        user = DB.query(User).filter(User.email == email).first()
        if not user:
            continue
        if DB.query(AgentRating).filter(AgentRating.agent_id == agent.id, AgentRating.user_id == user.id).first():
            continue
        DB.add(
            AgentRating(
                agent_id=agent.id,
                user_id=user.id,
                rating=rating,
                review=review,
                verified_purchase=verified,
                created_at=days_ago(days),
            )
        )
    DB.flush()


def seed_payouts(creator: User) -> None:
    currency = payments.platform_currency()
    profile = ledger.ensure_creator_profile(DB, creator.id)
    dest_name = (creator.creator_profile.display_name if creator.creator_profile else None) or creator.full_name or "creator"

    paid_ref = f"po_showcase_paid_{creator.id}"
    if not DB.query(Payout).filter(Payout.reference == paid_ref).first():
        balance = ledger.current_balance(DB, creator.id, currency)
        paid_amount = max(int(balance * 0.4), 50000)
        payout = Payout(
            reference=paid_ref,
            creator_id=creator.id,
            amount_minor=paid_amount,
            currency=currency,
            status="paid",
            provider="razorpay_x",
            provider_payout_id=f"mock_po_x_{uuid.uuid4().hex[:10]}",
            destination=f"{dest_name}@upi (mock)",
            requested_at=days_ago(14),
            processed_at=days_ago(11),
        )
        DB.add(payout)
        DB.flush()
        ledger.post_ledger(
            DB,
            creator_id=creator.id,
            entry_type="payout",
            amount_minor=-paid_amount,
            currency=currency,
            payout_id=payout.id,
            reference=f"payout:{payout.reference}",
            note=f"Payout {payout.reference} confirmed by provider (mock RazorpayX)",
        )

    requested_ref = f"po_showcase_req_{creator.id}"
    if not DB.query(Payout).filter(Payout.reference == requested_ref).first():
        balance = ledger.current_balance(DB, creator.id, currency)
        pending = ledger.pending_payout_reserve(DB, creator.id, currency)
        available = balance - pending
        if available >= 50000:
            DB.add(
                Payout(
                    reference=requested_ref,
                    creator_id=creator.id,
                    amount_minor=min(int(available * 0.3), available),
                    currency=currency,
                    status="requested",
                    destination=f"{dest_name}@upi (mock)",
                    requested_at=days_ago(2),
                )
            )
            DB.flush()


# ---------------------------------------------------------------------------
# Listing specs
# ---------------------------------------------------------------------------

NOVA_AGENTS = [
    {
        "slug": "support-triage-copilot",
        "plan_model": "subscription",
        "amount_minor": 79900,
        "billing_interval": "month",
        "listing": dict(
            name="Support Triage Copilot",
            category="support",
            model_name="gemini-3.5-flash-lite",
            temperature=0.2,
            system_prompt="You are a support desk triage worker. Classify intent, score urgency and sentiment, draft a knowledge-base-grounded first reply with citations, and write an escalation brief for true emergencies.",
            tagline="Classifies, prioritizes and drafts replies for support queues",
            description="A production-grade support desk worker: it reads every incoming ticket, classifies intent, detects urgency and sentiment, drafts a first reply grounded in your knowledge base, and escalates true emergencies with a complete context brief.",
            problem_statement="Support teams spend up to 60% of their day manually triaging tickets that could be automatically classified, deduplicated or answered from existing documentation — while critical escalations sit in the same queue as password resets.",
            features=[
                "Urgency + sentiment scoring with escalation rules",
                "Knowledge-base-grounded draft replies with citations",
                "Duplicate and linked-ticket detection",
                "Weekly queue-health digest (automation mode)",
            ],
            use_cases=[
                "Auto-triage overnight tickets so the morning team starts with priorities",
                "Draft first-response templates for refunds, bugs and onboarding questions",
                "Spot churn-risk tickets and route them to success managers",
            ],
            target_audience="Support leads, CX operations managers, and SaaS teams fighting queue backlogs.",
            tags=["support", "tickets", "triage", "cx"],
            example_prompts=[
                {"title": "Overnight triage", "prompt": "Classify last night's 34 unassigned tickets and give me a morning briefing with the top escalations.", "sample_output": None},
                {"title": "Draft reply", "prompt": "Ticket 4812 (refund request, order #9931) — draft a policy-compliant first reply with next steps.", "sample_output": None},
                {"title": "Queue health", "prompt": "Which category has the worst first-response time this week? Suggest a macro to cut it.", "sample_output": None},
            ],
            faqs=[
                {"question": "Which help desks does it connect to?", "answer": "Any desk reachable via API (Zendesk, Intercom, HelpScout, email). Point it at an inbox export to start."},
                {"question": "Does it send messages automatically?", "answer": "No. Drafts are saved for human approval by default — autonomy stays with your team."},
                {"question": "How are refunds handled?", "answer": "Cancel anytime from Purchases; the cancellation stops the next renewal immediately."},
            ],
            usage_instructions="Connect your help desk (or paste inbox exports) on first run, map your escalation keywords once, then enable the overnight automation for 8:00 briefings.",
            refund_window_days=None,
        ),
    },
    {
        "slug": "invoice-line-item-auditor",
        "plan_model": "one_time",
        "amount_minor": 199900,
        "listing": dict(
            name="Invoice Line-item Auditor",
            category="finance",
            model_name="gemini-2.5-flash",
            temperature=0.1,
            system_prompt="You are an AP auditor. Read vendor invoices line by line, cross-check them against POs and contracts, and flag duplicate charges, unit-price creep, wrong tax rates, unclaimed discounts and out-of-contract SKUs with an audit-ready worksheet.",
            tagline="Finds over-billing, duplicates and tax errors in vendor invoices",
            description="Reads vendor invoices against your PO history and flags every anomaly: duplicate charges, unit-price creep, wrong tax rates, unclaimed discounts and out-of-contract SKUs — with an audit-ready worksheet per invoice.",
            problem_statement="AP teams approve invoices on trust. A single 2% over-billing pattern across a mid-size vendor compounds into lakhs per year, and duplicated or wrongly-taxed line items routinely slip past eyeball checks.",
            features=[
                "PO and contract cross-checking per line item",
                "Duplicate and near-duplicate invoice detection",
                "Tax-rate and jurisdiction validation",
                "Exportable exception worksheet (CSV)",
            ],
            use_cases=[
                "Quarterly vendor invoice sweeps before payment runs",
                "Onboarding new vendors with strict contract terms",
                "Recovering over-billed amounts with documented evidence",
            ],
            target_audience="Finance managers, AP teams, controllers and procurement leads.",
            tags=["finance", "invoices", "audit", "procurement"],
            example_prompts=[
                {"title": "Single audit", "prompt": "Audit invoice INV-2201 from Sigma Supplies against PO-889 and list every line-item exception.", "sample_output": None},
                {"title": "Vendor sweep", "prompt": "Scan all Sigma Supplies invoices from this quarter for duplicate line items.", "sample_output": None},
                {"title": "Tax check", "prompt": "Verify GST rates on the attached three invoices and flag jurisdiction errors.", "sample_output": None},
            ],
            faqs=[
                {"question": "What input formats work?", "answer": "PDF invoices or CSV line items, optionally with a CSV of contracts/POs for cross-checking."},
                {"question": "Is my financial data stored anywhere?", "answer": "No. Invoices are processed in-session; nothing is retained after the run."},
                {"question": "How are refunds handled?", "answer": "One-time purchases carry 7-day refund protection under the platform policy."},
            ],
            usage_instructions="Import the invoice (PDF/CSV), optionally attach the contract or PO file, and request an audit. Export the worksheet into your AP workflow.",
            refund_window_days=7,
        ),
    },
    {
        "slug": "contract-clause-summarizer",
        "plan_model": "pay_per_execution",
        "amount_minor": 4900,
        "runs_per_pack": 50,
        "listing": dict(
            name="Contract Clause Summarizer",
            category="legal",
            model_name="gemini-3.5-flash-lite",
            temperature=0.0,
            system_prompt="You summarize contracts into a uniform one-page digest: parties, term dates, payment terms, liability caps, auto-renewals, termination rights and unusual clauses — each with page references.",
            tagline="One-page summaries of contracts, clause by clause",
            description="Turns long MSAs, NDAs, SOWs and lease agreements into a uniform one-page digest: parties, term dates, payment terms, liability caps, auto-renewals, termination rights and unusual clauses — highlighted with page references.",
            problem_statement="Reviewers open 40-page contracts only to find one auto-renewal date; business owners sign without understanding indemnity language; legal teams drown in 'quick' summary requests.",
            features=[
                "Standard clause taxonomy with page citations",
                "Auto-renewal and notice-period callouts",
                "Risk flags for unlimited liability and broad IP grants",
                "50-run packs with visible balance tracking",
            ],
            use_cases=[
                "Pre-signature review for founders and BD managers",
                "Renewal tracking for operations teams",
                "Fast-tagging contract archives into searchable digests",
            ],
            target_audience="Startup founders, ops and BD managers, in-house counsel support teams.",
            tags=["legal", "contracts", "clauses", "summary"],
            example_prompts=[
                {"title": "MSA digest", "prompt": "Summarize the attached master service agreement in the standard clause template.", "sample_output": None},
                {"title": "Renewal check", "prompt": "This vendor NDA renews when, and what notice is required? Cite the page.", "sample_output": None},
                {"title": "Risk flags", "prompt": "List unlimited-liability or broad-IP language in the attached SOW.", "sample_output": None},
            ],
            faqs=[
                {"question": "Which contracting languages?", "answer": "English contracts, including Indian and US drafting styles."},
                {"question": "Is this legal advice?", "answer": "No — it is structured summarization that accelerates review behind counsel."},
                {"question": "How do run packs work?", "answer": "Each pack adds 50 contract runs to your balance; unused runs never expire."},
            ],
            usage_instructions="Attach one contract per run and pick the digest template. Page-referenced summaries return in under a minute.",
            refund_window_days=7,
        ),
    },
    {
        "slug": "competitor-intelligence-briefs",
        "plan_model": "subscription",
        "amount_minor": 129900,
        "billing_interval": "month",
        "listing": dict(
            name="Competitor Intelligence Briefs",
            category="research",
            model_name="gemini-3.5-flash-lite",
            temperature=0.4,
            system_prompt="You synthesize public competitive signals — releases, pricing-page changes, hiring, blog posts, review sentiment — into a one-page weekly brief: what changed, why it matters, suggested responses.",
            tagline="Weekly competitor moves, synthesized into a decision brief",
            description="Collects public signals about your competitive set — releases, pricing-page changes, hiring, blog posts, review sentiment — and turns them into a one-page weekly brief with what changed, why it matters and what to do.",
            problem_statement="Competitive intel arrives as scattered Slack links and screenshots. Nobody has the 30 minutes to synthesize the week into something a leadership team can act on.",
            features=[
                "Pricing-page change tracking with snapshots",
                "Release and hiring feed synthesis",
                "Review sentiment deltas per competitor",
                "Monday-morning brief (automation mode)",
            ],
            use_cases=[
                "Weekly leadership briefings on 3–5 tracked competitors",
                "Launch windows: watch competitor noise before shipping",
                "Sales enablement with current positioning",
            ],
            target_audience="Product managers, growth teams and founders tracking rivals.",
            tags=["research", "competitors", "intel", "growth"],
            example_prompts=[
                {"title": "This week's brief", "prompt": "Give me this week's brief for my competitor set: what changed, why it matters, suggested responses.", "sample_output": None},
                {"title": "Pricing watch", "prompt": "Compare the pricing pages of my competitor set and flag new packages or buried enterprise tiers.", "sample_output": None},
                {"title": "Sentiment", "prompt": "How did review sentiment shift for competitor X over the last 30 days?", "sample_output": None},
            ],
            faqs=[
                {"question": "Which sources does it use?", "answer": "Public pages and feeds only — pricing, docs, changelogs, hiring boards and review sites."},
                {"question": "How many competitors can I track?", "answer": "Up to 5 per workspace on the standard plan."},
                {"question": "How are refunds handled?", "answer": "Cancel anytime from Purchases; cancellations stop the next renewal immediately."},
            ],
            usage_instructions="List the competitors to track with their URLs on first run, then enable the weekly automation for Monday briefs.",
            refund_window_days=None,
        ),
    },
    {
        "slug": "blog-outline-engine",
        "plan_model": "free",
        "amount_minor": 0,
        "listing": dict(
            name="Blog Outline Engine",
            category="writing",
            model_name="gemini-3.5-flash-lite",
            temperature=0.7,
            system_prompt="You turn a topic and audience into a structured, evidence-style outline: H2s that answer real search questions, counter-arguments to include, quotes to collect and a suggested lead paragraph.",
            tagline="Research-backed outlines that writers actually keep",
            description="Turns a topic and audience into a structured, evidence-style outline: H2s that answer real search questions, the counter-arguments to include, quotes to collect and a suggested lead paragraph — free, forever.",
            problem_statement="Most content strategy dies at the outline stage: generic H2s, no angle, nothing the SERP rewards. Writers need a scaffold that names the argument, not just the sections.",
            features=[
                "Question-mapped section planning",
                "Counter-view beat suggestions",
                "Lead-paragraph drafts in two tones",
                "Unlimited free runs for signed-in users",
            ],
            use_cases=[
                "Topic validation before committing writer time",
                "Refreshing stale posts with a sharper angle",
                "Editorial planning bursts across content calendars",
            ],
            target_audience="Content marketers, indie bloggers and newsletter writers.",
            tags=["writing", "blog", "seo", "outline"],
            example_prompts=[
                {"title": "Fresh outline", "prompt": "Outline: 'Migrating from Postgres to SQLite on a budget' for staff engineers.", "sample_output": None},
                {"title": "Refresh", "prompt": "Re-outline our 2024 piece on agent evaluation for this year's landscape.", "sample_output": None},
                {"title": "Newsletter", "prompt": "Outline the launch note for our marketplace launch — 500 words, founder voice.", "sample_output": None},
            ],
            faqs=[
                {"question": "Is it really free?", "answer": "Yes — claim it and run outlines with no payment details."},
                {"question": "What model runs it?", "answer": "The platform's configured Gemini model with the workspace provider key."},
                {"question": "Can I publish the output?", "answer": "Yes — outlines are yours to edit and ship."},
            ],
            usage_instructions="Claim the agent, open Chat, and start with one topic + audience line. Iterate with 'sharper angle' follow-ups.",
            refund_window_days=None,
        ),
    },
    {
        "slug": "ad-copy-tester",
        "plan_model": "one_time",
        "amount_minor": 99900,
        "listing": dict(
            name="Ad Copy Tester",
            category="marketing",
            model_name="gemini-3.5-flash-lite",
            temperature=0.9,
            system_prompt="You generate a full test matrix of ad copies for any campaign brief — headlines, bodies and hooks across tones — and score each against the offer, audience and channel norms.",
            tagline="10 ad variants ranked before you spend a rupee",
            description="Generates a full test matrix of ad copies for any campaign brief — headlines, bodies and hooks across tones — then scores each against your offer, audience and channel norms, so you launch a winner, not a guess.",
            problem_statement="Teams burn ad budgets on campaigns built from one opinionated copy choice. A structured 10-variant test with scoring replaces vibes with a starting baseline.",
            features=[
                "Variant matrix across tone, hook and proof styles",
                "Channel-normalized scoring (Google/LinkedIn/Meta norms)",
                "Objection-and-counter cell in every batch",
                "Launch-checklist export",
            ],
            use_cases=[
                "Pre-flight scoring for launch campaigns",
                "Refreshing fatigued ad sets",
                "Regional message testing before localization spend",
            ],
            target_audience="Performance marketers and founders running paid channels.",
            tags=["marketing", "ads", "copy", "growth"],
            example_prompts=[
                {"title": "Launch matrix", "prompt": "Ad matrix for our marketplace launch: 10 variants for Google Search, India audience, proof-first tone.", "sample_output": None},
                {"title": "LinkedIn set", "prompt": "LinkedIn ad variants for a CFO audience — 5 headlines, 2 bodies, objections answered.", "sample_output": None},
                {"title": "Fatigue refresh", "prompt": "Replace our top Meta ad with 6 variants that keep the core hook.", "sample_output": None},
            ],
            faqs=[
                {"question": "Does it run ads for me?", "answer": "No — it produces and scores copy; you control the ad platform."},
                {"question": "Does it need my ad account?", "answer": "No accounts connected. It uses channel conventions and your brief."},
                {"question": "How are refunds handled?", "answer": "One-time purchases carry 7-day refund protection under the platform policy."},
            ],
            usage_instructions="Write a 5-line campaign brief (offer, audience, channel, tone, proof) in the chat box. Score, then pick 2–3 variants for the real test.",
            refund_window_days=7,
        ),
    },
]

OWNER_AGENTS = [
    {
        "slug": "sql-analyst-pro",
        "plan_model": "one_time",
        "amount_minor": 249900,
        "listing": dict(
            name="SQL Analyst Pro",
            category="data-analysis",
            model_name="gemini-3.5-flash-lite",
            temperature=0.15,
            system_prompt="You are a careful SQL analyst. Explore the provided schema, write the query, show your plan before running it, then interpret results in plain English with the data-quality caveats a real analyst would flag.",
            tagline="Warehouse-grade SQL from plain English, with the plan shown",
            description="Point it at your database schema and ask business questions in natural language. It explores tables, writes the query, shows its plan, then explains results in plain English with the caveats a real analyst would flag.",
            problem_statement="Stakeholders wait days for 'a quick query'. Analysts drown in one-off pulls. A careful, show-its-work SQL assistant collapses that loop without text-to-SQL hallucination risk.",
            features=[
                "Schema-aware query drafting with visible reasoning",
                "Result interpretation with data-quality caveats",
                "Query library reuse for recurring reports",
                "Zero retention: schema definitions stay in-session",
            ],
            use_cases=[
                "Revenue and retention questions answered in minutes",
                "Sanity-checking dashboard metrics against raw data",
                "Teaching path: readable SQL with the plan explained",
            ],
            target_audience="Analysts, product managers and founders who live inside the data.",
            tags=["sql", "data", "analysis", "reporting"],
            example_prompts=[
                {"title": "Revenue cohort", "prompt": "Monthly revenue cohorts for marketplace sellers over the last 6 months — with the SQL shown.", "sample_output": None},
                {"title": "Retention", "prompt": "D30 retention by signup channel; flag any weeks with tracking gaps.", "sample_output": None},
                {"title": "Sanity check", "prompt": "Dashboard says 4,800 orders this month. Verify against the orders table and reconcile the difference.", "sample_output": None},
            ],
            faqs=[
                {"question": "How does it connect?", "answer": "Paste your CREATE TABLE statements or schema dump — read-only and per-session."},
                {"question": "Which SQL dialects?", "answer": "PostgreSQL, MySQL, SQLite and BigQuery standard SQL."},
                {"question": "How are refunds handled?", "answer": "7-day refund protection on the one-time purchase."},
            ],
            usage_instructions="Paste your schema, ask the business question, review the plan it shows, then run the returned SQL in your own client.",
            refund_window_days=7,
        ),
    },
    {
        "slug": "standup-recap-digest",
        "plan_model": "free",
        "amount_minor": 0,
        "listing": dict(
            name="Standup Recap Digest",
            category="productivity",
            model_name="gemini-3.5-flash-lite",
            temperature=0.5,
            system_prompt="You turn standup transcripts into one actionable digest: decisions made, blockers with owners and due dates, and follow-ups formatted for the team tracker.",
            tagline="Standup transcripts in, one actionable digest out",
            description="Paste yesterday's standup transcript (or connect your notes export) and receive a digest: decisions made, blockers with owners and due dates, and the exact follow-ups to copy into your tracker.",
            problem_statement="Standups produce 15 minutes of talk for zero written trace. Action items evaporate; the same blockers resurface on Friday.",
            features=[
                "Decisions / blockers / follow-ups separation",
                "Owner + due-date extraction",
                "Tracker-ready checklist text",
                "Unlimited free runs",
            ],
            use_cases=[
                "Async standup for distributed teams",
                "Manager morning briefing before standup",
                "Weekly roll-up of recurring blockers",
            ],
            target_audience="Engineering managers, tech leads and remote-first teams.",
            tags=["productivity", "standup", "summary", "teams"],
            example_prompts=[
                {"title": "Yesterday", "prompt": "Summarize yesterday's standup transcript: decisions, blockers with owners, follow-ups.", "sample_output": None},
                {"title": "Blockers", "prompt": "Which blockers appeared this week more than once, and who owns them?", "sample_output": None},
                {"title": "Monday brief", "prompt": "Digest Friday's chaos into three priorities for Monday.", "sample_output": None},
            ],
            faqs=[
                {"question": "Is it free?", "answer": "Completely — claim it and use it right away."},
                {"question": "Is transcript data retained?", "answer": "Nothing is stored beyond the conversation memory you configure."},
                {"question": "Audio support?", "answer": "Paste transcripts from any note tool; speech-to-text stays on your side."},
            ],
            usage_instructions="Claim the agent, send a transcript (even a messy one), and ask for the digest. Copy the follow-ups straight into your tracker.",
            refund_window_days=None,
        ),
    },
]

# Per-slug curated reviews: (email, rating, review, verified, days_ago)
RATINGS = {
    "support-triage-copilot": [
        ("arjun@showcase.dev", 5, "Saved our morning triage entirely — escalations finally surface on their own.", True, 14),
        ("you@demo.dev", 4, "Draft quality is solid; the citation habit makes editors trust them.", False, 8),
    ],
    "invoice-line-item-auditor": [
        ("ishaan@showcase.dev", 5, "Found ₹7,400 of duplicated line-items in the first quarterly sweep.", True, 24),
        ("riya@showcase.dev", 4, "Worksheet export drops straight into our AP review.", True, 20),
    ],
    "contract-clause-summarizer": [
        ("riya@showcase.dev", 5, "Caught an auto-renewal in a 60-page MSA in one page. Worth every rupee.", True, 7),
        ("ishaan@showcase.dev", 4, "Notice-period callouts saved us on two vendor renewals.", True, 11),
    ],
    "competitor-intelligence-briefs": [
        ("ishaan@showcase.dev", 5, "Monday brief is the first thing I open now — sharper than our old analyst notes.", True, 6),
        ("you@demo.dev", 4, "Briefs are sharp; would love two more tracked competitors.", False, 5),
    ],
    "blog-outline-engine": [
        ("arjun@showcase.dev", 5, "Outlines keep a real argument in every H2 — my writers keep them.", True, 4),
        ("riya@showcase.dev", 4, "Free tier alone is worth claiming.", True, 12),
    ],
    "ad-copy-tester": [
        ("arjun@showcase.dev", 5, "LinkedIn copy matrix beat our old set on CTR in test one.", True, 15),
    ],
    "sql-analyst-pro": [
        ("arjun@showcase.dev", 5, "Shows the SQL plan before running — great trust pattern.", True, 10),
        ("riya@showcase.dev", 5, "Reconciled our dashboard discrepancy in minutes, caveats included.", True, 26),
    ],
    "standup-recap-digest": [
        ("ishaan@showcase.dev", 4, "Standup digest replaces three tabs and a whiteboard.", True, 5),
        ("riya@showcase.dev", 5, "Follow-ups copy straight into Linear — zero friction.", True, 9),
    ],
}


# ---------------------------------------------------------------------------
# Purge — showcase-marked data ONLY
# ---------------------------------------------------------------------------

def purge() -> None:
    showcase_users = DB.query(User).filter(User.email.like("%@showcase.dev")).all()
    purged_user_ids = [u.id for u in showcase_users]
    showcase_owner_agents = DB.query(Agent).filter(Agent.owner_id.in_(purged_user_ids)).all()
    tagged_agents = [a for a in DB.query(Agent).all() if SHOWCASE_TAG in (a.tags or [])]
    agent_ids = sorted({a.id for a in showcase_owner_agents + tagged_agents})

    human = DB.query(User).filter(User.email == OWNER_EMAIL).first()
    human_id = human.id if human else None

    agent_purchases = DB.query(Purchase).filter(Purchase.agent_id.in_(agent_ids)).all()
    buyer_purchases = DB.query(Purchase).filter(Purchase.buyer_id.in_(purged_user_ids)).all()
    purchase_ids = sorted({p.id for p in agent_purchases + buyer_purchases})
    purchase_refs = sorted({p.reference for p in agent_purchases + buyer_purchases})

    payouts = DB.query(Payout).filter(Payout.creator_id.in_(purged_user_ids)).all()
    payout_ids = [p.id for p in payouts]
    payout_refs = [p.reference for p in payouts]

    users_in = purged_user_ids or [-1]
    agents_in = agent_ids or [-1]
    purchases_in = purchase_ids or [-1]
    payouts_in = payout_ids or [-1]

    def scope(col_agent, col_user=None):
        """Rows tied to showcase agents and/or showcase users."""
        cond = col_agent.in_(agents_in)
        if col_user is not None:
            cond = cond | col_user.in_(users_in)
        return cond

    mcp_cond = MCPServer.owner_id.in_(users_in)
    if human is not None:
        mcp_cond = mcp_cond | ((MCPServer.owner_id == human.id) & MCPServer.name.like("Showcase %"))

    audit_cond = AuditLog.actor_id.in_(users_in)
    refs_in = purchase_ids + purchase_refs + payout_ids + payout_refs
    if refs_in:
        audit_cond = audit_cond | (AuditLog.entity_type.in_(["purchase", "payout"]) & AuditLog.entity_id.in_([str(p) for p in refs_in]))

    steps = [
        ("tool_approvals", ToolApproval, scope(ToolApproval.agent_id, ToolApproval.user_id)),
        ("agent_runs", AgentRun, scope(AgentRun.agent_id, AgentRun.user_id)),
        ("agent_versions", AgentVersion, AgentVersion.agent_id.in_(agents_in)),
        ("agent_ratings", AgentRating, scope(AgentRating.agent_id, AgentRating.user_id)),
        ("agent_evaluations", AgentEvaluation, scope(AgentEvaluation.agent_id, AgentEvaluation.user_id)),
        ("api_keys", ApiKey, scope(ApiKey.agent_id, ApiKey.user_id)),
        ("credit_transactions", CreditTransaction, scope(CreditTransaction.agent_id, CreditTransaction.user_id)),
        ("agent_pricing_plans", AgentPricingPlan, AgentPricingPlan.agent_id.in_(agents_in)),
        ("moderation_reports", ModerationReport, scope(ModerationReport.agent_id, ModerationReport.reporter_id)),
        ("refund_disputes", RefundDispute, RefundDispute.purchase_id.in_(purchases_in)),
        ("payment_transactions", PaymentTransaction, scope(PaymentTransaction.agent_id, PaymentTransaction.user_id) | PaymentTransaction.purchase_id.in_(purchases_in)),
        ("entitlements", Entitlement, scope(Entitlement.agent_id, Entitlement.buyer_id)),
        ("subscriptions", Subscription, scope(Subscription.agent_id, Subscription.buyer_id)),
        ("purchases", Purchase, Purchase.id.in_(purchases_in)),
        ("earnings_ledger", EarningsLedgerEntry, EarningsLedgerEntry.creator_id.in_(users_in) | EarningsLedgerEntry.agent_id.in_(agents_in) | EarningsLedgerEntry.purchase_id.in_(purchases_in) | EarningsLedgerEntry.payout_id.in_(payouts_in)),
        ("payouts", Payout, Payout.id.in_(payouts_in)),
        ("mcp_servers", MCPServer, mcp_cond),
        ("provider_keys", ProviderKey, ProviderKey.user_id.in_(users_in) | (ProviderKey.label == "OpenAI (showcase)")),
        ("creator_profiles", CreatorProfile, CreatorProfile.user_id.in_(users_in)),
        ("audit_logs", AuditLog, audit_cond),
    ]
    for label, model, cond in steps:
        try:
            n = DB.query(model).filter(cond).delete(synchronize_session=False)
            DB.commit()
            print(f"  purged {label}: {n}")
        except Exception as exc:  # pragma: no cover
            DB.rollback()
            print(f"  WARN {label}: {exc}")

    n = DB.query(Agent).filter(Agent.id.in_(agent_ids)).delete(synchronize_session=False)
    DB.commit()
    print(f"  purged agents: {n}")
    n = DB.query(User).filter(User.id.in_(users_in)).delete(synchronize_session=False)
    DB.commit()
    print(f"  purged users: {n}")
    remaining = [a.name for a in DB.query(Agent).all()]
    print("Remaining agents:", remaining)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Seeding showcase data…")
    ledger.ensure_categories_seeded(DB)
    DB.commit()

    nova = ensure_user("nova@showcase.dev", "Nova Forge", role="creator")
    riya = ensure_user("riya@showcase.dev", "Riya Sharma")
    arjun = ensure_user("arjun@showcase.dev", "Arjun Mehta")
    ishaan = ensure_user("ishaan@showcase.dev", "Ishaan Kulkarni")
    owner = DB.query(User).filter(User.email == OWNER_EMAIL).first()
    if not owner:
        print(f"ERROR: {OWNER_EMAIL} must exist (register once via the UI) — aborting without partial writes.")
        return
    DB.commit()

    sync_creator_profile(
        nova,
        "NovaForge Labs",
        "We ship focused, production-ready agents for ops, finance and support teams. Every listing is benchmarked before publish.",
        "novaforge@upi",
        "https://novaforgelabs.example.com",
    )
    sync_creator_profile(owner, "Om Patil", "Building AI Agent Space — agents with real tools, memory and multi-agent workflows.", "om@upi", "")
    DB.commit()

    # --- Showcase MCP servers (owner-owned, public) --------------------------
    showcase_servers = [
        ("Showcase Filesystem", "productivity", "Read-only filesystem MCP scoping agents to a demo workspace (Showcase, mock-safe).",
         {"name": "showcase-fs", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]}),
        ("Showcase Sequential Thinking", "research", "Structured reasoning steps for planning-heavy demo agents (Showcase).",
         {"name": "showcase-thinking", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]}),
        ("Showcase Memory", "productivity", "Persistent knowledge-graph memory used by showcase agents across runs (Showcase).",
         {"name": "showcase-memory", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}),
    ]
    for name, category, description, config in showcase_servers:
        ensure_mcp_server(owner, name, category, description, config)
    DB.commit()
    server_ids = {s.name: s.id for s in DB.query(MCPServer).filter(MCPServer.owner_id == owner.id, MCPServer.name.like("Showcase %")).all()}

    def tools_for(server_name: str, tool_names: list[str]) -> list[dict]:
        server_id = server_ids.get(server_name)
        return [{"name": tool_name, "server_id": server_id} for tool_name in tool_names]

    # --- categories -----------------------------------------------------------
    category_by_slug = {c.slug: c.id for c in DB.query(AgentCategory).all()}

    def finalize(spec: dict) -> None:
        listing = spec["listing"]
        listing["category_id"] = category_by_slug.get(listing["category"])
        listing["view_count"] = VIEW_COUNTS.get(spec["slug"], 500)
        listing["memory_config"] = {"type": "buffer", "max_turns": 12}
        listing["workflow_config"] = {"type": "single"}
        listing["sandbox_enabled"] = False
        listing["autonomy_level"] = "supervised"
        listing["max_steps"] = 25
        listing["price"] = 0  # legacy credit price unused for real-money agents

    seeded: dict[str, tuple[Agent, AgentPricingPlan]] = {}
    for i, spec in enumerate(NOVA_AGENTS):
        finalize(spec)
        tool_sets = [tools_for("Showcase Memory", ["triage", "kb_search"]), tools_for("Showcase Thinking", ["file_read", "csv_check"]), tools_for("Showcase Thinking", ["clause_scan"]), tools_for("Showcase Thinking", ["web_watch"]), tools_for("Showcase Memory", ["outline"]), tools_for("Showcase Memory", ["copy_variants"])]
        spec["listing"]["tools_config"] = tool_sets[i]
        result = seed_agents_for(nova, spec)
        if result:
            seeded[spec["slug"]] = result
            DB.commit()

    owner_tool_sets = [tools_for("Showcase Thinking", ["schema_parse", "sql_draft"]), tools_for("Showcase Memory", ["note_compress"])]
    for i, spec in enumerate(OWNER_AGENTS):
        finalize(spec)
        spec["listing"]["tools_config"] = owner_tool_sets[i]
        result = seed_agents_for(owner, spec)
        if result:
            seeded[spec["slug"]] = result
            DB.commit()
    DB.commit()

    buyers = [riya, arjun, ishaan]

    # --- one_time sales --------------------------------------------------------
    one_time_buys = [
        ("invoice-line-item-auditor", [(riya, 38), (ishaan, 26)]),
        ("ad-copy-tester", [(arjun, 21)]),
        ("sql-analyst-pro", [(riya, 30), (arjun, 12)]),
    ]
    invoice_purchase_ref = None
    for slug, buys in one_time_buys:
        for buyer, days in buys:
            purchase = seed_one_time_sale(buyer, seeded[slug], days)
            if slug == "invoice-line-item-auditor" and buyer is riya:
                invoice_purchase_ref = purchase.reference
    DB.commit()

    # --- subscriptions ----------------------------------------------------------
    sub_buys = [
        ("support-triage-copilot", [(arjun, 26), (owner, 14)]),
        ("competitor-intelligence-briefs", [(ishaan, 10)]),
    ]
    for slug, buys in sub_buys:
        for buyer, days in buys:
            seed_subscription(buyer, seeded[slug], days)
    DB.commit()

    # --- pay-per-execution packs -------------------------------------------------
    for buyer, days in [(ishaan, 18), (riya, 9), (owner, 8)]:
        seed_pack_sale(buyer, seeded["contract-clause-summarizer"], days)
    DB.commit()

    # --- free claims ----------------------------------------------------------------
    for buyer, agent_slug, days in [(riya, "blog-outline-engine", 15), (arjun, "blog-outline-engine", 5), (riya, "standup-recap-digest", 10), (ishaan, "standup-recap-digest", 6)]:
        seed_free_claim(buyer, seeded[agent_slug], days)
    DB.commit()

    # --- one processed partial refund (riya's invoice purchase) ----------------------
    if invoice_purchase_ref:
        purchase = DB.query(Purchase).filter(Purchase.reference == invoice_purchase_ref).first()
        if purchase and purchase.status == "paid":
            seed_partial_refund(purchase, purchase.amount_minor // 2, owner, "Duplicate charges found on line items 4–6 (processed manually, mock provider refund)")
    DB.commit()

    # --- runs -------------------------------------------------------------------------
    ents: dict[tuple[int, int], Entitlement] = {}
    for e in DB.query(Entitlement).filter(Entitlement.status == "active").all():
        ents[(e.buyer_id, e.agent_id)] = e

    run_plan = {
        "support-triage-copilot": [arjun, owner],
        "invoice-line-item-auditor": [riya, ishaan],
        "contract-clause-summarizer": [ishaan, riya, owner],
        "competitor-intelligence-briefs": [ishaan],
        "blog-outline-engine": [riya, arjun],
        "ad-copy-tester": [arjun],
        "sql-analyst-pro": [riya, arjun, owner],
        "standup-recap-digest": [riya, ishaan, owner],
    }
    for slug, runners in run_plan.items():
        if slug not in seeded:
            continue
        agent, plan = seeded[slug]
        user_ents = {u.id: ents[(u.id, agent.id)] for u in runners if (u.id, agent.id) in ents}
        seed_runs(agent, runners, user_ents, RUN_COUNTS[slug])
        if plan.model == "pay_per_execution":
            decrement_pack_balances(agent, plan)
    DB.commit()

    # --- evaluations + ratings -------------------------------------------------------------
    seed_evaluations(seeded["sql-analyst-pro"][0], owner, 3)
    seed_evaluations(seeded["support-triage-copilot"][0], owner, 2)
    seed_evaluations(seeded["invoice-line-item-auditor"][0], owner, 2)
    for slug, notes in RATINGS.items():
        if slug in seeded:
            seed_ratings(seeded[slug][0], notes)
    DB.commit()

    # --- payouts (NovaForge) + audit + moderation -------------------------------------------
    seed_payouts(nova)
    DB.commit()

    nova_agents = [(agent, plan) for (agent, plan) in seeded.values() if agent.owner_id == nova.id]
    owner_agents = [(agent, plan) for (agent, plan) in seeded.values() if agent.owner_id == owner.id]
    if DB.query(AuditLog).filter(AuditLog.action == "agent.publish").count() < 5:
        for agent, _plan in (nova_agents + owner_agents)[:5]:
            DB.add(
                AuditLog(
                    actor_id=agent.owner_id,
                    action="agent.publish",
                    entity_type="agent",
                    entity_id=str(agent.id),
                    details={"name": agent.name, "status": "published"},
                    ip="127.0.0.1",
                    created_at=agent.published_at or days_ago(30),
                )
            )
        DB.flush()
    DB.commit()

    adcopy_agent = seeded.get("ad-copy-tester")
    if adcopy_agent:
        agent = adcopy_agent[0]
        if not DB.query(ModerationReport).filter(ModerationReport.agent_id == agent.id, ModerationReport.reporter_id == arjun.id).first():
            DB.add(
                ModerationReport(
                    agent_id=agent.id,
                    reporter_id=arjun.id,
                    reason="Listing needs review",
                    details="The ad-copy FAQ says '7-day refund protection' — confirm this matches the platform refund policy wording.",
                    status="open",
                    created_at=days_ago(4),
                )
            )
            DB.commit()

    print("Showcase seed complete.")
    print(f"  agents: {DB.query(Agent).count()}")
    print(f"  purchases: {DB.query(Purchase).count()}")
    print(f"  entitlements: {DB.query(Entitlement).count()}")
    print(f"  ledger entries: {DB.query(EarningsLedgerEntry).count()}")
    print(f"  runs: {DB.query(AgentRun).count()}")
    print(f"  ratings: {DB.query(AgentRating).count()}")
    print("  Showcase logins: nova@showcase.dev / riya@showcase.dev / arjun@showcase.dev / ishaan@showcase.dev — password 'Showcase@2026'")
    for email in ("nova@showcase.dev", OWNER_EMAIL):
        u = DB.query(User).filter(User.email == email).first()
        if u:
            print(f"  token[{email}] = {create_access_token(str(u.id))}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--purge", action="store_true", help="Remove showcase-marked data only")
    args = parser.parse_args()
    try:
        if args.purge:
            purge()
        else:
            main()
    finally:
        DB.close()
