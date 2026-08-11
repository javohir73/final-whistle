"""add subscriptions.had_subscription (durable first-timer flag)

The 7-day trial guard moves from "no Subscription row" to "has never held a
Stripe subscription". POST /api/billing/setup-intent now writes a row purely to
hold stripe_customer_id before any subscription exists, so a row-based guard
would read every user as a returning subscriber and deny all trials.

stripe_subscription_id can't stand in for this on its own: it is rebound over a
subscriber's lifetime. The backfill marks everyone currently bound to one — skip
it and every existing subscriber becomes trial-eligible again.

Revision ID: f110d3725491
Revises: e0fe02d971ed
Create Date: 2026-08-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f110d3725491"
down_revision: Union[str, None] = "e0fe02d971ed"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("subscriptions",
                  sa.Column("had_subscription", sa.Boolean(), nullable=False,
                            server_default=sa.false()))
    op.execute("UPDATE subscriptions SET had_subscription = true "
               "WHERE stripe_subscription_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("subscriptions", "had_subscription")
