# backend/tests/test_billing_had_subscription_migration.py
"""The subscriptions.had_subscription migration.

Two things get checked: the revision graph stays a single line with unique ids
(this repo has already lost time to a revision-id collision copied out of a
task brief), and the upgrade itself adds the column and backfills the users who
have already held a Stripe subscription — without that backfill every existing
subscriber would look trial-eligible again.

The whole chain can't be replayed on SQLite (an older migration uses
drop_constraint), so the upgrade is run alone against a minimal table.
"""
import collections
import pathlib

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

BACKEND = pathlib.Path(__file__).resolve().parents[1]
REVISION = "f110d3725491"


def _scripts() -> ScriptDirectory:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return ScriptDirectory.from_config(cfg)


def test_revision_ids_are_unique():
    seen = collections.Counter(s.revision for s in _scripts().walk_revisions())
    assert [r for r, n in seen.items() if n > 1] == []


def test_single_head_at_this_revision():
    scripts = _scripts()
    assert scripts.get_heads() == [REVISION]
    assert scripts.get_revision(REVISION).down_revision == "e0fe02d971ed"


def test_upgrade_adds_column_and_backfills_existing_subscribers():
    module = _scripts().get_revision(REVISION).module
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE subscriptions (id INTEGER PRIMARY KEY, "
            "stripe_subscription_id VARCHAR(255))")
        conn.exec_driver_sql(
            "INSERT INTO subscriptions (id, stripe_subscription_id) "
            "VALUES (1, 'sub_old'), (2, NULL)")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
        rows = dict(conn.exec_driver_sql(
            "SELECT id, had_subscription FROM subscriptions").all())
    assert rows[1] == 1  # has held a subscription -> no second trial
    assert rows[2] == 0  # never bound -> still a first-timer
