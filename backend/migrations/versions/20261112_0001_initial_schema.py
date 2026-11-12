"""initial schema: users, providers, availability, blocked slots, appointments, history

Revision ID: 0001
Revises: 
Create Date: 2026-11-12 20:44:42.933852
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The exclusion constraints below combine "=" on an integer column with "&&" on a range,
    # which PostgreSQL only supports when btree_gist is installed. (Needs a role allowed to create it.)
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # Enum types are created once here and referenced with create_type=False, otherwise the second
    # table that uses appointmentstatus would try to CREATE TYPE again and fail.
    role = postgresql.ENUM("customer", "provider", "admin", name="role")
    appointment_status = postgresql.ENUM("booked", "cancelled", "completed", name="appointmentstatus")
    role.create(op.get_bind(), checkfirst=True)
    appointment_status.create(op.get_bind(), checkfirst=True)

    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', postgresql.ENUM('customer', 'provider', 'admin', name='role', create_type=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_table('providers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('service_name', sa.String(length=150), nullable=False),
    sa.Column('appointment_duration_minutes', sa.Integer(), nullable=False),
    sa.Column('timezone', sa.String(length=64), server_default='UTC', nullable=False),
    sa.CheckConstraint('appointment_duration_minutes > 0', name=op.f('ck_providers_duration_positive')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_providers_user_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_providers')),
    sa.UniqueConstraint('user_id', name=op.f('uq_providers_user_id'))
    )
    op.create_table('appointments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('customer_id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('start_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('end_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('status', postgresql.ENUM('booked', 'cancelled', 'completed', name='appointmentstatus', create_type=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    postgresql.ExcludeConstraint((sa.column('provider_id'), '='), (sa.literal_column("tstzrange(start_at, end_at, '[)')"), '&&'), where=sa.text("status = 'booked'"), using='gist', name='ex_appointments_no_overlap'),
    sa.CheckConstraint('start_at < end_at', name=op.f('ck_appointments_start_before_end')),
    sa.ForeignKeyConstraint(['customer_id'], ['users.id'], name=op.f('fk_appointments_customer_id_users')),
    sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], name=op.f('fk_appointments_provider_id_providers')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_appointments'))
    )
    op.create_index(op.f('ix_appointments_customer_id'), 'appointments', ['customer_id'], unique=False)
    op.create_index('ix_appointments_provider_start', 'appointments', ['provider_id', 'start_at'], unique=False)
    op.create_index('ix_appointments_start_at', 'appointments', ['start_at'], unique=False)
    op.create_table('availability',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('weekday', sa.SmallInteger(), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=False),
    sa.Column('end_time', sa.Time(), nullable=False),
    postgresql.ExcludeConstraint((sa.column('provider_id'), '='), (sa.column('weekday'), '='), (sa.literal_column("tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time, '[)')"), '&&'), using='gist', name='ex_availability_no_overlap'),
    sa.CheckConstraint('start_time < end_time', name=op.f('ck_availability_start_before_end')),
    sa.CheckConstraint('weekday BETWEEN 0 AND 6', name=op.f('ck_availability_weekday_range')),
    sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], name=op.f('fk_availability_provider_id_providers')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_availability'))
    )
    op.create_index(op.f('ix_availability_provider_id'), 'availability', ['provider_id'], unique=False)
    op.create_table('blocked_slots',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('start_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('end_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reason', sa.String(length=255), nullable=True),
    sa.CheckConstraint('start_at < end_at', name=op.f('ck_blocked_slots_start_before_end')),
    sa.ForeignKeyConstraint(['provider_id'], ['providers.id'], name=op.f('fk_blocked_slots_provider_id_providers')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_blocked_slots'))
    )
    op.create_index(op.f('ix_blocked_slots_provider_id'), 'blocked_slots', ['provider_id'], unique=False)
    op.create_table('appointment_history',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('appointment_id', sa.Integer(), nullable=False),
    sa.Column('old_status', postgresql.ENUM('booked', 'cancelled', 'completed', name='appointmentstatus', create_type=False), nullable=True),
    sa.Column('new_status', postgresql.ENUM('booked', 'cancelled', 'completed', name='appointmentstatus', create_type=False), nullable=False),
    sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('changed_by', sa.Integer(), nullable=False),
    sa.Column('note', sa.String(length=255), nullable=True),
    sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], name=op.f('fk_appointment_history_appointment_id_appointments')),
    sa.ForeignKeyConstraint(['changed_by'], ['users.id'], name=op.f('fk_appointment_history_changed_by_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_appointment_history'))
    )
    op.create_index(op.f('ix_appointment_history_appointment_id'), 'appointment_history', ['appointment_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_appointment_history_appointment_id'), table_name='appointment_history')
    op.drop_table('appointment_history')
    op.drop_index(op.f('ix_blocked_slots_provider_id'), table_name='blocked_slots')
    op.drop_table('blocked_slots')
    op.drop_index(op.f('ix_availability_provider_id'), table_name='availability')
    op.drop_table('availability')
    op.drop_index('ix_appointments_start_at', table_name='appointments')
    op.drop_index('ix_appointments_provider_start', table_name='appointments')
    op.drop_index(op.f('ix_appointments_customer_id'), table_name='appointments')
    op.drop_table('appointments')
    op.drop_table('providers')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.execute("DROP TYPE IF EXISTS appointmentstatus")
    op.execute("DROP TYPE IF EXISTS role")
    # btree_gist is deliberately left installed: other objects may rely on it.
