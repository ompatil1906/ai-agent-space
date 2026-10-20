"""add execution controls, run metrics, and credit ledger

Revision ID: c8d9e0f1a2b3
Revises: a1b2c3d4e5f6
Create Date: 2026-10-20 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agents', sa.Column('max_steps', sa.Integer(), nullable=True, server_default=sa.text('25')))
    op.add_column('agents', sa.Column('autonomy_level', sa.String(), nullable=True, server_default='supervised'))
    op.add_column('agents', sa.Column('sandbox_enabled', sa.Boolean(), nullable=True, server_default=sa.false()))
    op.add_column('agents', sa.Column('advanced_config', sa.JSON(), nullable=True))

    op.add_column('agent_runs', sa.Column('latency_ms', sa.Integer(), nullable=True))
    op.add_column('agent_runs', sa.Column('steps_count', sa.Integer(), nullable=True))

    op.create_table(
        'credit_transactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('balance_after', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(), nullable=False),
        sa.Column('counterparty_user_id', sa.Integer(), nullable=True),
        sa.Column('agent_id', sa.Integer(), nullable=True),
        sa.Column('reference_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['counterparty_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_credit_transactions_user_id'), 'credit_transactions', ['user_id'], unique=False)
    op.create_index(op.f('ix_credit_transactions_id'), 'credit_transactions', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_credit_transactions_id'), table_name='credit_transactions')
    op.drop_index(op.f('ix_credit_transactions_user_id'), table_name='credit_transactions')
    op.drop_table('credit_transactions')

    op.drop_column('agent_runs', 'steps_count')
    op.drop_column('agent_runs', 'latency_ms')

    op.drop_column('agents', 'advanced_config')
    op.drop_column('agents', 'sandbox_enabled')
    op.drop_column('agents', 'autonomy_level')
    op.drop_column('agents', 'max_steps')
