"""Premium subscriptions: subscriptions + billing_events.

One subscription row per user (FinalWhistle Premium), written by Stripe
webhooks; billing_events is the processed-webhook idempotency ledger.

Revision ID: e0fe02d971ed
Revises: e2f3a4b5c6d7
Create Date: 2026-08-11

Note: the task brief specified revision id `a1b2c3d4e5f6`, but that id was
already taken by the long-merged `add_venue_city` migration (a coincidental
collision in this repo's id scheme). Regenerated as `e0fe02d971ed` to keep
the revision graph a single line; `down_revision` is unchanged.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e0fe02d971ed"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id"),
                  nullable=False, unique=True, index=True),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True, index=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True,
                  unique=True, index=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("plan", sa.String(length=10), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "billing_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.String(length=255), nullable=False,
                  unique=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("billing_events")
    op.drop_table("subscriptions")
