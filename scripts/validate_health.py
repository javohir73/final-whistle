"""Validate the production health payload for smoke checks."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


EXPECTED_COMPETITIONS = ("epl", "laliga", "bundesliga", "ucl")


def validate(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    liveness = payload.get("status")
    if liveness != "ok":
        errors.append(f"liveness status is {liveness} (expected ok)")

    data_status = payload.get("data_status")
    if data_status != "ok":
        errors.append(f"data_status is {data_status} (expected ok)")

    coverage = payload.get("prediction_coverage")
    missing = coverage.get("missing") if isinstance(coverage, dict) else None
    if type(missing) is not int or missing != 0:
        errors.append(
            f"prediction coverage has {missing} missing fixture(s) (expected 0)"
        )

    raw_feeds = payload.get("fixture_feeds")
    feeds = raw_feeds if isinstance(raw_feeds, list) else []
    by_code: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(feeds):
        if not isinstance(row, dict) or not isinstance(
            row.get("competition_code"), str
        ):
            errors.append(f"malformed fixture feed at index {index}")
            continue
        code = row["competition_code"]
        if code in by_code:
            errors.append(f"duplicate fixture feed: {code}")
            continue
        by_code[code] = row
    for code in EXPECTED_COMPETITIONS:
        row = by_code.get(code)
        if row is None:
            errors.append(f"missing fixture feed: {code}")
            continue
        status = row.get("status")
        if status != "ok":
            errors.append(f"fixture feed {code} is {status} (expected ok)")
    return errors


def _read_payload(argv: list[str]) -> dict[str, Any]:
    text = (
        Path(argv[0]).read_text(encoding="utf-8")
        if argv else sys.stdin.read()
    )
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("health payload must be a JSON object")
    return payload


def main(argv: list[str] | None = None) -> int:
    try:
        payload = _read_payload(list(sys.argv[1:] if argv is None else argv))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"invalid health payload: {exc}", file=sys.stderr)
        return 1
    errors = validate(payload)
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
