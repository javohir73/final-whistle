"""Fetch official NRL results (nrl.com draw data) for an independent cross-check.

Read-only, throttled to one request per second, cached on disk so a re-run
makes no network calls. Output: one JSON list of
{season, round, home, away, score_home, score_away, kickoff_utc, venue, state}.

Usage (from the repo root):
    python docs/experiments/2026-11-20-nrl-model-audit/fetch_official_results.py \
        --out artifacts/nrl_backtests/audit-2026-11-20/official --seasons 2017 2026
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import requests

URL = "https://www.nrl.com/draw/data?competition=111&season={season}&round={round_no}"


def fetch(season: int, round_no: int, cache: Path) -> dict | None:
    path = cache / f"draw-{season}-{round_no:02d}.json"
    if path.exists():
        return json.loads(path.read_text())
    time.sleep(1.0)
    try:
        resp = requests.get(
            URL.format(season=season, round_no=round_no),
            headers={"User-Agent": "Mozilla/5.0"}, timeout=30,
        )
        resp.raise_for_status()
        doc = resp.json()
    except Exception as exc:  # noqa: BLE001
        print(f"{season} r{round_no}: fetch failed: {exc}")
        return None
    path.write_text(json.dumps(doc))
    return doc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seasons", nargs=2, type=int, required=True)
    args = ap.parse_args()
    out = Path(args.out)
    cache = out / "raw"
    cache.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    for season in range(args.seasons[0], args.seasons[1] + 1):
        first = fetch(season, 1, cache)
        if first is None:
            continue
        rounds = sorted({int(r["value"]) for r in first.get("filterRounds", [])})
        for round_no in rounds:
            doc = fetch(season, round_no, cache)
            if doc is None:
                continue
            if int(doc.get("selectedRoundId", round_no)) != round_no:
                # The endpoint silently falls back to another round when the
                # requested one does not exist; never record that as data.
                print(f"{season} r{round_no}: server answered round {doc.get('selectedRoundId')}, skipped")
                continue
            for fx in doc.get("fixtures", []):
                if fx.get("type") != "Match":
                    continue
                home, away = fx.get("homeTeam") or {}, fx.get("awayTeam") or {}
                rows.append({
                    "season": season,
                    "round": round_no,
                    "round_title": fx.get("roundTitle"),
                    "home": home.get("nickName"),
                    "away": away.get("nickName"),
                    "score_home": home.get("score"),
                    "score_away": away.get("score"),
                    "kickoff_utc": (fx.get("clock") or {}).get("kickOffTimeLong"),
                    "venue": fx.get("venue"),
                    "state": fx.get("matchState"),
                })
        print(f"{season}: {sum(1 for r in rows if r['season'] == season)} matches over {len(rounds)} rounds")

    (out / "official_results.json").write_text(json.dumps(rows, indent=1))
    print(f"wrote {len(rows)} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
