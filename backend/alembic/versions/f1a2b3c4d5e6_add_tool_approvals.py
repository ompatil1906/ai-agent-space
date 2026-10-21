"""add tool_approvals table for persistent HITL

Revision ID: f1a2b3c4d5e6
Revises: e3f4a5b6c7d8
Create Date: 2026-10-21 14:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tool_approvals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('agent_id', sa.Integer(), nullable=False),
        sa.Column('thread_id', sa.String(), nullable=True),
        sa.Column('tool_name', sa.String(), nullable=False),
        sa.Column('tool_args', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_tool_approvals_request_id'), 'tool_approvals', ['request_id'], unique=True)
    op.create_index(op.f('ix_tool_approvals_user_id'), 'tool_approvals', ['user_id'], unique=False)
    op.create_index(op.f('ix_tool_approvals_agent_id'), 'tool_approvals', ['agent_id'], unique=False)
    op.create_index(op.f('ix_tool_approvals_thread_id'), 'tool_approvals', ['thread_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_tool_approvals_thread_id'), table_name='tool_approvals')
    op.drop_index(op.f('ix_tool_approvals_agent_id'), table_name='tool_approvals')
    op.drop_index(op.f('ix_tool_approvals_user_id'), table_name='tool_approvals')
    op.drop_index(op.f('ix_tool_approvals_request_id'), table_name='tool_approvals')
    op.drop_table('tool_approvals')
