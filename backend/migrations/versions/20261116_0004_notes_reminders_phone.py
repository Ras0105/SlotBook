"""booking notes, reminders, phone numbers, review edits

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-16 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('appointments', sa.Column('notes', sa.String(length=500), nullable=True))
    op.add_column('appointments', sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('reminders_enabled', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('reviews', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    # Appointments that already exist were booked before reminders existed: do not send them a surprise one.
    op.execute("UPDATE appointments SET reminder_sent_at = now() WHERE start_at < now() + interval '24 hours'")


def downgrade() -> None:
    op.drop_column('reviews', 'updated_at')
    op.drop_column('users', 'reminders_enabled')
    op.drop_column('users', 'phone')
    op.drop_column('appointments', 'reminder_sent_at')
    op.drop_column('appointments', 'notes')
