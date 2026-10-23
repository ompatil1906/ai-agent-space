"""mcp server connection status + catalog metadata

Revision ID: i4j5k6l7m8n9
Revises: h3i4j5k6l7m8
Create Date: 2026-10-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i4j5k6l7m8n9'
down_revision: Union[str, Sequence[str], None] = 'h3i4j5k6l7m8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mcp_servers', sa.Column('logo_slug', sa.String(), nullable=True))
    op.add_column('mcp_servers', sa.Column('category', sa.String(), nullable=True))
    op.add_column('mcp_servers', sa.Column('last_status', sa.String(), nullable=True))
    op.add_column('mcp_servers', sa.Column('last_checked_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('mcp_servers', 'last_checked_at')
    op.drop_column('mcp_servers', 'last_status')
    op.drop_column('mcp_servers', 'category')
    op.drop_column('mcp_servers', 'logo_slug')
