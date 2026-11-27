"""Build ml/models/ucl_unified_snapshot.json -- offline, reproducible.

Replays the C2 "unified" Elo (pipeline/ucl_unified_elo.py, the engine the
runtime continues with) over every event dated before ``CUTOFF``: twelve
domestic leagues from football-data.co.uk plus every Champions League match
(openfootball, CC0), and writes the per-club state the runtime needs.

    PYTHONPATH=backend:. python -m pipeline.build_ucl_unified_snapshot \\
        --data-dir <capture dir> [--out ml/models/ucl_unified_snapshot.json]

``--data-dir`` holds the raw captures (never committed -- football-data.co.uk
files are free to download but not licensed for redistribution):
    fdco/<DIV>_<yyff>.csv   mmz4281 files 1011..2526, plus fdco/AUT.csv
    clq/cl.<season>.txt, clq/clq.<season>.txt   openfootball main stage / qualifiers
Parsing and club-name aliasing of the openfootball files reuse the experiment's
loaders (docs/experiments/2026-11-27-ucl-rating-scale/data.py, names.py).
The output records a sha256 per source of the canonical pre-cutoff event lines
(not of the files, which grow), so a rebuild is checkable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from pipeline import ucl_unified_elo as U
from pipeline.ucl_unified_names import DIV_COUNTRY

ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT = ROOT / "docs" / "experiments" / "2026-11-27-ucl-rating-scale"
FIRST_DAY = "2011-07-01"
FD_SEASONS = [f"{y % 100:02d}{(y + 1) % 100:02d}" for y in range(2010, 2026)]  # 1011 .. 2526


def _digest(events) -> str:
    lines = [f"{e.date}|{e.comp}|{e.home}|{e.away}|{e.gh}|{e.ga}|{int(e.neutral)}" for e in events]
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def _in_window(e: U.Event) -> bool:
    return FIRST_DAY <= e.date < U.CUTOFF


def build(data_dir: Path) -> dict:
    sys.path.insert(0, str(EXPERIMENT))
    try:
        import data as xdata  # noqa: PLC0415
        import names as xnames  # noqa: PLC0415
    finally:
        sys.path.remove(str(EXPERIMENT))

    events: list[U.Event] = []
    sources: dict[str, dict] = {"football-data.co.uk": {}, "openfootball": {}}

    for div in DIV_COUNTRY:
        if div == "AUT":
            evs = [e for e in U.parse_aut_csv(
                (data_dir / "fdco" / "AUT.csv").read_text(encoding="utf-8-sig", errors="replace"))
                if _in_window(e)]
            sources["football-data.co.uk"]["new/AUT.csv"] = {"rows": len(evs), "sha256": _digest(evs)}
            events += evs
            continue
        for s in FD_SEASONS:
            path = data_dir / "fdco" / f"{div}_{s}.csv"
            if not path.exists() or path.stat().st_size < 100:
                continue
            evs = [e for e in U.parse_division_csv(path.read_text(encoding="latin-1"), div, s)
                   if _in_window(e)]
            if evs:
                sources["football-data.co.uk"][f"mmz4281/{s}/{div}.csv"] = {
                    "rows": len(evs), "sha256": _digest(evs)}
            events += evs

    os.environ["UCL_EXP_DATA"] = str(data_dir)
    xdata.DATA = data_dir
    raw, problems = xdata.load_ucl_raw()
    clean, dropped = xdata.clean_ucl(raw)
    by_file: dict[str, list[U.Event]] = {}
    for r in clean:
        e = U.Event(r["date"], "UCL", r["season"], xnames.ucl_key(r["home_raw"], r["hc"]),
                    xnames.ucl_key(r["away_raw"], r["ac"]), r["gh"], r["ga"],
                    bool(r["neutral"]))
        if e.date < U.CUTOFF:
            fname = f"{r['season']}/{'cl' if r['comp'] == 'UCL' else 'clq'}.txt"
            by_file.setdefault(fname, []).append(e)
            events.append(e)
    for fname, evs in sorted(by_file.items()):
        sources["openfootball"][fname] = {"rows": len(evs), "sha256": _digest(evs)}

    state = U.UnifiedElo()
    state.apply(events)
    return {
        "version": 1,
        "description": ("C2 unified Elo state (domestic leagues + every UCL match) frozen at the "
                        "cutoff; pipeline/ucl_unified_elo.py continues the replay from here."),
        "cutoff": U.CUTOFF,
        "constants": U.constants(),
        "opening": dict(sorted(state.opening.items())),
        "counts": {"events": len(events), "clubs": len(state.r),
                   "openfootball_parse_problems": len(problems),
                   "openfootball_rows_dropped_by_cleaning": len(dropped)},
        "sources": {
            "football-data.co.uk": {
                "note": "free to download per the site; per-match bytes are not redistributed "
                        "here -- only the derived ratings and a sha256 of the canonical event lines",
                "files": sources["football-data.co.uk"]},
            "openfootball": {"licence": "CC0", "repo": "openfootball/champions-league",
                             "files": sources["openfootball"]},
        },
        "clubs": state.to_clubs(),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=U.SNAPSHOT_PATH)
    args = ap.parse_args()
    blob = build(args.data_dir)
    args.out.write_text(json.dumps(blob, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {args.out.name}: {blob['counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
