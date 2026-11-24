"""UFC tables: defaults, the identity constraints later tasks lean on, and a
check that the hand-written migration creates exactly the modelled tables."""
from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import Base
from app.models import (
    TipPlayer,
    UfcBout,
    UfcEvent,
    UfcFighter,
    UfcPick,
)

UFC_TABLES = {
    "ufc_fighters",
    "ufc_events",
    "ufc_bouts",
    "ufc_bout_stats",
    "ufc_odds_snapshots",
    "ufc_predictions",
    "ufc_prediction_results",
    "ufc_picks",
    "ufc_live_state",
}
MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic" / "versions" / "1f2e3d4c5b6a_add_ufc_tables.py"
)


def _fighter(provider_id: str, name: str) -> UfcFighter:
    return UfcFighter(
        provider="espn", provider_fighter_id=provider_id, name=name, slug=name.lower().replace(" ", "-")
    )


def _card(db_session):
    event = UfcEvent(provider="espn", provider_event_id="e1", name="UFC 1", slug="ufc-1")
    a, b = _fighter("f1", "Fighter One"), _fighter("f2", "Fighter Two")
    db_session.add_all([event, a, b])
    db_session.flush()
    return event, a, b


def _bout(event, a, b, provider_bout_id="401", revision=0) -> UfcBout:
    return UfcBout(
        event_id=event.id, provider="espn", provider_bout_id=provider_bout_id,
        revision=revision, fighter_a_id=a.id, fighter_b_id=b.id,
    )


def test_bout_roundtrip_defaults(db_session):
    event, a, b = _card(db_session)
    db_session.add(_bout(event, a, b))
    db_session.commit()
    bout = db_session.query(UfcBout).one()
    assert bout.status == "scheduled" and bout.revision == 0 and bout.winner is None
    assert bout.replaced_by_id is None
    fighter = db_session.get(UfcFighter, a.id)
    event = db_session.get(UfcEvent, event.id)
    assert fighter.rating == 1500.0 and event.is_card is True
    assert event.status == "scheduled"


def test_fighter_provider_id_is_unique(db_session):
    db_session.add(_fighter("f1", "Fighter One"))
    db_session.commit()
    db_session.add(_fighter("f1", "Someone Else"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_bout_identity_allows_a_new_revision(db_session):
    event, a, b = _card(db_session)
    db_session.add_all([_bout(event, a, b, "401", 0), _bout(event, a, b, "401", 1)])
    db_session.commit()
    db_session.add(_bout(event, a, b, "401", 1))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_bout_can_point_at_its_replacement(db_session):
    event, a, b = _card(db_session)
    old, new = _bout(event, a, b, "401", 0), _bout(event, a, b, "401", 1)
    db_session.add_all([old, new])
    db_session.flush()
    old.replaced_by_id = new.id
    old.status = "changed"
    db_session.commit()
    assert db_session.get(UfcBout, old.id).replaced_by_id == new.id


def test_pick_is_unique_per_bout_and_player(db_session):
    event, a, b = _card(db_session)
    bout = _bout(event, a, b)
    player = TipPlayer(device_id="dev-1", handle="Tipper")
    db_session.add_all([bout, player])
    db_session.flush()
    db_session.add(UfcPick(bout_id=bout.id, player_id=player.id, winner="a"))
    db_session.commit()
    db_session.add(UfcPick(bout_id=bout.id, player_id=player.id, winner="b"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_migration_creates_the_same_tables_as_the_models():
    tree = ast.parse(MIGRATION.read_text())
    upgrade = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade")
    created = {
        node.args[0].value
        for node in ast.walk(upgrade)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "create_table"
    }
    assert created == UFC_TABLES
    assert UFC_TABLES <= set(Base.metadata.tables)

    spec = importlib.util.spec_from_file_location("ufc_migration", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "1f2e3d4c5b6a"
    assert module.down_revision == "a9b4c7d2e601"
