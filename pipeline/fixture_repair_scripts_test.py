"""Static checks for the runbook's shell scripts (their behaviour against a
real Postgres is rehearsed outside CI: fw-pg-rehearsal/scripts/r5/
backup_restore_test.sh)."""
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ["fixture_repair_backup.sh", "fixture_repair_restore.sh", "fixture_repair_writers.sh"]


@pytest.mark.parametrize("name", SCRIPTS)
def test_scripts_parse_under_macos_bash_and_fail_fast(name):
    path = ROOT / "scripts" / name
    assert os.access(path, os.X_OK)
    subprocess.run(["/bin/bash", "-n", str(path)], check=True)
    source = path.read_text()
    assert "set -euo pipefail" in source
    # The URL and password never reach the terminal, history or ps.
    for leak in ("echo \"$DATABASE_URL", "PGPASSWORD=", "--dbname=\"$PGURL", "$PGURL"):
        assert leak not in source


def test_restore_checks_everything_before_the_one_transaction():
    source = (ROOT / "scripts" / "fixture_repair_restore.sh").read_text()
    source = source.split("set -euo pipefail", 1)[1]  # code only, not the header
    order = [
        'shasum -a 256 "$DUMP"',
        '[ "$META_RESTORE_REHEARSED" = "True" ]',
        'fw_require_client_major "$META_SERVER_MAJOR"',
        'pg_restore --no-owner --no-acl --file="$WORK/plain.sql"',
        'fw_load_target "$ENV_FILE" target',
        '[ "$PGHOST" = "$META_HOST" ]',
        "fw_server_identity",
        "read -r ANSWER",
        "--single-transaction --set ON_ERROR_STOP=1",
        "restore committed and verified",
    ]
    positions = [source.index(marker) for marker in order]
    assert positions == sorted(positions)
    assert "lock_timeout=5s" in source


@pytest.mark.parametrize("name", ["fixture_repair_backup.sh", "fixture_repair_restore.sh"])
def test_scripts_ignore_the_callers_libpq_environment(name):
    source = (ROOT / "scripts" / name).read_text()
    lib = (ROOT / "scripts" / "fixture_repair_lib.sh").read_text()
    assert 'source "$HERE/fixture_repair_lib.sh"' in source
    assert "fw_load_target" in source and "fw_server_identity" in source
    for variable in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSWORD",
                     "PGTARGETSESSIONATTRS", "PGSSLMODE", "PGTZ"):
        assert variable in lib
    assert "compgen -e | grep '^PG'" in lib
    # the helper's exit status is checked before its output is used
    assert '|| die "could not read a usable DATABASE_URL' in lib


def _pgenv(tmp_path, line):
    env = tmp_path / ".env"
    env.write_text("OTHER=1\n" + line + "\n")
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "fixture_repair_pgenv.py"), str(env),
         str(tmp_path), "prod"], capture_output=True, text=True)


def test_pgenv_writes_a_private_passfile_and_prints_no_password(tmp_path):
    result = _pgenv(tmp_path, 'export DATABASE_URL="postgresql+psycopg2://fw_admin:p%40ss:w0rd'
                              '@dpg-x.oregon-postgres.render.com:5432/fw_prod?sslmode=require"')
    assert result.returncode == 0, result.stderr
    assert "p@ss" not in result.stdout + result.stderr and "w0rd" not in result.stdout
    for line in ("export PGHOST=dpg-x.oregon-postgres.render.com", "export PGDATABASE=fw_prod",
                 "export PGUSER=fw_admin", "export PGSSLMODE=require", "export FW_HOST_IS_IP=0"):
        assert line in result.stdout
    passfile = tmp_path / "prod.pgpass"
    assert stat.S_IMODE(passfile.stat().st_mode) == 0o600
    assert passfile.read_text() == (
        "dpg-x.oregon-postgres.render.com:5432:fw_prod:fw_admin:p@ss\\:w0rd\n")
    assert (tmp_path / "prod.pg_service.conf").read_text() == ""


@pytest.mark.parametrize("line, message", [
    ("SECRET=1", "DATABASE_URL not found"),
    ("DATABASE_URL=postgresql+asyncpg://u:SECRETPW@h.render.com/db", "scheme"),
    ("DATABASE_URL=postgresql://u:sEcr3t/PART2xyz@127.0.0.1:55433/db", "URL-encoded"),
    ("DATABASE_URL=postgresql://u:SECRETPW@h.render.com:5432/db?host=evil&port=1",
     "query parameters other than sslmode"),
    ("DATABASE_URL=postgresql://u:SECRETPW@h.render.com:5x432/db", "does not parse"),
    ("DATABASE_URL=postgresql://u:SECRETPW@127.0.0.1,evil.render.com:5432/db", "more than one host"),
])
def test_pgenv_refuses_with_a_fixed_message(tmp_path, line, message):
    result = _pgenv(tmp_path, line)
    assert result.returncode == 1
    assert message in result.stderr
    for fragment in ("SECRETPW", "sEcr3t", "PART2", "evil", "Traceback"):
        assert fragment not in result.stdout + result.stderr
    assert not (tmp_path / "prod.pgpass").exists()


def test_pgenv_ignores_an_inline_comment(tmp_path):
    result = _pgenv(tmp_path, "DATABASE_URL=postgresql://u:pw@h.render.com:5432/fw_prod  # prod")
    assert result.returncode == 0 and "export PGDATABASE=fw_prod" in result.stdout


FAKE_GH = r'''#!/usr/bin/env python3
"""Fake gh: workflow list/enable/disable over a JSON state file, with gh's
resolve rules (disable finds only active workflows, enable only disabled)."""
import json, os, sys
state_path, log_path = os.environ["FAKE_GH_STATE"], os.environ["FAKE_GH_LOG"]
state = json.load(open(state_path))
args = sys.argv[1:]
if args[:2] == ["workflow", "list"]:
    print(json.dumps([{"path": f".github/workflows/{k}", "state": v} for k, v in state.items()]))
    sys.exit(0)
verb, name = args[1], args[2]
open(log_path, "a").write(f"{verb} {name}\n")
fail_once = os.environ.get("FAKE_GH_FAIL_ONCE", "")
if fail_once == f"{verb} {name}" and not os.path.exists(log_path + ".failed"):
    open(log_path + ".failed", "w").write("x")
    print("HTTP 500", file=sys.stderr); sys.exit(1)
if os.environ.get("FAKE_GH_NOOP") == f"{verb} {name}":
    sys.exit(0)  # claims success, changes nothing
wanted = {"disable": ["active"], "enable": ["disabled_manually", "disabled_inactivity"]}[verb]
if state.get(name) not in wanted:
    print(f"could not find any workflows named {name}", file=sys.stderr); sys.exit(1)
state[name] = "disabled_manually" if verb == "disable" else "active"
json.dump(state, open(state_path, "w"))
'''

WRITERS = ["refresh.yml", "odds-snapshots.yml", "market-intel.yml", "shadow-record.yml",
           "refresh-players.yml", "refresh-live.yml", "nrl-refresh.yml", "nrl-live-refresh.yml"]


@pytest.fixture
def fake_gh(tmp_path):
    import json

    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "gh").write_text(FAKE_GH)
    (bindir / "gh").chmod(0o755)
    state = {name: "active" for name in WRITERS}
    state["market-intel.yml"] = "disabled_manually"  # already off before the repair
    state["keep-warm.yml"] = "active"
    (tmp_path / "state.json").write_text(json.dumps(state))
    env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(tmp_path),
           "FAKE_GH_STATE": str(tmp_path / "state.json"), "FAKE_GH_LOG": str(tmp_path / "calls.log"),
           "FW_WRITERS_STATE": str(tmp_path / "record.txt")}

    def run(command, **extra):
        return subprocess.run(["/bin/bash", str(ROOT / "scripts" / "fixture_repair_writers.sh"),
                               command], env={**env, **extra}, capture_output=True, text=True)

    def states():
        return json.loads((tmp_path / "state.json").read_text())

    def calls():
        log = tmp_path / "calls.log"
        return log.read_text().splitlines() if log.exists() else []

    return run, states, calls, tmp_path


def test_writers_pause_and_resume_restore_exactly_the_recorded_states(fake_gh):
    run, states, calls, tmp = fake_gh

    first = run("pause")
    assert first.returncode == 0, first.stderr
    assert all(states()[w] == "disabled_manually" for w in WRITERS)
    assert "disable market-intel.yml" not in calls() and len(calls()) == 7
    assert "market-intel.yml disabled_manually" in (tmp / "record.txt").read_text()

    # Re-running pause keeps the first record and calls nothing.
    again = run("pause")
    assert again.returncode == 0 and "keeping the earlier record" in again.stdout
    assert len(calls()) == 7
    assert "refresh.yml active" in (tmp / "record.txt").read_text()

    resumed = run("resume")
    assert resumed.returncode == 0, resumed.stderr
    assert states()["market-intel.yml"] == "disabled_manually"  # stays as it was
    assert all(states()[w] == "active" for w in WRITERS if w != "market-intel.yml")
    assert states()["keep-warm.yml"] == "active"
    assert not (tmp / "record.txt").exists()
    assert run("resume").returncode == 1  # no record: nothing to resume


def test_writers_resume_finishes_after_a_half_finished_run(fake_gh):
    run, states, calls, tmp = fake_gh
    assert run("pause").returncode == 0

    half = run("resume", FAKE_GH_FAIL_ONCE="enable refresh-live.yml")
    assert half.returncode != 0
    assert (tmp / "record.txt").exists()  # record kept for the retry

    retry = run("resume")
    assert retry.returncode == 0, retry.stderr
    assert all(states()[w] == "active" for w in WRITERS if w != "market-intel.yml")


def test_writers_status_shows_drift_while_paused(fake_gh):
    import json

    run, states, calls, tmp = fake_gh
    assert run("pause").returncode == 0
    drifted = states()
    drifted["odds-snapshots.yml"] = "active"  # someone re-enabled it by hand
    (tmp / "state.json").write_text(json.dumps(drifted))

    status = run("status")

    line = next(l for l in status.stdout.splitlines() if "odds-snapshots.yml" in l)
    assert "differs" in line
    assert all("differs" not in l for l in status.stdout.splitlines() if "refresh.yml " in l)


@pytest.mark.parametrize("record", ["", "refresh.yml active\n"])
def test_writers_resume_refuses_an_empty_or_partial_record(fake_gh, record):
    run, states, calls, tmp = fake_gh
    assert run("pause").returncode == 0
    (tmp / "record.txt").write_text(record)
    before = states()

    result = run("resume")

    assert result.returncode == 1
    assert "resume --all-active" in result.stderr
    assert states() == before and (tmp / "record.txt").exists()


def test_writers_without_a_record_status_warns_and_all_active_restores(fake_gh):
    run, states, calls, tmp = fake_gh
    assert run("pause").returncode == 0
    (tmp / "record.txt").unlink()  # record lost (other machine, other FW_WRITERS_STATE)

    assert run("resume").returncode == 1
    status = run("status")
    assert "8 writers are disabled and there is no pause record" in status.stdout
    assert "resume --all-active" in status.stdout

    result = run_all_active(tmp)
    assert result.returncode == 0, result.stderr
    assert all(states()[w] == "active" for w in WRITERS)


def run_all_active(tmp):
    env = {"PATH": f"{tmp / 'bin'}:/usr/bin:/bin", "HOME": str(tmp),
           "FAKE_GH_STATE": str(tmp / "state.json"), "FAKE_GH_LOG": str(tmp / "calls.log"),
           "FW_WRITERS_STATE": str(tmp / "record.txt")}
    return subprocess.run(["/bin/bash", str(ROOT / "scripts" / "fixture_repair_writers.sh"),
                           "resume", "--all-active"], env=env, capture_output=True, text=True)


def test_writers_resume_fails_loudly_if_a_writer_stays_disabled(fake_gh):
    run, states, calls, tmp = fake_gh
    assert run("pause").returncode == 0

    result = run("resume", FAKE_GH_NOOP="enable refresh.yml")

    assert result.returncode == 1
    assert "NOT BACK TO THE RECORDED STATES" in result.stderr
    assert (tmp / "record.txt").exists()  # kept for the retry
