"""add fixture feed provenance

Revision ID: a9b4c7d2e601
Revises: f110d3725491
Create Date: 2026-08-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9b4c7d2e601"
down_revision: Union[str, None] = "f110d3725491"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column("fixture_provider", sa.String(length=32), nullable=True),
    )
    op.create_table(
        "fixture_feed_status",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("competition_code", sa.String(length=24), nullable=False),
        sa.Column("tournament_name", sa.String(length=120), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_kind", sa.String(length=32)),
        sa.Column("last_error", sa.String(length=500)),
        sa.Column(
            "fixture_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("latest_upstream_updated_at", sa.DateTime(timezone=True)),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.UniqueConstraint(
            "competition_code",
            name="uq_fixture_feed_status_competition",
        ),
    )


def downgrade() -> None:
    op.drop_table("fixture_feed_status")
    op.drop_column("matches", "fixture_provider")
