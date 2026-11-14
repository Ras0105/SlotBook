"""provider profile (photo, description, category, rating summary) and reviews

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-15 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default keeps existing provider rows valid ("other", no reviews yet).
    op.add_column('providers', sa.Column('description', sa.String(length=500), nullable=True))
    op.add_column('providers', sa.Column('category', sa.String(length=32), server_default='other', nullable=False))
    op.add_column('providers', sa.Column('photo_data', sa.LargeBinary(), nullable=True))
    op.add_column('providers', sa.Column('photo_content_type', sa.String(length=32), nullable=True))
    op.add_column('providers', sa.Column('photo_updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('providers', sa.Column('rating_avg', sa.Float(), nullable=True))
    op.add_column('providers', sa.Column('review_count', sa.Integer(), server_default='0', nullable=False))

    op.create_table('reviews',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('appointment_id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('customer_id', sa.Integer(), nullable=False),
    sa.Column('rating', sa.Integer(), nullable=False),
    sa.Column('comment', sa.String(length=1000), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('rating BETWEEN 1 AND 5', name=op.f('ck_reviews_rating_range')),
    sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], name=op.f('fk_reviews_appointment_id_appointments')),
    sa.ForeignKeyConstraint(['customer_id'], ['users.id'], name=op.f('fk_reviews_customer_id_users')),
    sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], name=op.f('fk_reviews_provider_id_providers')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_reviews')),
    sa.UniqueConstraint('appointment_id', name=op.f('uq_reviews_appointment_id'))
    )
    op.create_index(op.f('ix_reviews_customer_id'), 'reviews', ['customer_id'], unique=False)
    op.create_index(op.f('ix_reviews_provider_id'), 'reviews', ['provider_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_reviews_provider_id'), table_name='reviews')
    op.drop_index(op.f('ix_reviews_customer_id'), table_name='reviews')
    op.drop_table('reviews')
    op.drop_column('providers', 'review_count')
    op.drop_column('providers', 'rating_avg')
    op.drop_column('providers', 'photo_updated_at')
    op.drop_column('providers', 'photo_content_type')
    op.drop_column('providers', 'photo_data')
    op.drop_column('providers', 'category')
    op.drop_column('providers', 'description')
