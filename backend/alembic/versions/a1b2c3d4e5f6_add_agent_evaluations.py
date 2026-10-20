"""add agent evaluations table

Revision ID: a1b2c3d4e5f6
Revises: 5b495ab35af6
Create Date: 2026-10-20 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '5b495ab35af6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'agent_evaluations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('input', sa.Text(), nullable=False),
        sa.Column('agent_output', sa.Text(), nullable=True),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('explanation', sa.Text(), nullable=True),
        sa.Column('criteria', sa.String(), nullable=True),
        sa.Column('criteria_scores', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_evaluations_agent_id'), 'agent_evaluations', ['agent_id'], unique=False)
    op.create_index(op.f('ix_agent_evaluations_id'), 'agent_evaluations', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_agent_evaluations_id'), table_name='agent_evaluations')
    op.drop_index(op.f('ix_agent_evaluations_agent_id'), table_name='agent_evaluations')
    op.drop_table('agent_evaluations')
