"""agent run mode (chat | automation) + task title

Revision ID: k6l7m8n9o1p0
Revises: j5k6l7m8n9o0
Create Date: 2026-10-24 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'k6l7m8n9o1p0'
down_revision: Union[str, Sequence[str], None] = 'j5k6l7m8n9o0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agent_runs', sa.Column('mode', sa.String(), nullable=False, server_default='chat'))
    op.add_column('agent_runs', sa.Column('title', sa.String(), nullable=True))
    op.create_index('ix_agent_runs_mode', 'agent_runs', ['mode'])


def downgrade() -> None:
    op.drop_index('ix_agent_runs_mode', table_name='agent_runs')
    op.drop_column('agent_runs', 'title')
    op.drop_column('agent_runs', 'mode')
