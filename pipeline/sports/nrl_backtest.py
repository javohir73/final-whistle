"""NRL season walk-forward backtest + tuner CLI (task 4 — vertical gate).

Loads sport="nrl" matches from the DB, tunes NrlParams on data strictly
before each of the 3 most recent completed seasons, replays leak-free Elo up
to (but not into) that season, then walk-forward evaluates the held-out
season against the favorite and home baselines. Prints one table row per
season and a final GATE line.

Gate (per the vertical plan): PASS if the model beats the favorite baseline
on log loss in >= 2 of the 3 held-out seasons, else FAIL. The held-out seasons
are the three most recent completed seasons in the database. This is a read-only
report — it never writes to the DB.

Usage:
    PYTHONPATH=backend:. python -m pipeline.sports.nrl_backtest
"""
from __future__ import annotations

import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

SPORT = "nrl"
HELD_OUT_COUNT = 3


def held_out_seasons(finished: set[int], unfinished: set[int], count: int = HELD_OUT_COUNT) -> tuple[int, ...]:
    """The `count` most recent COMPLETED seasons: seasons with finished matches
    and none still to play. Derived from the data so the gate follows the
    calendar -- a fixed tuple silently kept scoring 2023-2025 after 2026 ended."""
    complete = sorted(finished - unfinished)
    return tuple(complete[-count:])


def _load_matches_by_season(db) -> dict[int, list[dict]]:
    """Every FINISHED sport_matches row for SPORT, grouped by season."""
    from app.models import SportMatch

    rows = (
        db.query(SportMatch)
        .filter_by(sport=SPORT, status="finished")
        .all()
    )
    by_season: dict[int, list[dict]] = {}
    for r in rows:
        by_season.setdefault(r.season, []).append({
            "match_id": r.id,
            "kickoff_utc": r.kickoff_utc,
            "home_team_id": r.home_team_id,
            "away_team_id": r.away_team_id,
            "score_home": r.score_home,
            "score_away": r.score_away,
        })
    return by_season


def _fmt(m: dict) -> str:
    return f"log_loss={m['log_loss']:.4f} brier={m['brier']:.4f} acc={m['winner_acc']:.3f} n={m['n']}"


def main() -> int:
    from app.db import SessionLocal
    from ml.sports.nrl.backtest import class_freqs_from_matches, evaluate_season, replay_seasons, tune
    from ml.sports.nrl.model import regress_season

    from app.models import SportMatch

    db = SessionLocal()
    try:
        matches_by_season = _load_matches_by_season(db)
        unfinished = {
            season for (season,) in db.query(SportMatch.season)
            .filter(SportMatch.sport == SPORT, SportMatch.status != "finished").distinct()
        }
    finally:
        db.close()

    seasons_present = sorted(matches_by_season)
    log.info("Loaded %d finished matches across seasons %s", sum(len(v) for v in matches_by_season.values()), seasons_present)

    held_out_list = held_out_seasons(set(matches_by_season), unfinished)
    log.info("Held-out seasons: %s", list(held_out_list))

    passes = 0
    for held_out in held_out_list:
        train_seasons = [s for s in seasons_present if s <= held_out - 2]
        replay_through = [s for s in seasons_present if s <= held_out - 1]

        if held_out not in matches_by_season or not train_seasons or not replay_through:
            log.info("%d: skipped (insufficient prior seasons in DB)", held_out)
            continue

        train_rows_by_season = {s: matches_by_season[s] for s in train_seasons}
        val_season = held_out - 1
        if val_season not in matches_by_season:
            log.info("%d: skipped (no val season %d)", held_out, val_season)
            continue

        params = tune(train_rows_by_season, matches_by_season[val_season])

        replay_rows_by_season = {s: matches_by_season[s] for s in replay_through}
        elos = replay_seasons(replay_rows_by_season, params)
        # replay_seasons' snapshot is end-of-season, pre-boundary-regression
        # for the NEXT season -- regress here so held_out is entered with the
        # same composition the serving path uses (nrl_predict._current_elos),
        # matching the val-entry regression applied inside tune().
        starting_elos = regress_season(elos[replay_through[-1]], params)

        class_freqs = class_freqs_from_matches(
            [m for s in train_seasons + [val_season] for m in matches_by_season[s]]
        )

        result = evaluate_season(matches_by_season[held_out], starting_elos, params, class_freqs)

        model_beats_favorite = result["log_loss"] < result["favorite"]["log_loss"]
        if model_beats_favorite:
            passes += 1

        log.info(
            "%d  model[%s]  favorite[%s]  home[%s]",
            held_out, _fmt(result), _fmt(result["favorite"]), _fmt(result["home"]),
        )

    needed = len(held_out_list) // 2 + 1
    gate = "GATE PASS" if held_out_list and passes >= needed else "GATE FAIL"
    log.info(gate)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
