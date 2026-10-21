"""add thread_id to agent_runs for multi-turn conversations

Revision ID: e3f4a5b6c7d8
Revises: d1e2f3a4b5c6
Create Date: 2026-10-21 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agent_runs', sa.Column('thread_id', sa.String(), nullable=True))
    op.create_index(op.f('ix_agent_runs_thread_id'), 'agent_runs', ['thread_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_agent_runs_thread_id'), table_name='agent_runs')
    op.drop_column('agent_runs', 'thread_id')
