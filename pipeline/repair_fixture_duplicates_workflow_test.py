from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def _workflow(name: str) -> dict:
    return yaml.load(
        (ROOT / ".github" / "workflows" / name).read_text(),
        Loader=yaml.BaseLoader,
    )


def test_repair_workflow_is_manual_dry_run_first_and_serialized():
    workflow = _workflow("repair-fixture-duplicates.yml")

    assert set(workflow["on"]) == {"workflow_dispatch"}
    apply_input = workflow["on"]["workflow_dispatch"]["inputs"]["apply"]
    assert apply_input["type"] == "boolean"
    assert apply_input["default"] == "false"
    assert workflow["concurrency"] == {
        "group": "production-database",
        "cancel-in-progress": "false",
    }
    steps = workflow["jobs"]["repair"]["steps"]
    dry_run = next(step for step in steps if step.get("name") == "Dry run")
    apply = next(step for step in steps if step.get("name") == "Apply repair")
    assert dry_run["if"] == "${{ !inputs.apply }}"
    assert dry_run["run"] == "python -m pipeline.repair_fixture_duplicates"
    assert apply["if"] == "${{ inputs.apply }}"
    assert apply["run"] == "python -m pipeline.repair_fixture_duplicates --apply"
    for step in (dry_run, apply):
        assert step["env"]["DATABASE_URL"] == "${{ secrets.DATABASE_URL }}"
        assert step["env"]["PYTHONPATH"] == "backend:."


def test_refresh_and_repair_cannot_write_production_concurrently():
    repair = _workflow("repair-fixture-duplicates.yml")
    refresh = _workflow("refresh.yml")

    assert repair["concurrency"] == refresh["concurrency"]
    assert refresh["concurrency"]["cancel-in-progress"] == "false"
