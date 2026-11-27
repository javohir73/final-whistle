"""C2 unified Elo engine, snapshot and current-season parsing. No network, no DB."""
from __future__ import annotations

import json
from copy import deepcopy

import pytest

from ml.ratings.elo import update_ratings
from pipeline import ucl_unified_elo as U
from pipeline.ucl_unified_names import DB_ALIASES, DIV_COUNTRY

# The 36 clubs of the 2026-27 league phase, as API-Football names them in the DB.
LEAGUE_PHASE_2026_27 = [
    "AS Roma", "Arsenal", "Aston Villa", "Atletico Madrid", "Barcelona", "Bayern München",
    "Bodo/Glimt", "Borussia Dortmund", "Club Brugge KV", "Como", "FC Porto", "Fenerbahçe",
    "Feyenoord", "Galatasaray", "Inter", "Lask Linz", "Lens", "Lille", "Liverpool",
    "Manchester City", "Manchester United", "Napoli", "PAE AEK", "PSV Eindhoven",
    "Paris Saint Germain", "RB Leipzig", "Real Betis", "Real Madrid", "Sabah FA",
    "Shakhtar Donetsk", "Slavia Praha", "Slovan Bratislava", "Sporting CP", "VfB Stuttgart",
    "Viking", "Villarreal",
]


def ev(date, comp, home, away, gh, ga, season="2627", neutral=False):
    return U.Event(date, comp, season, home, away, gh, ga, neutral)


# --- identity ---------------------------------------------------------------

def test_every_2026_27_league_phase_club_has_an_explicit_mapping():
    assert len(set(LEAGUE_PHASE_2026_27)) == 36
    missing = [n for n in LEAGUE_PHASE_2026_27 if n not in DB_ALIASES]
    assert missing == []


def test_covered_league_phase_clubs_resolve_to_a_key_the_snapshot_rates():
    """Snapshot and runtime must agree on a covered club's key, or its domestic
    history is silently lost. Only clubs genuinely new to the data (no prior
    UCL or domestic row) may be absent."""
    clubs = U.load_snapshot().r
    absent = sorted(n for n in LEAGUE_PHASE_2026_27 if DB_ALIASES[n] not in clubs)
    assert absent == ["Sabah FA", "Viking"]


def test_mapping_is_not_fuzzy():
    from pipeline.ucl_unified_names import db_club_key

    assert db_club_key("Arsenal") == "ENG:Arsenal"
    assert db_club_key("Arsenal FC") is None
    assert db_club_key("arsenal") is None


# --- snapshot ---------------------------------------------------------------

def test_snapshot_loads_with_frozen_constants():
    st = U.load_snapshot()
    assert set(st.opening) == set(DIV_COUNTRY)
    assert len(st.r) > 400
    blob = json.loads(U.SNAPSHOT_PATH.read_text())
    assert blob["cutoff"] == U.CUTOFF == "2026-07-01"
    assert blob["constants"] == U.constants()
    assert blob["constants"]["tier_seed"]["ENG"] == 1600.0
    assert blob["constants"]["nofeed_prior"] == 1450.0
    assert blob["constants"]["newcomer_drop"] == 100.0
    assert blob["constants"]["shrink_n0"] == 10.0


def _snap_copy(tmp_path, mutate):
    blob = json.loads(U.SNAPSHOT_PATH.read_text())
    mutate(blob)
    p = tmp_path / "snap.json"
    p.write_text(json.dumps(blob))
    return p


def test_snapshot_with_drifted_constants_is_rejected(tmp_path):
    p = _snap_copy(tmp_path, lambda b: b["constants"].__setitem__("shrink_n0", 5.0))
    with pytest.raises(U.SnapshotError):
        U.load_snapshot(p)


def test_snapshot_with_wrong_cutoff_or_missing_opening_is_rejected(tmp_path):
    with pytest.raises(U.SnapshotError):
        U.load_snapshot(_snap_copy(tmp_path, lambda b: b.__setitem__("cutoff", "2026-08-01")))
    with pytest.raises(U.SnapshotError):
        U.load_snapshot(_snap_copy(tmp_path, lambda b: b["opening"].pop("E0")))
    with pytest.raises(U.SnapshotError):
        U.load_snapshot(tmp_path / "does-not-exist.json")


# --- engine rules ------------------------------------------------------------

def test_covered_club_uses_its_raw_rating_and_nofeed_club_is_shrunk():
    st = U.UnifiedElo(r={"ENG:Arsenal": 1800.0, "ARM:Ararat": 1650.0},
                      n={"ENG:Arsenal": 5, "ARM:Ararat": 10}, opening={})
    assert st.used("ENG:Arsenal") == 1800.0
    # n/(n+n0) = 10/20 -> halfway between the 1450 prior and the raw rating
    assert st.used("ARM:Ararat") == pytest.approx(1450.0 + 200.0 * 0.5)
    st.n["ARM:Ararat"] = 0
    assert st.used("ARM:Ararat") == 1450.0
    # never seen: its seed
    assert st.used("ENG:Brand New") == 1600.0
    assert st.used("SVK:Unknown") == 1450.0


def test_newcomer_after_a_leagues_opening_season_starts_100_lower():
    st = U.UnifiedElo(opening={"E0": "1112"})
    st.apply([ev("2026-08-15", "E0", "ENG:Promoted", "ENG:Arsenal", 0, 0)])
    # both clubs were first seen in 2627, a non-opening season: 1600 - 100
    assert st.r["ENG:Promoted"] == pytest.approx(update_ratings(
        1500.0, 1500.0, 0, 0, competition="E0", home_advantage=60.0)[0])


def test_opening_season_clubs_take_the_full_tier_seed():
    st = U.UnifiedElo()
    st.apply([ev("2011-08-13", "SP1", "ESP:A", "ESP:B", 1, 1, season="1112")])
    assert st.opening == {"SP1": "1112"}
    assert st.r["ESP:A"] == pytest.approx(update_ratings(
        1600.0, 1600.0, 1, 1, competition="SP1", home_advantage=60.0)[0])


def test_a_ucl_debut_never_takes_the_newcomer_drop():
    st = U.UnifiedElo(opening={"E0": "1112"})
    out = st.apply([ev("2026-09-08", "UCL", "ENG:Fresh", "SVK:Slovan", 1, 0, season="ucl")])
    _e, used_h, used_a, n_h, n_a = out[0]
    assert (used_h, used_a, n_h, n_a) == (1600.0, 1450.0, 0, 0)


def test_same_day_domestic_is_applied_before_ucl():
    domestic = ev("2026-09-20", "E0", "ENG:Arsenal", "ENG:Chelsea", 3, 0)
    ucl = ev("2026-09-20", "UCL", "ENG:Arsenal", "ESP:Barcelona", 0, 0, season="ucl")
    a = U.UnifiedElo(opening={"E0": "1112"}).apply([ucl, domestic])
    b = U.UnifiedElo(opening={"E0": "1112"}).apply([domestic, ucl])
    assert a[0][1] == b[0][1]
    assert a[0][1] > 1500.0   # Arsenal's pre-UCL rating already includes the 3-0


def test_neutral_final_gets_no_home_advantage():
    neutral = U.UnifiedElo(opening={})
    neutral.apply([ev("2027-05-30", "UCL", "ENG:A", "ESP:B", 1, 0, season="ucl", neutral=True)])
    home = U.UnifiedElo(opening={})
    home.apply([ev("2027-05-30", "UCL", "ENG:A", "ESP:B", 1, 0, season="ucl")])
    assert neutral.r["ENG:A"] > home.r["ENG:A"]   # winning without the +60 is worth more


def test_continuation_is_deterministic_and_equals_one_pass_replay():
    pre = [ev("2025-09-01", "E0", "ENG:Arsenal", "ENG:Chelsea", 2, 1, season="2526"),
           ev("2025-09-17", "UCL", "ENG:Arsenal", "ARM:Ararat", 4, 0, season="ucl")]
    post = [ev("2026-08-16", "E0", "ENG:Chelsea", "ENG:Arsenal", 0, 2),
            ev("2026-09-08", "UCL", "ARM:Ararat", "ENG:Chelsea", 1, 1, season="ucl")]
    opening = {"E0": "2526"}

    one_pass = U.UnifiedElo(opening=opening)
    one_pass.apply(pre + post)

    first = U.UnifiedElo(opening=opening)
    first.apply(pre)
    blob = json.loads(json.dumps(first.to_clubs()))       # via the JSON artifact shape
    def cont():
        st = U.UnifiedElo({k: v["r"] for k, v in blob.items()}, {k: v["n"] for k, v in blob.items()},
                          deepcopy(first.opening))
        st.apply(post)
        return st

    a, b = cont(), cont()
    assert a.r == b.r == one_pass.r
    assert a.n == one_pass.n


# --- football-data.co.uk parsing ---------------------------------------------

E0_2627 = ("Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n"
           "E0,15/08/2026,15:00,Arsenal,Chelsea,2,1,H\n"
           "E0,20/06/2026,15:00,Old,Row,1,1,D\n"      # before the cutoff: ignored
           "E0,29/08/2026,15:00,Man City,Liverpool,,,\n")     # unplayed: ignored
AUT = ("Country,League,Season,Date,Time,Home,Away,HG,AG,Res\n"
       "Austria,Bundesliga,2025/2026,10/05/2026,15:00,LASK,Salzburg,1,0,H\n"
       "Austria,Bundesliga,2026/2027,02/08/2026,15:00,LASK,Salzburg,2,2,D\n")


def _fake_get(overrides=None):
    overrides = overrides or {}

    def get(url: str) -> bytes:
        if url in overrides:
            return overrides[url]
        if url == U.AUT_URL:
            return AUT.encode()
        div = url.rsplit("/", 1)[1][:-4]
        header = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR\n"
        return (E0_2627 if div == "E0" else header).encode("latin-1")
    return get


def test_current_domestic_rows_are_filtered_to_the_cutoff_and_keyed_canonically():
    events = U.fetch_current_domestic(_fake_get())
    got = {(e.date, e.comp, e.home, e.away, e.gh, e.ga, e.season) for e in events}
    assert got == {
        ("2026-08-15", "E0", "ENG:Arsenal", "ENG:Chelsea", 2, 1, "2627"),
        ("2026-08-02", "AUT", "AUT:LASK", "AUT:Salzburg", 2, 2, "2627"),
    }


def test_a_fetch_error_or_bad_file_raises_so_the_caller_can_fail_closed():
    def boom(url):
        raise OSError("network down")

    with pytest.raises(OSError):
        U.fetch_current_domestic(boom)
    with pytest.raises(ValueError):
        U.fetch_current_domestic(_fake_get({U.FD_URL.format(season="2627", div="E0"): b"<html>nope</html>"}))


def test_the_runtime_fetch_is_bounded_and_anonymous(monkeypatch):
    import requests

    seen = {}

    class R:
        content = b"x"
        def raise_for_status(self): pass

    def fake(url, headers, timeout):
        seen.update(url=url, headers=headers, timeout=timeout)
        return R()

    monkeypatch.setattr(requests, "get", fake)
    assert U._http_get("https://example.test/f.csv") == b"x"
    assert seen["timeout"] == U.FETCH_TIMEOUT <= 30
    assert seen["headers"] == {"User-Agent": "finalwhistle-pipeline/1.0"}
