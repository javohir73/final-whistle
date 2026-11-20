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
        'pg_restore --no-owner --no-acl --file="$WORK/plain.sql"',
        '[ "$PGHOST" = "$META_HOST" ]',
        "select current_database()",
        'read -r ANSWER',
        "--single-transaction --set ON_ERROR_STOP=1",
        "restore committed and verified",
    ]
    positions = [source.index(marker) for marker in order]
    assert positions == sorted(positions)


def test_pgenv_writes_a_private_passfile_and_prints_no_password(tmp_path):
    env = tmp_path / ".env"
    env.write_text('OTHER=1\nexport DATABASE_URL="postgresql+psycopg2://fw_admin:p%40ss:w0rd'
                   '@dpg-x.oregon-postgres.render.com:5432/fw_prod?sslmode=require"\n')
    passfile = tmp_path / "pgpass"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "fixture_repair_pgenv.py"), str(env), str(passfile)],
        capture_output=True, text=True, check=True)
    assert "p@ss" not in result.stdout + result.stderr and "w0rd" not in result.stdout
    assert "export PGHOST=dpg-x.oregon-postgres.render.com" in result.stdout
    assert "export PGDATABASE=fw_prod" in result.stdout
    assert "export PGUSER=fw_admin" in result.stdout
    assert "export PGSSLMODE=require" in result.stdout
    assert stat.S_IMODE(passfile.stat().st_mode) == 0o600
    assert passfile.read_text() == (
        "dpg-x.oregon-postgres.render.com:5432:fw_prod:fw_admin:p@ss\\:w0rd\n")
