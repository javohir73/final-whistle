import json
import subprocess
import sys
from pathlib import Path

from scripts.validate_health import EXPECTED_COMPETITIONS, validate


SCRIPT = Path(__file__).with_name("validate_health.py")


def _healthy_payload():
    return {
        "status": "ok",
        "data_status": "ok",
        "prediction_coverage": {"missing": 0},
        "fixture_feeds": [
            {"competition_code": code, "status": "ok"}
            for code in EXPECTED_COMPETITIONS
        ],
    }


def test_healthy_payload_has_no_errors():
    assert validate(_healthy_payload()) == []


def test_validator_reports_degraded_data():
    payload = _healthy_payload()
    payload["data_status"] = "degraded"
    assert validate(payload) == ["data_status is degraded (expected ok)"]


def test_validator_reports_missing_ucl():
    payload = _healthy_payload()
    payload["fixture_feeds"] = [
        row for row in payload["fixture_feeds"]
        if row["competition_code"] != "ucl"
    ]
    assert validate(payload) == ["missing fixture feed: ucl"]


def test_validator_reports_failed_bundesliga():
    payload = _healthy_payload()
    next(
        row for row in payload["fixture_feeds"]
        if row["competition_code"] == "bundesliga"
    )["status"] = "failed"
    assert validate(payload) == [
        "fixture feed bundesliga is failed (expected ok)"
    ]


def test_validator_reports_bad_liveness():
    payload = _healthy_payload()
    payload["status"] = "error"
    assert validate(payload) == ["liveness status is error (expected ok)"]


def test_validator_reports_missing_predictions():
    payload = _healthy_payload()
    payload["prediction_coverage"]["missing"] = 2
    assert validate(payload) == [
        "prediction coverage has 2 missing fixture(s) (expected 0)"
    ]


def test_validator_rejects_boolean_prediction_count():
    payload = _healthy_payload()
    payload["prediction_coverage"]["missing"] = False
    assert validate(payload) == [
        "prediction coverage has False missing fixture(s) (expected 0)"
    ]


def test_validator_rejects_duplicate_fixture_feed_rows():
    payload = _healthy_payload()
    payload["fixture_feeds"].append(
        {"competition_code": "epl", "status": "failed"}
    )
    assert validate(payload) == ["duplicate fixture feed: epl"]


def test_validator_rejects_malformed_fixture_feed_rows():
    payload = _healthy_payload()
    payload["fixture_feeds"].append("not-an-object")
    assert validate(payload) == ["malformed fixture feed at index 4"]


def test_cli_reads_stdin_prints_exact_errors_and_exits_one():
    payload = _healthy_payload()
    payload["data_status"] = "unknown"
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr == "data_status is unknown (expected ok)\n"


def test_cli_reads_first_file_argument(tmp_path):
    path = tmp_path / "health.json"
    path.write_text(json.dumps(_healthy_payload()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0
    assert result.stderr == ""
