from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def _workflow(name: str) -> dict:
    return yaml.load(
        (ROOT / ".github" / "workflows" / name).read_text(),
        Loader=yaml.BaseLoader,
    )


def _steps(workflow: dict) -> dict[str, dict]:
    return {step.get("name"): step for step in workflow["jobs"]["repair"]["steps"]}


def test_repair_workflow_is_manual_dry_run_first_and_serialized():
    workflow = _workflow("repair-fixture-duplicates.yml")

    assert set(workflow["on"]) == {"workflow_dispatch"}
    inputs = workflow["on"]["workflow_dispatch"]["inputs"]
    assert inputs["apply"]["type"] == "boolean"
    assert inputs["apply"]["default"] == "false"
    assert inputs["expected_digest"]["default"] == ""
    assert inputs["on_conflict"]["default"] == ""
    assert workflow["concurrency"] == {
        "group": "production-database",
        "cancel-in-progress": "false",
    }
    steps = _steps(workflow)
    dry_run, apply = steps["Dry run"], steps["Apply repair"]
    assert dry_run["if"] == "${{ !inputs.apply }}"
    assert "--apply" not in dry_run["run"]
    assert apply["if"] == "${{ inputs.apply }}"
    for step in (dry_run, apply):
        assert step["run"].count("python -m pipeline.repair_fixture_duplicates") == 1
        assert "--require-schema-head" in step["run"]
        assert '--on-conflict "$ON_CONFLICT"' in step["run"]
        assert step["env"]["DATABASE_URL"] == "${{ secrets.DATABASE_URL }}"
        assert step["env"]["PYTHONPATH"] == "backend:."
        assert step["env"]["ON_CONFLICT"] == "${{ inputs.on_conflict }}"
        # Inputs reach the shell only through env, never interpolated.
        assert "${{" not in step["run"]


def test_apply_cannot_run_without_the_dry_run_digest():
    apply = _steps(_workflow("repair-fixture-duplicates.yml"))["Apply repair"]

    assert apply["env"]["EXPECTED_DIGEST"] == "${{ inputs.expected_digest }}"
    assert apply["run"].startswith('test -n "$EXPECTED_DIGEST" &&')
    assert '--apply --expected-digest "$EXPECTED_DIGEST"' in apply["run"]


def test_schema_is_migrated_before_the_repair_runs():
    workflow = _workflow("repair-fixture-duplicates.yml")
    names = [step.get("name") for step in workflow["jobs"]["repair"]["steps"]]
    migrate = _steps(workflow)["Apply migrations"]

    assert migrate["run"] == "alembic upgrade head"
    assert migrate["working-directory"] == "backend"
    assert names.index("Apply migrations") < names.index("Dry run")
    assert names.index("Apply migrations") < names.index("Apply repair")


def test_refresh_and_repair_cannot_write_production_concurrently():
    repair = _workflow("repair-fixture-duplicates.yml")
    refresh = _workflow("refresh.yml")

    assert repair["concurrency"] == refresh["concurrency"]
    assert refresh["concurrency"]["cancel-in-progress"] == "false"
