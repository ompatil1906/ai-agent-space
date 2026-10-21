"""add token usage and cost tracking to agent runs

Revision ID: d1e2f3a4b5c6
Revises: c8d9e0f1a2b3
Create Date: 2026-10-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agent_runs', sa.Column('input_tokens', sa.Integer(), nullable=True, server_default=sa.text('0')))
    op.add_column('agent_runs', sa.Column('output_tokens', sa.Integer(), nullable=True, server_default=sa.text('0')))
    op.add_column('agent_runs', sa.Column('total_tokens', sa.Integer(), nullable=True, server_default=sa.text('0')))
    op.add_column('agent_runs', sa.Column('estimated_cost_usd', sa.Float(), nullable=True, server_default=sa.text('0.0')))


def downgrade() -> None:
    op.drop_column('agent_runs', 'estimated_cost_usd')
    op.drop_column('agent_runs', 'total_tokens')
    op.drop_column('agent_runs', 'output_tokens')
    op.drop_column('agent_runs', 'input_tokens')
