"""Templated reasons: selection rule, wording and the refusal to overstate."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from ml.sports.ufc.features import FighterFacts, Snapshot
from ml.sports.ufc.reasons import GROUPS, MIN_CONTRIBUTION, elo_reasons, form_reasons


def facts(**kw) -> FighterFacts:
    base = dict(
        rating=1500.0, age_years=30.0, reach_in=72.0, height_in=70.0, layoff_days=100,
        ufc_fights=5, wins3=None, wins5=None, finish_rate=None, sig_str_pm=None, td_p15=None,
    )
    base.update(kw)
    return FighterFacts(**base)


def snap(a: FighterFacts | None = None, b: FighterFacts | None = None) -> Snapshot:
    return Snapshot(1, datetime(2026, 1, 1, tzinfo=timezone.utc), 0.5, {}, a or facts(), b or facts())


A, B = "Umar Magomedov", "Israel Adesanya"


def test_examples_from_the_brief():
    s = snap(facts(age_years=28.0), facts(age_years=33.0, reach_in=79.0))
    s = replace(s, a=replace(s.a, reach_in=72.0))
    assert form_reasons(A, B, s, {"age_diff": 0.30, "reach_diff": -0.20}, 0.6) == ["Umar Magomedov is five years younger."]
    assert form_reasons(A, B, s, {"age_diff": 0.04, "reach_diff": -0.25}, 0.4) == [
        "Israel Adesanya has a seven-inch reach advantage."
    ]


def test_at_most_three_largest_first():
    s = snap(
        facts(rating=1600, age_years=25.0, reach_in=76.0, height_in=73.0, ufc_fights=9),
        facts(rating=1500, age_years=31.0, reach_in=72.0, height_in=70.0, ufc_fights=2),
    )
    contribs = {"elo_diff": 0.1, "age_diff": 0.4, "reach_diff": 0.3, "height_diff": 0.2, "fights_diff": 0.5}
    assert form_reasons("A One", "B Two", s, contribs, 0.7) == [
        "A One has 9 UFC fights to B Two's 2.",
        "A One is six years younger.",
        "A One has a four-inch reach advantage.",
    ]


def test_ties_follow_group_order():
    s = snap(facts(age_years=25.0, reach_in=76.0), facts(age_years=31.0, reach_in=72.0))
    out = form_reasons("A One", "B Two", s, {"age_diff": 0.2, "reach_diff": 0.2}, 0.7)
    assert out == ["A One is six years younger.", "A One has a four-inch reach advantage."]
    assert [g for g, _ in GROUPS][:3] == ["rating", "age", "reach"]


def test_small_contributions_give_no_reason():
    s = snap(facts(age_years=25.0), facts(age_years=31.0))
    assert form_reasons(A, B, s, {"age_diff": MIN_CONTRIBUTION, "reach_diff": -0.9}, 0.6) == []


def test_contribution_against_the_winner_is_ignored():
    s = snap(facts(reach_in=70.0), facts(reach_in=76.0))
    assert form_reasons(A, B, s, {"reach_diff": -0.4}, 0.6) == []
    # a's longer reach, but the model counts it against a: never phrased as help
    s = snap(facts(reach_in=76.0), facts(reach_in=70.0))
    assert form_reasons(A, B, s, {"reach_diff": -0.4}, 0.6) == []


def test_reason_names_the_winner_when_b_wins():
    s = snap(facts(age_years=33.0), facts(age_years=28.0))
    assert form_reasons(A, B, s, {"age_diff": -0.3}, 0.3) == ["Israel Adesanya is five years younger."]


def test_missing_values_skip_the_template():
    s = snap(facts(age_years=None, reach_in=70.0), facts(age_years=30.0, reach_in=75.0))
    out = form_reasons(A, B, s, {"age_missing": 0.3, "reach_diff": -0.2}, 0.4)
    assert out == ["Israel Adesanya has a five-inch reach advantage."]
    s = snap(facts(age_years=None, reach_in=None, height_in=None), facts(age_years=30.0, reach_in=None, height_in=None))
    assert form_reasons(A, B, s, {"age_missing": 0.3, "reach_missing": 0.3, "height_missing": 0.3}, 0.6) == []


def test_zero_rounded_difference_is_skipped():
    s = snap(facts(age_years=30.0, height_in=70.0), facts(age_years=30.4, height_in=70.2))
    assert form_reasons(A, B, s, {"age_diff": 0.3, "height_diff": 0.3}, 0.6) == []


def test_coin_flip_and_tba_give_none():
    s = snap(facts(age_years=25.0), facts(age_years=31.0))
    c = {"age_diff": 0.5}
    assert form_reasons(A, B, s, c, 0.5) == []
    assert form_reasons(A, "TBA", s, c, 0.6) == []
    assert form_reasons("TBA", B, s, c, 0.6) == []
    assert elo_reasons(A, "TBA", snap(facts(rating=1560), facts()), 0.6) == []


def test_full_names_pass_through_unchanged():
    s = snap(facts(age_years=25.0), facts(age_years=26.0))
    for name in ["Sean O'Malley", "Jiří Procházka", "Jean-Claude Van Damme", "Benoît Saint Denis", "Jose Aldo Jr.", "Madonna"]:
        assert form_reasons(name, "X Yan", s, {"age_diff": 0.3}, 0.6) == [f"{name} is one year younger."]
    assert form_reasons("Bruno Silva", "Rafael Silva", s, {"age_diff": 0.3}, 0.6) == ["Bruno Silva is one year younger."]


def test_tba_with_whitespace_and_case_gives_none():
    s = snap(facts(age_years=25.0), facts(age_years=31.0))
    assert form_reasons(A, " tba ", s, {"age_diff": 0.5}, 0.6) == []


def test_singular_units():
    s = snap(facts(age_years=29.0, height_in=71.0), facts(age_years=30.0, height_in=70.0))
    assert form_reasons(A, B, s, {"age_diff": 0.3}, 0.6) == ["Umar Magomedov is one year younger."]
    assert form_reasons(A, B, s, {"height_diff": 0.3}, 0.6) == ["Umar Magomedov is one inch taller."]
    s = snap(facts(age_years=28.0, height_in=72.0), facts(age_years=30.0, height_in=70.0))
    assert form_reasons(A, B, s, {"age_diff": 0.3}, 0.6) == ["Umar Magomedov is two years younger."]
    assert form_reasons(A, B, s, {"height_diff": 0.3}, 0.6) == ["Umar Magomedov is two inches taller."]


def test_older_winner_and_large_numbers_as_digits():
    s = snap(facts(age_years=41.0), facts(age_years=30.0))
    assert form_reasons(A, B, s, {"age_diff": 0.3}, 0.6) == ["Umar Magomedov is 11 years older."]


def test_debut_and_layoff_sentences():
    s = snap(facts(layoff_days=90), facts(layoff_days=None))
    assert form_reasons(A, B, s, {"debut": 0.3}, 0.6) == ["Israel Adesanya is making a UFC debut."]
    s = snap(facts(layoff_days=90), facts(layoff_days=400))
    assert form_reasons(A, B, s, {"layoff_diff": 0.3}, 0.6) == ["Israel Adesanya has not fought in the UFC for 13 months."]
    s = snap(facts(layoff_days=90), facts(layoff_days=200))
    assert form_reasons(A, B, s, {"layoff_diff": 0.3}, 0.6) == ["Umar Magomedov has fought more recently."]
    s = snap(facts(layoff_days=None), facts(layoff_days=None))
    assert form_reasons(A, B, s, {"debut": 0.3}, 0.6) == []
    s = snap(facts(layoff_days=None), facts(layoff_days=90))
    assert form_reasons(A, B, s, {"debut": 0.3}, 0.6) == []


def test_experience_form_finishing_striking_wrestling():
    w = facts(ufc_fights=12, wins3=(3, 3), wins5=(4, 5), finish_rate=0.666, sig_str_pm=1.26, td_p15=0.94)
    l = facts(ufc_fights=3, wins3=(1, 3), wins5=(1, 3), finish_rate=0.25, sig_str_pm=0.5, td_p15=-1.0)
    s = snap(w, l)
    one = lambda k, v: form_reasons(A, B, s, {k: v}, 0.6)
    assert one("fights_diff", 0.3) == ["Umar Magomedov has 12 UFC fights to Israel Adesanya's 3."]
    assert one("win5_diff", 0.3) == ["Umar Magomedov has won four of their last five UFC fights."]
    assert one("finish_diff", 0.3) == ["Umar Magomedov has finished 67% of their UFC wins."]
    assert one("sig_str_diff", 0.3) == ["Umar Magomedov lands 1.3 more significant strikes a minute than they absorb."]
    assert one("td_diff", 0.3) == ["Umar Magomedov averages 0.9 more takedowns than they concede per 15 minutes."]


def test_unknown_opponent_stats_still_allow_the_known_side():
    w = facts(wins5=(2, 2), finish_rate=0.5, sig_str_pm=1.0, td_p15=2.0)
    s = snap(w, facts())
    for k, text in [
        ("form_missing", "Umar Magomedov has won two of their last two UFC fights."),
        ("finish_missing", "Umar Magomedov has finished 50% of their UFC wins."),
        ("stats_missing", "Umar Magomedov lands 1.0 more significant strikes a minute than they absorb."),
    ]:
        assert form_reasons(A, B, s, {k: 0.3}, 0.6) == [text]


def test_stats_conditions_are_not_overstated():
    # W's strike differential is negative or below L's: no sentence
    s = snap(facts(sig_str_pm=-0.5, td_p15=-1.0, finish_rate=0.2, wins5=(1, 5)),
             facts(sig_str_pm=-1.0, td_p15=-2.0, finish_rate=0.5, wins5=(3, 5)))
    c = {"sig_str_diff": 0.3, "td_diff": 0.3, "finish_diff": 0.3, "win5_diff": 0.3}
    assert form_reasons(A, B, s, c, 0.6) == []


def test_a_single_fight_record_is_not_pluralised_wrongly():
    s = snap(facts(wins5=(1, 1)), facts())
    assert form_reasons(A, B, s, {"form_missing": 0.3}, 0.6) == []


def test_elo_reason():
    s = snap(facts(rating=1560.4), facts(rating=1500.0))
    assert elo_reasons("A Aaa", "B Bbb", s, 0.586) == ["A Aaa is rated higher, 1560 to 1500."]
    assert elo_reasons("A Aaa", "B Bbb", s, 0.505) == []
    assert elo_reasons("A Aaa", "B Bbb", s, 0.5) == []
    s2 = snap(facts(rating=1500.0), facts(rating=1560.0))
    assert elo_reasons("A Aaa", "B Bbb", s2, 0.414) == ["B Bbb is rated higher, 1560 to 1500."]
    # the favourite by probability is not the higher-rated: no sentence
    assert elo_reasons("A Aaa", "B Bbb", s2, 0.6) == []


def test_rating_in_form_reasons_needs_the_higher_rating():
    s = snap(facts(rating=1500.0), facts(rating=1560.0))
    assert form_reasons("A Aaa", "B Bbb", s, {"elo_diff": 0.4}, 0.6) == []
    s = snap(facts(rating=1560.0), facts(rating=1500.0))
    assert form_reasons("A Aaa", "B Bbb", s, {"elo_diff": 0.2, "elo_diff_x_five": 0.1}, 0.6) == [
        "A Aaa is rated higher, 1560 to 1500."
    ]


def test_layoff_sentence_needs_the_winner_to_be_fresher():
    # W 800 days out, L 400 days out, model still credits the layoff to W: no sentence
    s = snap(facts(layoff_days=800), facts(layoff_days=400))
    assert form_reasons(A, B, s, {"layoff_diff": 0.3}, 0.6) == []
    s = snap(facts(layoff_days=400), facts(layoff_days=400))
    assert form_reasons(A, B, s, {"layoff_diff": 0.3}, 0.6) == []


def test_winless_form_is_not_a_reason():
    s = snap(facts(wins5=(0, 3)), facts())
    assert form_reasons(A, B, s, {"form_missing": 0.3}, 0.6) == []


def test_no_contest_inside_the_window_is_not_counted_in_n():
    from ml.sports.ufc.features import snapshots
    from ml.sports.ufc.elo import EloParams
    from ml.sports.ufc import testkit
    h = testkit.history([
        ("2024-01-01", "W Fighter", "O One", "a", "decision"),
        ("2024-02-01", "W Fighter", "O Two", None, "no_contest"),
        ("2024-03-01", "W Fighter", "O Three", "a", "decision"),
    ])
    target = replace(h.bouts[0], bout_id=99, when=datetime(2024, 9, 1, tzinfo=timezone.utc),
                     fighter_a=1, fighter_b=9, winner=None, method=None, finished=False)
    sn = snapshots(h, EloParams(), [target])[99]
    assert sn.a.wins5 == (2, 2)
    assert form_reasons("W Fighter", "L Fighter", sn, {"form_missing": 0.3}, 0.6) == [
        "W Fighter has won two of their last two UFC fights."
    ]


def test_one_decimal_rounds_half_up():
    s = snap(facts(sig_str_pm=1.25, td_p15=2.25), facts())
    assert form_reasons(A, B, s, {"stats_missing": 0.3}, 0.6) == [
        "Umar Magomedov lands 1.3 more significant strikes a minute than they absorb."
    ]
    assert form_reasons(A, B, s, {"td_diff": 0.3}, 0.6) == [
        "Umar Magomedov averages 2.3 more takedowns than they concede per 15 minutes."
    ]
