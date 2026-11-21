#!/usr/bin/env python3
"""On-time trigger for the time-sensitive GitHub workflows.

GitHub starts this repo's `schedule:` triggers hours late and drops most of them
(an hourly cron ran 3-5 times a day through November 2026). This script is run
once a minute by launchd on an always-on machine and dispatches each workflow
at the time its cron says, through `workflow_dispatch`, using the machine's
existing `gh` login. It holds no secrets of its own.

The `schedule:` blocks stay in the workflows as a fallback. A slot is skipped
when any run of that workflow (GitHub's own late one included) started within
half a period before it, so the two triggers do not double up.

The crons below must be kept in step with `.github/workflows/*.yml` by hand.

Standard library only; runs on the system Python (3.9+).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = os.environ.get("FW_SCHEDULER_REPO", "javohir73/final-whistle")
REF = "main"
GH = os.environ.get("FW_SCHEDULER_GH", "/opt/homebrew/bin/gh")
HOME_DIR = Path(os.environ.get("FW_SCHEDULER_HOME", str(Path.home() / ".fw-scheduler")))
STATE_FILE = HOME_DIR / "state.json"
PAUSE_FILE = HOME_DIR / "PAUSED"

# A slot is still dispatched this long after its due time (machine was busy,
# GitHub was briefly unreachable). Older than this, it is left for the next slot.
GRACE = timedelta(minutes=20)

DISPATCH_JOBS = [
    {"workflow": "refresh-live.yml", "cron": "7 */2 * * *"},
    {"workflow": "odds-snapshots.yml", "cron": "17 * * * *"},
    {"workflow": "nrl-live-refresh.yml", "cron": "*/15 0-12 * 3-10 0,1,4,5,6"},
]

# Render's free tier sleeps an idle service; a plain GET keeps it awake.
PING_JOBS = [
    {"name": "keep-warm", "url": "https://pitchprophet-api.onrender.com/api/health",
     "every": timedelta(minutes=10)},
]


# --- cron ------------------------------------------------------------------

def _parse_field(expr: str, lo: int, hi: int) -> set:
    values = set()
    for part in expr.split(","):
        step = 1
        if "/" in part:
            part, step_s = part.split("/", 1)
            step = int(step_s)
            if step < 1:
                raise ValueError("cron step must be >= 1")
        if part == "*":
            start, end = lo, hi
        elif "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
        else:
            start = int(part)
            end = hi if step > 1 else start
        if start < lo or end > hi or start > end:
            raise ValueError(f"cron value out of range: {expr!r}")
        values.update(range(start, end + 1, step))
    return values


class Cron:
    """Five-field cron in UTC, with the usual day-of-month / day-of-week rule."""

    def __init__(self, expr: str):
        fields = expr.split()
        if len(fields) != 5:
            raise ValueError(f"cron needs 5 fields: {expr!r}")
        self.expr = expr
        self.minutes = _parse_field(fields[0], 0, 59)
        self.hours = _parse_field(fields[1], 0, 23)
        self.days = _parse_field(fields[2], 1, 31)
        self.months = _parse_field(fields[3], 1, 12)
        self.weekdays = {d % 7 for d in _parse_field(fields[4], 0, 7)}  # 0 and 7 = Sunday
        self._dom_any = fields[2] == "*"
        self._dow_any = fields[4] == "*"

    def matches(self, dt: datetime) -> bool:
        if dt.minute not in self.minutes or dt.hour not in self.hours:
            return False
        if dt.month not in self.months:
            return False
        dom = dt.day in self.days
        dow = (dt.isoweekday() % 7) in self.weekdays
        if self._dom_any and self._dow_any:
            return True
        if self._dom_any:
            return dow
        if self._dow_any:
            return dom
        return dom or dow

    def latest_at_or_before(self, dt: datetime, within: timedelta):
        """Most recent matching minute in (dt - within, dt], or None."""
        cur = dt.replace(second=0, microsecond=0)
        floor = dt - within
        while cur > floor:
            if self.matches(cur):
                return cur
            cur -= timedelta(minutes=1)
        return None


def period_before(cron: Cron, slot: datetime) -> timedelta:
    """Gap between `slot` and the slot before it, capped at one day."""
    cap = timedelta(days=1)
    prev = cron.latest_at_or_before(slot - timedelta(minutes=1), cap)
    return slot - prev if prev else cap


# --- GitHub ----------------------------------------------------------------

class GitHub:
    def _api(self, *args: str) -> str:
        res = subprocess.run([GH, "api", *args], capture_output=True, text=True, timeout=60)
        if res.returncode != 0:
            raise RuntimeError((res.stderr or res.stdout).strip()[:300])
        return res.stdout

    def last_run_started(self, workflow: str):
        out = self._api(f"repos/{REPO}/actions/workflows/{workflow}/runs?per_page=1",
                        "-q", ".workflow_runs[0].created_at // empty").strip()
        if not out:
            return None
        return datetime.strptime(out, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)

    def dispatch(self, workflow: str) -> None:
        self._api("-X", "POST", f"repos/{REPO}/actions/workflows/{workflow}/dispatches",
                  "-f", f"ref={REF}")


def http_ok(url: str) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": "fw-scheduler"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return 200 <= resp.status < 300


# --- one tick --------------------------------------------------------------

def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} {msg}", flush=True)


def tick(now: datetime, state: dict, github, ping=http_ok, out=log) -> dict:
    """Do whatever is due at `now`. Mutates and returns `state`."""
    slots = state.setdefault("slots", {})
    for job in DISPATCH_JOBS:
        workflow = job["workflow"]
        cron = Cron(job["cron"])
        slot = cron.latest_at_or_before(now, GRACE)
        if slot is None or slots.get(workflow) == slot.isoformat():
            continue
        try:
            last = github.last_run_started(workflow)
            if last is not None and last >= slot - period_before(cron, slot) / 2:
                out(f"skip {workflow} slot {slot:%H:%M}: a run started {last:%Y-%m-%d %H:%M}Z")
            else:
                github.dispatch(workflow)
                out(f"dispatched {workflow} slot {slot:%H:%M}")
            slots[workflow] = slot.isoformat()
        except Exception as exc:  # retried next minute, until the slot ages out of GRACE
            out(f"ERROR {workflow} slot {slot:%H:%M}: {exc}")

    pings = state.setdefault("pings", {})
    for job in PING_JOBS:
        prev = pings.get(job["name"], {})
        last_at = prev.get("at")
        if last_at and now - datetime.fromisoformat(last_at) < job["every"]:
            continue
        try:
            ok = bool(ping(job["url"]))
            err = "" if ok else "non-2xx"
        except Exception as exc:
            ok, err = False, str(exc)[:200]
        if ok != prev.get("ok", True) or (not ok and not prev):
            out(f"ping {job['name']}: {'recovered' if ok else 'FAILED ' + err}")
        pings[job["name"]] = {"at": now.isoformat(), "ok": ok}
    return state


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    HOME_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1, sort_keys=True))
    tmp.replace(STATE_FILE)


def main(argv: list) -> int:
    if len(argv) > 1 and argv[1] == "status":
        print(f"paused: {PAUSE_FILE.exists()}")
        print(json.dumps(load_state(), indent=1, sort_keys=True))
        return 0
    if PAUSE_FILE.exists():
        return 0
    state = load_state()
    tick(datetime.now(timezone.utc), state, GitHub())
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
