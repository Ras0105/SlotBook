"""email verification and session token version

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-17 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('token_version', sa.Integer(), server_default='0', nullable=False))
    # Everyone who already has an account keeps working: they are treated as verified from today on.
    op.execute("UPDATE users SET email_verified_at = now()")


def downgrade() -> None:
    op.drop_column('users', 'token_version')
    op.drop_column('users', 'email_verified_at')
