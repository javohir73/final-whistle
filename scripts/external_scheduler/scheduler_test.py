import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts.external_scheduler import scheduler
from scripts.external_scheduler.scheduler import Cron, period_before, tick

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


class FakeGitHub:
    def __init__(self, last=None, fail_list=False, fail_dispatch=False):
        self.last = last or {}
        self.fail_list = fail_list
        self.fail_dispatch = fail_dispatch
        self.dispatched = []

    def last_run_started(self, workflow):
        if self.fail_list:
            raise RuntimeError("HTTP 502")
        return self.last.get(workflow)

    def dispatch(self, workflow):
        if self.fail_dispatch:
            raise RuntimeError("HTTP 422 workflow is disabled")
        self.dispatched.append(workflow)


def run(now, state=None, gh=None, ping=lambda url: True):
    lines = []
    gh = gh or FakeGitHub()
    state = tick(now, state if state is not None else {}, gh, ping=ping, out=lines.append)
    return state, gh, lines


# --- cron ---

def test_cron_step_and_fixed_minute():
    c = Cron("7 */2 * * *")
    assert c.matches(utc(2026, 11, 21, 4, 7))
    assert not c.matches(utc(2026, 11, 21, 5, 7))
    assert not c.matches(utc(2026, 11, 21, 4, 8))


def test_cron_month_and_weekday_window():
    c = Cron("*/15 0-12 * 3-10 0,1,4,5,6")
    assert c.matches(utc(2027, 3, 7, 9, 30))        # Sunday in March
    assert not c.matches(utc(2027, 3, 9, 9, 30))    # Tuesday
    assert not c.matches(utc(2027, 3, 7, 13, 0))    # outside the hours
    assert not c.matches(utc(2026, 11, 22, 9, 30))  # Sunday, off season


def test_cron_sunday_as_7_and_dom_or_dow():
    assert Cron("0 0 * * 7").matches(utc(2026, 11, 22, 0, 0))
    either = Cron("0 0 1 * 1")
    assert either.matches(utc(2026, 12, 1, 0, 0))   # the 1st, a Tuesday
    assert either.matches(utc(2026, 11, 23, 0, 0))  # a Monday
    assert not either.matches(utc(2026, 11, 24, 0, 0))


@pytest.mark.parametrize("expr", ["* * * *", "61 * * * *", "*/0 * * * *", "5-1 * * * *"])
def test_cron_rejects_bad_expressions(expr):
    with pytest.raises(ValueError):
        Cron(expr)


def test_period_before():
    assert period_before(Cron("17 * * * *"), utc(2026, 11, 21, 4, 17)) == timedelta(hours=1)
    assert period_before(Cron("7 */2 * * *"), utc(2026, 11, 21, 0, 7)) == timedelta(hours=2)
    # First slot after a long gap is capped at a day.
    assert period_before(Cron("*/15 0-12 * 3-10 0,1,4,5,6"), utc(2027, 3, 4, 0, 0)) == timedelta(days=1)


def test_job_crons_match_the_workflow_files():
    for job in scheduler.DISPATCH_JOBS:
        text = (WORKFLOWS / job["workflow"]).read_text()
        crons = re.findall(r'^\s*- cron:\s*"([^"]+)"', text, flags=re.M)
        assert crons == [job["cron"]], job["workflow"]
        assert "workflow_dispatch" in text


# --- tick ---

# 05:17 is an odds-snapshots slot only; 04:17 also has refresh-live's 04:07 inside GRACE.

def test_dispatches_at_the_slot_and_only_once():
    state, gh, lines = run(utc(2026, 11, 21, 5, 17, 20))
    assert gh.dispatched == ["odds-snapshots.yml"]
    state, gh2, _ = run(utc(2026, 11, 21, 5, 18, 20), state)
    assert gh2.dispatched == []


def test_nothing_due_means_no_github_calls():
    _, gh, lines = run(utc(2026, 11, 21, 4, 45), gh=FakeGitHub(fail_list=True))
    assert gh.dispatched == [] and lines == []


def test_skips_when_a_run_started_within_half_a_period():
    gh = FakeGitHub(last={"odds-snapshots.yml": utc(2026, 11, 21, 4, 57)})
    state, gh, lines = run(utc(2026, 11, 21, 5, 17), gh=gh)
    assert gh.dispatched == []
    assert "skip odds-snapshots.yml" in lines[0]
    assert state["slots"]["odds-snapshots.yml"] == utc(2026, 11, 21, 5, 17).isoformat()


def test_dispatches_when_the_last_run_is_older_than_half_a_period():
    gh = FakeGitHub(last={"odds-snapshots.yml": utc(2026, 11, 21, 4, 40)})
    _, gh, _ = run(utc(2026, 11, 21, 5, 17), gh=gh)
    assert gh.dispatched == ["odds-snapshots.yml"]


def test_late_tick_inside_grace_still_dispatches_but_not_after():
    _, gh, _ = run(utc(2026, 11, 21, 5, 36))
    assert gh.dispatched == ["odds-snapshots.yml"]
    _, gh, _ = run(utc(2026, 11, 21, 5, 38))
    assert gh.dispatched == []


def test_github_error_is_retried_next_minute():
    state, gh, lines = run(utc(2026, 11, 21, 5, 17), gh=FakeGitHub(fail_list=True))
    assert "ERROR odds-snapshots.yml" in lines[0]
    assert "odds-snapshots.yml" not in state["slots"]
    _, gh2, _ = run(utc(2026, 11, 21, 5, 18), state)
    assert gh2.dispatched == ["odds-snapshots.yml"]


def test_disabled_workflow_is_logged_not_recorded():
    state, gh, lines = run(utc(2026, 11, 21, 5, 17), gh=FakeGitHub(fail_dispatch=True))
    assert "disabled" in lines[0]
    assert "odds-snapshots.yml" not in state["slots"]


def test_two_jobs_due_in_the_same_grace_window():
    _, gh, _ = run(utc(2026, 11, 21, 4, 17))
    assert gh.dispatched == ["refresh-live.yml", "odds-snapshots.yml"]  # 04:07 and 04:17


def test_nrl_live_only_in_season():
    _, gh, _ = run(utc(2026, 11, 22, 9, 30))
    assert "nrl-live-refresh.yml" not in gh.dispatched
    _, gh, _ = run(utc(2027, 3, 7, 9, 30))
    assert "nrl-live-refresh.yml" in gh.dispatched


def test_ping_every_ten_minutes_and_logs_only_changes():
    calls = []

    def ping(url):
        calls.append(url)
        return True

    state, _, lines = run(utc(2026, 11, 21, 4, 40), ping=ping)
    state, _, more = run(utc(2026, 11, 21, 4, 45), state, ping=ping)
    assert len(calls) == 1 and lines == [] and more == []
    state, _, _ = run(utc(2026, 11, 21, 4, 50), state, ping=ping)
    assert len(calls) == 2

    def down(url):
        raise OSError("timed out")

    state, _, lines = run(utc(2026, 11, 21, 5, 0, 30), state, ping=down)
    assert "FAILED timed out" in lines[-1]
    state, _, lines = run(utc(2026, 11, 21, 5, 10, 40), state, ping=down)
    assert not any("ping" in line for line in lines)
    state, _, lines = run(utc(2026, 11, 21, 5, 20, 50), state, ping=ping)
    assert "recovered" in lines[-1]
