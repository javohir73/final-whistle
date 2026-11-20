from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
REPAIR = ROOT / ".github" / "workflows" / "repair-fixture-duplicates.yml"


def _workflow(name: str) -> dict:
    return yaml.load(
        (ROOT / ".github" / "workflows" / name).read_text(),
        Loader=yaml.BaseLoader,
    )


def _steps(job: dict) -> dict[str, dict]:
    return {step.get("name"): step for step in job["steps"]}


def test_repair_workflow_is_manual_dry_run_first_and_serialized():
    workflow = _workflow("repair-fixture-duplicates.yml")

    assert set(workflow["on"]) == {"workflow_dispatch"}
    inputs = workflow["on"]["workflow_dispatch"]["inputs"]
    assert inputs["apply"]["type"] == "boolean"
    assert inputs["apply"]["default"] == "false"
    assert inputs["trial"]["default"] == "true"
    for name in ("expected_digest", "on_conflict", "acknowledge"):
        assert inputs[name]["default"] == ""
    assert "read-only" not in REPAIR.read_text()
    assert workflow["concurrency"] == {
        "group": "production-database",
        "cancel-in-progress": "false",
    }
    jobs = workflow["jobs"]
    assert set(jobs) == {"dry-run", "apply"}
    assert jobs["dry-run"]["if"] == "${{ !inputs.apply }}"
    assert jobs["apply"]["if"] == "${{ inputs.apply }}"
    dry_run = _steps(jobs["dry-run"])["Dry run"]
    apply = _steps(jobs["apply"])["Apply repair"]
    assert "--apply" not in dry_run["run"]
    # "x && '' || y" is a GitHub-expression trap ('' is falsy); this form is not.
    assert dry_run["env"]["NO_TRIAL"] == "${{ !inputs.trial && '--no-trial' || '' }}"
    for step in (dry_run, apply):
        assert step["run"].count("python -m pipeline.repair_fixture_duplicates") == 1
        assert "--require-schema-head" in step["run"]
        assert '--on-conflict "$ON_CONFLICT"' in step["run"]
        assert '--acknowledge "$ACKNOWLEDGE"' in step["run"]
        assert step["env"]["DATABASE_URL"] == "${{ secrets.DATABASE_URL }}"
        assert step["env"]["PYTHONPATH"] == "backend:."
        assert step["env"]["ON_CONFLICT"] == "${{ inputs.on_conflict }}"
        assert step["env"]["ACKNOWLEDGE"] == "${{ inputs.acknowledge }}"
        # Inputs reach the shell only through env, never interpolated.
        assert "${{" not in step["run"]


def test_only_apply_waits_for_environment_approval():
    jobs = _workflow("repair-fixture-duplicates.yml")["jobs"]

    assert jobs["apply"]["environment"] == "production-database"
    assert "environment" not in jobs["dry-run"]


def test_apply_fails_closed_without_reviewers_branch_rule_or_certificate():
    steps = _workflow("repair-fixture-duplicates.yml")["jobs"]["apply"]["steps"]
    names = [step.get("name") for step in steps]
    gate = _steps({"steps": steps})["Require the approval gate and a working evidence certificate"]
    run = gate["run"]
    assert 'test "$REF" = "refs/heads/main"' in run
    assert 'test -n "$CERT"' in run
    # The certificate must actually encrypt, and not be about to expire.
    assert "openssl x509 -checkend 86400" in run
    assert "openssl smime -encrypt" in run and 'test -s "$RUNNER_TEMP/probe.p7m"' in run
    assert "environments/production-database" in run
    assert 'index("required_reviewers") != null' in run
    assert ".deployment_branch_policy != null" in run
    assert names.index("Apply repair") > names.index(gate["name"])


def test_evidence_is_only_ever_uploaded_encrypted():
    # The repository is public: artifacts and logs are readable by anyone.
    workflow = _workflow("repair-fixture-duplicates.yml")
    assert workflow["permissions"] == {"contents": "read"}
    for job in workflow["jobs"].values():
        steps = _steps(job)
        names = [step.get("name") for step in job["steps"]]
        encrypt = steps["Encrypt evidence"]
        upload = steps["Upload encrypted evidence"]
        cleanup = steps["Remove plaintext evidence"]
        # All three run even when the repair step failed (after a commit,
        # the evidence written before the first write is still there).
        for step in (encrypt, upload, cleanup):
            assert step["if"] == "${{ always() }}"
        assert "openssl smime -encrypt" in encrypt["run"]
        assert upload["with"]["path"] == "repair-evidence.json.p7m"
        assert cleanup["run"] == "rm -f repair-evidence.json"
        assert names.index("Encrypt evidence") < names.index("Upload encrypted evidence") \
            < names.index("Remove plaintext evidence") == len(names) - 1
        uploads = [s for s in job["steps"] if "upload-artifact" in s.get("uses", "")]
        assert uploads == [upload]


def test_apply_cannot_run_without_the_dry_run_digest():
    apply = _steps(_workflow("repair-fixture-duplicates.yml")["jobs"]["apply"])["Apply repair"]

    assert apply["env"]["EXPECTED_DIGEST"] == "${{ inputs.expected_digest }}"
    assert apply["run"].startswith('test -n "$EXPECTED_DIGEST" &&')
    assert '--apply --expected-digest "$EXPECTED_DIGEST"' in apply["run"]


def test_neither_job_migrates_the_schema():
    for job in _workflow("repair-fixture-duplicates.yml")["jobs"].values():
        for step in job["steps"]:
            assert "alembic" not in step.get("run", "")


def test_refresh_and_repair_cannot_write_production_concurrently():
    repair = _workflow("repair-fixture-duplicates.yml")
    refresh = _workflow("refresh.yml")

    assert repair["concurrency"] == refresh["concurrency"]
    assert refresh["concurrency"]["cancel-in-progress"] == "false"
