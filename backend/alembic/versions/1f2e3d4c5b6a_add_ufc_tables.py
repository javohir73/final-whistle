"""add ufc_* tables (UFC as the third sport)

Nine new, fully separate tables: fighters, events, bouts, per-fighter bout
stats, odds snapshots, predictions and their evaluated results, user picks and
live state. A bout is identified by (provider, provider_bout_id, revision); a
re-made fight is a new revision and the old row points at it through
replaced_by_id (a self-referencing FK, declared inline in create_table so it
works on both SQLite and PostgreSQL). Additive only: no football or NRL table
is touched.

Revision ID: 1f2e3d4c5b6a
Revises: a9b4c7d2e601
Create Date: 2026-11-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "1f2e3d4c5b6a"
down_revision: Union[str, None] = "a9b4c7d2e601"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _updated_at() -> sa.Column:
    return sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now())


def upgrade() -> None:
    op.create_table(
        "ufc_fighters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_fighter_id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=140), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("height_in", sa.Float(), nullable=True),
        sa.Column("reach_in", sa.Float(), nullable=True),
        sa.Column("weight_lb", sa.Float(), nullable=True),
        sa.Column("stance", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=60), nullable=True),
        sa.Column("gender", sa.String(length=10), nullable=True),
        sa.Column("rating", sa.Float(), nullable=False, server_default="1500"),
        _updated_at(),
        sa.UniqueConstraint("provider", "provider_fighter_id", name="uq_ufc_fighter_provider_id"),
    )
    op.create_index("ix_ufc_fighters_slug", "ufc_fighters", ["slug"], unique=True)

    op.create_table(
        "ufc_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_event_id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=220), nullable=False),
        sa.Column("first_bout_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_bout_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("venue", sa.String(length=160), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="scheduled"),
        sa.Column("is_card", sa.Boolean(), nullable=False, server_default=sa.true()),
        _updated_at(),
        sa.UniqueConstraint("provider", "provider_event_id", name="uq_ufc_event_provider_id"),
    )
    op.create_index("ix_ufc_events_slug", "ufc_events", ["slug"], unique=True)

    op.create_table(
        "ufc_bouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("ufc_events.id"), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_bout_id", sa.String(length=40), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("card_order", sa.Integer(), nullable=True),
        sa.Column("segment", sa.String(length=20), nullable=True),
        sa.Column("segment_label", sa.String(length=40), nullable=True),
        sa.Column("weight_class", sa.String(length=60), nullable=True),
        sa.Column("scheduled_rounds", sa.Integer(), nullable=True),
        sa.Column("is_title", sa.Boolean(), nullable=True),
        sa.Column("fighter_a_id", sa.Integer(), sa.ForeignKey("ufc_fighters.id"), nullable=False),
        sa.Column("fighter_b_id", sa.Integer(), sa.ForeignKey("ufc_fighters.id"), nullable=False),
        sa.Column("scheduled_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="scheduled"),
        sa.Column("winner", sa.String(length=1), nullable=True),
        sa.Column("method", sa.String(length=20), nullable=True),
        sa.Column("method_detail", sa.String(length=120), nullable=True),
        sa.Column("end_round", sa.Integer(), nullable=True),
        sa.Column("end_clock", sa.String(length=8), nullable=True),
        sa.Column(
            "replaced_by_id",
            sa.Integer(),
            sa.ForeignKey("ufc_bouts.id", name="fk_ufc_bouts_replaced_by_id"),
            nullable=True,
        ),
        _updated_at(),
        sa.UniqueConstraint(
            "provider", "provider_bout_id", "revision", name="uq_ufc_bout_provider_id_revision"
        ),
    )
    op.create_index("ix_ufc_bouts_event_id", "ufc_bouts", ["event_id"])
    op.create_index("ix_ufc_bouts_fighter_a_id", "ufc_bouts", ["fighter_a_id"])
    op.create_index("ix_ufc_bouts_fighter_b_id", "ufc_bouts", ["fighter_b_id"])

    op.create_table(
        "ufc_bout_stats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bout_id", sa.Integer(), sa.ForeignKey("ufc_bouts.id"), nullable=False),
        sa.Column("fighter_id", sa.Integer(), sa.ForeignKey("ufc_fighters.id"), nullable=False),
        sa.Column("knockdowns", sa.Integer(), nullable=True),
        sa.Column("sig_strikes_landed", sa.Integer(), nullable=True),
        sa.Column("sig_strikes_attempted", sa.Integer(), nullable=True),
        sa.Column("total_strikes_landed", sa.Integer(), nullable=True),
        sa.Column("total_strikes_attempted", sa.Integer(), nullable=True),
        sa.Column("takedowns_landed", sa.Integer(), nullable=True),
        sa.Column("takedowns_attempted", sa.Integer(), nullable=True),
        sa.Column("submission_attempts", sa.Integer(), nullable=True),
        sa.Column("reversals", sa.Integer(), nullable=True),
        sa.Column("control_seconds", sa.Integer(), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("judges", sa.JSON(), nullable=True),
        sa.UniqueConstraint("bout_id", "fighter_id", name="uq_ufc_bout_stat_bout_fighter"),
    )
    op.create_index("ix_ufc_bout_stats_bout_id", "ufc_bout_stats", ["bout_id"])

    op.create_table(
        "ufc_odds_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bout_id", sa.Integer(), sa.ForeignKey("ufc_bouts.id"), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("moneyline_a", sa.Integer(), nullable=False),
        sa.Column("moneyline_b", sa.Integer(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ufc_odds_snapshots_bout_id", "ufc_odds_snapshots", ["bout_id"])
    op.create_index("ix_ufc_odds_snapshots_bout_source", "ufc_odds_snapshots", ["bout_id", "source"])

    op.create_table(
        "ufc_predictions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bout_id", sa.Integer(), sa.ForeignKey("ufc_bouts.id"), nullable=False),
        sa.Column("model_version", sa.String(length=40), nullable=False),
        sa.Column("p_a", sa.Float(), nullable=False),
        sa.Column("p_b", sa.Float(), nullable=False),
        sa.Column("method_probs", sa.JSON(), nullable=True),
        sa.Column("reasons", sa.JSON(), nullable=True),
        sa.Column("is_shadow", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ufc_predictions_bout_id", "ufc_predictions", ["bout_id"])

    op.create_table(
        "ufc_prediction_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prediction_id", sa.Integer(), sa.ForeignKey("ufc_predictions.id"), nullable=False),
        sa.Column("bout_id", sa.Integer(), sa.ForeignKey("ufc_bouts.id"), nullable=False),
        sa.Column("model_version", sa.String(length=40), nullable=False),
        sa.Column("winner_correct", sa.Boolean(), nullable=False),
        sa.Column("prob_assigned", sa.Float(), nullable=False),
        sa.Column("log_loss", sa.Float(), nullable=False),
        sa.Column("brier", sa.Float(), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("prediction_id", name="uq_ufc_prediction_results_prediction_id"),
    )
    op.create_index("ix_ufc_prediction_results_bout_id", "ufc_prediction_results", ["bout_id"])

    op.create_table(
        "ufc_picks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bout_id", sa.Integer(), sa.ForeignKey("ufc_bouts.id"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("tip_players.id"), nullable=False),
        sa.Column("winner", sa.String(length=1), nullable=False),
        sa.Column("method", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("points", sa.Integer(), nullable=True),
        sa.Column("winner_correct", sa.Boolean(), nullable=True),
        sa.Column("method_correct", sa.Boolean(), nullable=True),
        sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("bout_id", "player_id", name="uq_ufc_pick_bout_player"),
    )
    op.create_index("ix_ufc_picks_bout_id", "ufc_picks", ["bout_id"])
    op.create_index("ix_ufc_picks_player_id", "ufc_picks", ["player_id"])

    op.create_table(
        "ufc_live_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bout_id", sa.Integer(), sa.ForeignKey("ufc_bouts.id"), nullable=False),
        sa.Column("state", sa.String(length=10), nullable=False),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column("clock", sa.String(length=8), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        _updated_at(),
    )
    op.create_index("ix_ufc_live_state_bout_id", "ufc_live_state", ["bout_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_ufc_live_state_bout_id", table_name="ufc_live_state")
    op.drop_table("ufc_live_state")
    op.drop_index("ix_ufc_picks_player_id", table_name="ufc_picks")
    op.drop_index("ix_ufc_picks_bout_id", table_name="ufc_picks")
    op.drop_table("ufc_picks")
    op.drop_index("ix_ufc_prediction_results_bout_id", table_name="ufc_prediction_results")
    op.drop_table("ufc_prediction_results")
    op.drop_index("ix_ufc_predictions_bout_id", table_name="ufc_predictions")
    op.drop_table("ufc_predictions")
    op.drop_index("ix_ufc_odds_snapshots_bout_source", table_name="ufc_odds_snapshots")
    op.drop_index("ix_ufc_odds_snapshots_bout_id", table_name="ufc_odds_snapshots")
    op.drop_table("ufc_odds_snapshots")
    op.drop_index("ix_ufc_bout_stats_bout_id", table_name="ufc_bout_stats")
    op.drop_table("ufc_bout_stats")
    op.drop_index("ix_ufc_bouts_fighter_b_id", table_name="ufc_bouts")
    op.drop_index("ix_ufc_bouts_fighter_a_id", table_name="ufc_bouts")
    op.drop_index("ix_ufc_bouts_event_id", table_name="ufc_bouts")
    op.drop_table("ufc_bouts")
    op.drop_index("ix_ufc_events_slug", table_name="ufc_events")
    op.drop_table("ufc_events")
    op.drop_index("ix_ufc_fighters_slug", table_name="ufc_fighters")
    op.drop_table("ufc_fighters")
