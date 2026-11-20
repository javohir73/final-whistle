"""The repair CLI run exactly as the workflow runs it.

Every other test imports the tool into a pytest process whose conftest has
already imported ``app.models``; that hid a missing import that made
``python -m pipeline.repair_fixture_duplicates`` die on every real run
(review round 4, finding 1). These tests take the command lines verbatim
from ``.github/workflows/repair-fixture-duplicates.yml`` and run them through
bash in a fresh interpreter, against a SQLite file built from the models.
"""
import re
import shlex
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db import Base
import pipeline.repair_fixture_duplicates as repair_mod
from pipeline.repair_fixture_duplicates_test import _seed_duplicate

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "repair-fixture-duplicates.yml"


def _workflow_runs() -> dict[str, dict]:
    jobs = yaml.load(WORKFLOW.read_text(), Loader=yaml.BaseLoader)["jobs"]
    return {
        "dry-run": next(s for s in jobs["dry-run"]["steps"] if s.get("name") == "Dry run"),
        "apply": next(s for s in jobs["apply"]["steps"] if s.get("name") == "Apply repair"),
    }


@pytest.fixture
def workdir(tmp_path):
    """A runner-like working directory: the repository's code at ./backend,
    ./pipeline and ./ml (PYTHONPATH=backend:. as in the workflow), ``python``
    on PATH, no .env, and a migrated-looking SQLite database."""
    for name in ("backend", "pipeline", "ml"):
        (tmp_path / name).symlink_to(ROOT / name)
    bindir = tmp_path / "bin"
    bindir.mkdir()
    # A wrapper, not a symlink: a symlinked venv interpreter loses its venv.
    wrapper = bindir / "python"
    wrapper.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n')
    wrapper.chmod(0o755)
    database = tmp_path / "repair.sqlite"
    engine = create_engine(f"sqlite:///{database}")
    Base.metadata.create_all(engine)
    (head,) = ScriptDirectory(str(ROOT / "backend" / "alembic")).get_heads()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        conn.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": head})
    with Session(engine) as session:
        _seed_duplicate(session)
        session.commit()
    engine.dispose()
    return tmp_path


def _run_step(workdir: Path, step: dict, database_url: str, **inputs) -> subprocess.CompletedProcess:
    env = {
        "PATH": f"{workdir / 'bin'}:/usr/bin:/bin",
        "HOME": str(workdir),
        "PYTHONPATH": step["env"]["PYTHONPATH"],
        "DATABASE_URL": database_url,
        "ON_CONFLICT": inputs.get("on_conflict", ""),
        "ACKNOWLEDGE": inputs.get("acknowledge", ""),
        "NO_TRIAL": inputs.get("no_trial", ""),
        "EXPECTED_DIGEST": inputs.get("expected_digest", ""),
    }
    return subprocess.run(["bash", "-c", step["run"]], cwd=workdir, env=env,
                          capture_output=True, text=True, timeout=300)


def _lines(result) -> list[str]:
    return result.stdout.splitlines()


def test_workflow_command_lines_run_end_to_end(workdir):
    runs = _workflow_runs()
    url = f"sqlite:///{workdir / 'repair.sqlite'}"

    dry = _run_step(workdir, runs["dry-run"], url)
    assert dry.returncode == 0, dry.stderr
    assert "status: ready" in _lines(dry)
    assert "trial: ok" in _lines(dry)
    digest = next(l.split()[1] for l in _lines(dry) if l.startswith("digest: "))
    assert (workdir / "repair-evidence.json").exists()

    refused = _run_step(workdir, runs["apply"], url)  # no digest
    assert refused.returncode != 0

    applied = _run_step(workdir, runs["apply"], url, expected_digest=digest)
    assert applied.returncode == 0, applied.stderr
    assert "trial: applied" in _lines(applied)

    again = _run_step(workdir, runs["dry-run"], url)
    assert again.returncode == 0, again.stderr
    assert "status: nothing to repair" in _lines(again)
    assert not any(l.startswith(("digest", "ready_to_apply")) for l in _lines(again))


def test_not_ready_dry_run_exits_3_without_a_digest(workdir):
    url = f"sqlite:///{workdir / 'repair.sqlite'}"
    engine = create_engine(url)
    with engine.begin() as conn:  # make the pair's matchweeks disagree
        conn.execute(text("UPDATE matches SET matchweek = 30 WHERE fixture_provider = 'football_data'"))
    engine.dispose()

    result = _run_step(workdir, _workflow_runs()["dry-run"], url)

    assert result.returncode == 3
    assert "status: not ready" in _lines(result)
    assert any(l.startswith("BLOCKING: ") and "matchweek 2 vs 30" in l for l in _lines(result))
    assert not any(l.startswith("digest") for l in _lines(result))


def test_connection_failure_leaks_no_host_user_or_password(workdir):
    url = "postgresql+psycopg2://leakyuser:s3cretpw@leaky-host.invalid:5432/leakydb"

    result = _run_step(workdir, _workflow_runs()["dry-run"], url)

    output = result.stdout + result.stderr
    assert result.returncode == 2, output
    assert "connection failed" in output and "nothing was written" in output
    for secret in ("leakyuser", "s3cretpw", "leaky-host", "leakydb", "Traceback"):
        assert secret not in output


def test_workflow_flags_are_the_cli_flags():
    """The flags in both workflow steps parse with the tool's own parser."""
    parser = repair_mod.build_parser()
    for name, step in _workflow_runs().items():
        command = step["run"].split("&&")[-1]
        command = re.sub(r'"\$[A-Z_]+"', "VALUE", command).replace("$NO_TRIAL", "")
        argv = shlex.split(command)
        assert argv[:3] == ["python", "-m", "pipeline.repair_fixture_duplicates"], name
        args = parser.parse_args(argv[3:])
        assert args.require_schema_head and args.evidence_file == "repair-evidence.json"
        assert args.apply is (name == "apply")
