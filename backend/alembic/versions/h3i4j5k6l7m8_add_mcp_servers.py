"""add mcp_servers table

Revision ID: h3i4j5k6l7m8
Revises: g2h3i4j5k6l7
Create Date: 2026-10-22 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h3i4j5k6l7m8'
down_revision: Union[str, None] = 'g2h3i4j5k6l7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mcp_servers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('is_public', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_mcp_servers_id'), 'mcp_servers', ['id'], unique=False)
    op.create_index(op.f('ix_mcp_servers_owner_id'), 'mcp_servers', ['owner_id'], unique=False)
    op.create_index(op.f('ix_mcp_servers_name'), 'mcp_servers', ['name'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_mcp_servers_name'), table_name='mcp_servers')
    op.drop_index(op.f('ix_mcp_servers_owner_id'), table_name='mcp_servers')
    op.drop_index(op.f('ix_mcp_servers_id'), table_name='mcp_servers')
    op.drop_table('mcp_servers')
