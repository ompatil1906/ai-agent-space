"""Real-money marketplace: additive tables, listing columns, backfill, seeds

Revision ID: m1n2o3p4q5r6
Revises: k6l7m8n9o1p0
Create Date: 2026-10-24 16:00:00.000000

Additive migration:
* New marketplace tables (creator profiles, categories, pricing, purchases,
  entitlements, subscriptions, transactions, refunds, ledger, payouts,
  webhooks, audit, reports, settings).
* New listing/execution columns on agents / agent_runs / agent_ratings / users.
* Backfills: unique slugs for existing agents, canonical status from
  is_published, admin role from is_superuser, one active FREE plan per agent
  with no plan (so every agent stays runnable; nothing is charged by default).
* Seeds: standard agent categories; platform settings from config defaults.
* Legacy columns (users.credits, agents.price) are preserved and untouched.
"""
import json
import re
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'm1n2o3p4q5r6'
down_revision: Union[str, Sequence[str], None] = 'k6l7m8n9o1p0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEED_CATEGORIES = [
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


def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # 1) Users: marketplace role (customer | creator | admin) — additive.
    #    Legacy credits column is intentionally kept but no longer used.
    op.add_column('users', sa.Column('role', sa.String(), nullable=False, server_default='customer'))
    conn.execute(sa.text("UPDATE users SET role='admin' WHERE COALESCE(is_superuser, 0) = 1"))

    # ------------------------------------------------------------------
    # 2) Agents: public-listing columns + canonical status
    op.add_column('agents', sa.Column('slug', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('tagline', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('avatar_url', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('cover_image_url', sa.String(), nullable=True))
    op.add_column('agents', sa.Column('category_id', sa.Integer(), nullable=True))
    op.add_column('agents', sa.Column('tags', sa.JSON(), nullable=True))
    op.add_column('agents', sa.Column('problem_statement', sa.Text(), nullable=True))
    op.add_column('agents', sa.Column('features', sa.JSON(), nullable=True))
    op.add_column('agents', sa.Column('use_cases', sa.JSON(), nullable=True))
    op.add_column('agents', sa.Column('target_audience', sa.Text(), nullable=True))
    op.add_column('agents', sa.Column('example_prompts', sa.JSON(), nullable=True))
    op.add_column('agents', sa.Column('faqs', sa.JSON(), nullable=True))
    op.add_column('agents', sa.Column('usage_instructions', sa.Text(), nullable=True))
    op.add_column('agents', sa.Column('refund_window_days', sa.Integer(), nullable=True))
    op.add_column('agents', sa.Column('status', sa.String(), nullable=False, server_default='draft'))
    op.add_column('agents', sa.Column('published_at', sa.DateTime(), nullable=True))
    op.add_column('agents', sa.Column('view_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('agents', sa.Column('is_featured', sa.Boolean(), nullable=False, server_default=sa.text('0')))
    op.add_column('agents', sa.Column('featured_at', sa.DateTime(), nullable=True))
    op.add_column('agents', sa.Column('moderation_note', sa.Text(), nullable=True))

    # Canonical status backfill: previously is_published was the only switch.
    conn.execute(sa.text("UPDATE agents SET status='published' WHERE COALESCE(is_published, 0) = 1"))

    # Unique slug backfill — generate from name, dedupe with random suffix.
    def _slugify(text: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
        slug = re.sub(r"-{2,}", "-", slug)
        return slug[:60] or "agent"

    rows = conn.execute(sa.text("SELECT id, name FROM agents WHERE slug IS NULL OR slug = ''")).fetchall()
    used = {
        r[0] for r in conn.execute(sa.text("SELECT slug FROM agents WHERE slug IS NOT NULL")).fetchall()
    }
    for agent_id, name in rows:
        base = _slugify(name or f"agent-{agent_id}")
        candidate = base
        while candidate in used:
            candidate = f"{base}-{uuid.uuid4().hex[:6]}"
        used.add(candidate)
        conn.execute(sa.text("UPDATE agents SET slug=:slug WHERE id=:id"), {"slug": candidate, "id": agent_id})
    conn.execute(sa.text("UPDATE agents SET slug=:slug WHERE slug IS NULL"), {"slug": "agent"})
    op.create_index('ix_agents_slug', 'agents', ['slug'], unique=True)
    with op.batch_alter_table('agents') as batch:
        batch.alter_column('slug', existing_type=sa.String(), nullable=False)

    # ------------------------------------------------------------------
    # 3) Ratings + runs: verification and metering (money) columns
    with op.batch_alter_table('agent_ratings') as batch:
        batch.add_column(sa.Column('verified_purchase', sa.Boolean(), nullable=False, server_default=sa.text('0')))
    op.add_column('agent_runs', sa.Column('entitlement_id', sa.Integer(), nullable=True))
    op.add_column('agent_runs', sa.Column('execution_cost_minor', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('agent_runs', sa.Column('charge_status', sa.String(), nullable=False, server_default='none'))
    op.add_column('agent_runs', sa.Column('client_request_id', sa.String(), nullable=True))
    op.create_index('ix_agent_runs_client_request_id', 'agent_runs', ['client_request_id'])
    op.create_index('ix_agent_runs_entitlement_id', 'agent_runs', ['entitlement_id'])

    # ------------------------------------------------------------------
    # 4) New marketplace tables (ordered to satisfy FK dependencies)
    op.create_table(
        'creator_profiles',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('display_name', sa.String(), nullable=True),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('avatar_url', sa.String(), nullable=True),
        sa.Column('website_url', sa.String(), nullable=True),
        sa.Column('payout_currency', sa.String(), nullable=True),
        sa.Column('payout_account_name', sa.String(), nullable=True),
        sa.Column('payout_account_number', sa.String(), nullable=True),
        sa.Column('payout_ifsc', sa.String(), nullable=True),
        sa.Column('payout_vpa', sa.String(), nullable=True),
        sa.Column('onboarding_status', sa.String(), nullable=False, server_default='unverified'),
        sa.Column('is_verified', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_creator_profiles_user_id', 'creator_profiles', ['user_id'], unique=True)

    op.create_table(
        'agent_categories',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('slug', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_agent_categories_slug', 'agent_categories', ['slug'], unique=True)
    op.create_index('ix_agent_categories_id', 'agent_categories', ['id'])

    op.create_table(
        'agent_pricing_plans',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=False),
        sa.Column('model', sa.String(), nullable=False, server_default='free'),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('amount_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('billing_interval', sa.String(), nullable=True),
        sa.Column('runs_per_pack', sa.Integer(), nullable=True),
        sa.Column('limits', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('external_plan_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_pricing_plan_active', 'agent_pricing_plans', ['agent_id', 'is_active'])
    op.create_index('ix_agent_pricing_plans_agent_id', 'agent_pricing_plans', ['agent_id'])

    op.create_table(
        'purchases',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('reference', sa.String(), nullable=False),
        sa.Column('buyer_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=False),
        sa.Column('plan_id', sa.Integer(), sa.ForeignKey('agent_pricing_plans.id'), nullable=True),
        sa.Column('pricing_model', sa.String(), nullable=False),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('amount_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('platform_fee_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('creator_earnings_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('runs_included', sa.Integer(), nullable=True),
        sa.Column('period_interval', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='created'),
        sa.Column('payment_provider', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('refunded_minor', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index('ix_purchases_reference', 'purchases', ['reference'], unique=True)
    op.create_index('ix_purchases_buyer_id', 'purchases', ['buyer_id'])
    op.create_index('ix_purchases_agent_id', 'purchases', ['agent_id'])
    op.create_index('ix_purchases_id', 'purchases', ['id'])

    op.create_table(
        'subscriptions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('buyer_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=False),
        sa.Column('plan_id', sa.Integer(), sa.ForeignKey('agent_pricing_plans.id'), nullable=True),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('provider_subscription_id', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('interval', sa.String(), nullable=True),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('amount_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('current_period_start', sa.DateTime(), nullable=True),
        sa.Column('current_period_end', sa.DateTime(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_subscriptions_provider_subscription_id', 'subscriptions', ['provider_subscription_id'], unique=True)
    op.create_index('ix_subscriptions_buyer_id', 'subscriptions', ['buyer_id'])
    op.create_index('ix_subscriptions_agent_id', 'subscriptions', ['agent_id'])

    op.create_table(
        'entitlements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('buyer_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=False),
        sa.Column('source', sa.String(), nullable=False, server_default='one_time'),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('runs_remaining', sa.Integer(), nullable=True),
        sa.Column('valid_until', sa.DateTime(), nullable=True),
        sa.Column('purchase_id', sa.Integer(), sa.ForeignKey('purchases.id'), nullable=True),
        sa.Column('subscription_id', sa.Integer(), sa.ForeignKey('subscriptions.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('buyer_id', 'agent_id', name='uq_entitlement_buyer_agent'),
    )
    op.create_index('ix_entitlements_buyer_id', 'entitlements', ['buyer_id'])
    op.create_index('ix_entitlements_agent_id', 'entitlements', ['agent_id'])
    op.create_index('ix_entitlements_purchase_id', 'entitlements', ['purchase_id'])
    op.create_index('ix_entitlements_subscription_id', 'entitlements', ['subscription_id'])

    op.create_table(
        'payment_transactions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('provider', sa.String(), nullable=False, server_default='razorpay'),
        sa.Column('provider_order_id', sa.String(), nullable=False),
        sa.Column('provider_payment_id', sa.String(), nullable=True),
        sa.Column('provider_subscription_id', sa.String(), nullable=True),
        sa.Column('purchase_id', sa.Integer(), sa.ForeignKey('purchases.id'), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=True),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('amount_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(), nullable=False, server_default='created'),
        sa.Column('payment_method', sa.String(), nullable=True),
        sa.Column('verified', sa.String(), nullable=False, server_default='unverified'),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_payment_transactions_provider_order_id', 'payment_transactions', ['provider_order_id'])
    op.create_index('ix_payment_transactions_provider_payment_id', 'payment_transactions', ['provider_payment_id'], unique=True)
    op.create_index('ix_payment_transactions_provider_subscription_id', 'payment_transactions', ['provider_subscription_id'])
    op.create_index('ix_payment_transactions_purchase_id', 'payment_transactions', ['purchase_id'])
    op.create_index('ix_payment_transactions_user_id', 'payment_transactions', ['user_id'])
    op.create_index('ix_payment_transactions_agent_id', 'payment_transactions', ['agent_id'])

    op.create_table(
        'refund_disputes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('purchase_id', sa.Integer(), sa.ForeignKey('purchases.id'), nullable=False),
        sa.Column('type', sa.String(), nullable=False, server_default='refund'),
        sa.Column('amount_minor', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('provider_refund_id', sa.String(), nullable=True),
        sa.Column('raised_by_admin_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_refund_disputes_purchase_id', 'refund_disputes', ['purchase_id'])
    op.create_index('ix_refund_disputes_provider_refund_id', 'refund_disputes', ['provider_refund_id'])

    op.create_table(
        'payouts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('reference', sa.String(), nullable=False),
        sa.Column('creator_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('amount_minor', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('status', sa.String(), nullable=False, server_default='requested'),
        sa.Column('provider', sa.String(), nullable=True),
        sa.Column('provider_payout_id', sa.String(), nullable=True),
        sa.Column('destination', sa.String(), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.Column('requested_by_admin_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('requested_at', sa.DateTime(), nullable=True),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_payouts_reference', 'payouts', ['reference'], unique=True)
    op.create_index('ix_payouts_creator_id', 'payouts', ['creator_id'])
    op.create_index('ix_payouts_provider_payout_id', 'payouts', ['provider_payout_id'])
    op.create_index('ix_payout_creator_status', 'payouts', ['creator_id', 'status'])

    op.create_table(
        'earnings_ledger',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('creator_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('entry_type', sa.String(), nullable=False),
        sa.Column('amount_minor', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(), nullable=False, server_default='INR'),
        sa.Column('balance_after_minor', sa.Integer(), nullable=False),
        sa.Column('purchase_id', sa.Integer(), sa.ForeignKey('purchases.id'), nullable=True),
        sa.Column('refund_id', sa.Integer(), sa.ForeignKey('refund_disputes.id'), nullable=True),
        sa.Column('payout_id', sa.Integer(), sa.ForeignKey('payouts.id'), nullable=True),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=True),
        sa.Column('reference', sa.String(), nullable=True),
        sa.Column('note', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_earnings_ledger_creator_id', 'earnings_ledger', ['creator_id'])
    op.create_index('ix_earnings_ledger_reference', 'earnings_ledger', ['reference'], unique=True)
    op.create_index('ix_earnings_ledger_purchase_id', 'earnings_ledger', ['purchase_id'])

    op.create_table(
        'webhook_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('provider', sa.String(), nullable=False, server_default='razorpay'),
        sa.Column('event_id', sa.String(), nullable=False),
        sa.Column('event_type', sa.String(), nullable=False),
        sa.Column('signature_valid', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('provider', 'event_id', name='uq_webhook_provider_event'),
    )
    op.create_index('ix_webhook_events_event_id', 'webhook_events', ['event_id'])

    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=True),
        sa.Column('entity_id', sa.String(), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('ip', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_audit_logs_actor_id', 'audit_logs', ['actor_id'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])

    op.create_table(
        'moderation_reports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id'), nullable=False),
        sa.Column('reporter_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reason', sa.String(), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='open'),
        sa.Column('resolved_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolution_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_moderation_reports_agent_id', 'moderation_reports', ['agent_id'])

    op.create_table(
        'platform_settings',
        sa.Column('key', sa.String(), primary_key=True),
        sa.Column('value', sa.String(), nullable=True),
        sa.Column('updated_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )

    # agents.category_id FK now that agent_categories exists
    with op.batch_alter_table('agents') as batch:
        batch.create_foreign_key('fk_agents_category_id', 'agent_categories', ['category_id'], ['id'])

    # ------------------------------------------------------------------
    # 5) Backfill: every agent without a plan gets an active FREE plan, so
    #    existing agents remain runnable and nothing is charged by default.
    currency = "INR"
    plan_rows = conn.execute(
        sa.text("""
            INSERT INTO agent_pricing_plans
                (agent_id, model, currency, amount_minor, billing_interval,
                 runs_per_pack, limits, is_active, created_at, updated_at)
            SELECT a.id, 'free', :currency, 0, NULL, NULL, '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM agents a
            WHERE NOT EXISTS (SELECT 1 FROM agent_pricing_plans p WHERE p.agent_id = a.id)
        """),
        {"currency": currency},
    )
    assert plan_rows is not None  # silence linters; executemany-style insert

    # ------------------------------------------------------------------
    # 6) Seeds: categories + default platform settings
    for slug, name, description in SEED_CATEGORIES:
        exists = conn.execute(
            sa.text("SELECT 1 FROM agent_categories WHERE slug = :slug"), {"slug": slug}
        ).first()
        if not exists:
            conn.execute(
                sa.text("""
                    INSERT INTO agent_categories (slug, name, description, created_at)
                    VALUES (:slug, :name, :description, CURRENT_TIMESTAMP)
                """),
                {"slug": slug, "name": name, "description": description},
            )

    default_settings = [
        ("commission_bps", "1000"),
        ("moderation", "off"),
    ]
    for key, value in default_settings:
        exists = conn.execute(
            sa.text("SELECT 1 FROM platform_settings WHERE key = :key"), {"key": key}
        ).first()
        if not exists:
            conn.execute(
                sa.text("""
                    INSERT INTO platform_settings (key, value, updated_at)
                    VALUES (:key, :value, CURRENT_TIMESTAMP)
                """),
                {"key": key, "value": value},
            )


def downgrade() -> None:
    """Additive downgrade: drop the new tables/columns only.
    Slugs and statuses remain on agents if the downgrade is run after data was
    written, but the columns themselves are removed."""
    with op.batch_alter_table('agents') as batch:
        batch.drop_constraint('fk_agents_category_id', type_='foreignkey')
    op.drop_table('platform_settings')
    op.drop_table('moderation_reports')
    op.drop_table('audit_logs')
    op.drop_table('webhook_events')
    op.drop_table('earnings_ledger')
    op.drop_table('payouts')
    op.drop_table('refund_disputes')
    op.drop_table('payment_transactions')
    op.drop_index('ix_entitlements_subscription_id', table_name='entitlements')
    op.drop_index('ix_entitlements_purchase_id', table_name='entitlements')
    op.drop_index('ix_entitlements_agent_id', table_name='entitlements')
    op.drop_index('ix_entitlements_buyer_id', table_name='entitlements')
    op.drop_table('entitlements')
    op.drop_index('ix_subscriptions_agent_id', table_name='subscriptions')
    op.drop_index('ix_subscriptions_buyer_id', table_name='subscriptions')
    op.drop_index('ix_subscriptions_provider_subscription_id', table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_index('ix_purchases_id', table_name='purchases')
    op.drop_index('ix_purchases_agent_id', table_name='purchases')
    op.drop_index('ix_purchases_buyer_id', table_name='purchases')
    op.drop_index('ix_purchases_reference', table_name='purchases')
    op.drop_table('purchases')
    op.drop_index('ix_agent_pricing_plans_agent_id', table_name='agent_pricing_plans')
    op.drop_index('ix_pricing_plan_active', table_name='agent_pricing_plans')
    op.drop_table('agent_pricing_plans')
    op.drop_index('ix_agent_categories_id', table_name='agent_categories')
    op.drop_index('ix_agent_categories_slug', table_name='agent_categories')
    op.drop_table('agent_categories')
    op.drop_index('ix_creator_profiles_user_id', table_name='creator_profiles')
    op.drop_table('creator_profiles')
    op.drop_index('ix_agent_runs_entitlement_id', table_name='agent_runs')
    op.drop_index('ix_agent_runs_client_request_id', table_name='agent_runs')
    with op.batch_alter_table('agent_runs') as batch:
        batch.drop_column('client_request_id')
        batch.drop_column('charge_status')
        batch.drop_column('execution_cost_minor')
        batch.drop_column('entitlement_id')
    with op.batch_alter_table('agent_ratings') as batch:
        batch.drop_column('verified_purchase')
    op.drop_index('ix_agents_slug', table_name='agents')
    with op.batch_alter_table('agents') as batch:
        batch.drop_column('moderation_note')
        batch.drop_column('featured_at')
        batch.drop_column('is_featured')
        batch.drop_column('view_count')
        batch.drop_column('published_at')
        batch.drop_column('status')
        batch.drop_column('refund_window_days')
        batch.drop_column('usage_instructions')
        batch.drop_column('faqs')
        batch.drop_column('example_prompts')
        batch.drop_column('target_audience')
        batch.drop_column('use_cases')
        batch.drop_column('features')
        batch.drop_column('problem_statement')
        batch.drop_column('tags')
        batch.drop_column('category_id')
        batch.drop_column('cover_image_url')
        batch.drop_column('avatar_url')
        batch.drop_column('tagline')
    with op.batch_alter_table('users') as batch:
        batch.drop_column('role')
