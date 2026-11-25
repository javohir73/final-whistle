"""Templated reasons: selection rule, wording and the refusal to overstate."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

from ml.sports.ufc.features import FighterFacts, Snapshot
from ml.sports.ufc.reasons import GROUPS, MIN_CONTRIBUTION, display_names, elo_reasons, form_reasons


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
    assert form_reasons(A, B, s, {"age_diff": 0.30, "reach_diff": -0.20}, 0.6) == ["Magomedov is five years younger."]
    assert form_reasons(A, B, s, {"age_diff": 0.04, "reach_diff": -0.25}, 0.4) == [
        "Adesanya has a seven-inch reach advantage."
    ]


def test_at_most_three_largest_first():
    s = snap(
        facts(rating=1600, age_years=25.0, reach_in=76.0, height_in=73.0, ufc_fights=9),
        facts(rating=1500, age_years=31.0, reach_in=72.0, height_in=70.0, ufc_fights=2),
    )
    contribs = {"elo_diff": 0.1, "age_diff": 0.4, "reach_diff": 0.3, "height_diff": 0.2, "fights_diff": 0.5}
    assert form_reasons("A One", "B Two", s, contribs, 0.7) == [
        "One has 9 UFC fights to Two's 2.",
        "One is six years younger.",
        "One has a four-inch reach advantage.",
    ]


def test_ties_follow_group_order():
    s = snap(facts(age_years=25.0, reach_in=76.0), facts(age_years=31.0, reach_in=72.0))
    out = form_reasons("A One", "B Two", s, {"age_diff": 0.2, "reach_diff": 0.2}, 0.7)
    assert out == ["One is six years younger.", "One has a four-inch reach advantage."]
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
    assert form_reasons(A, B, s, {"age_diff": -0.3}, 0.3) == ["Adesanya is five years younger."]


def test_missing_values_skip_the_template():
    s = snap(facts(age_years=None, reach_in=70.0), facts(age_years=30.0, reach_in=75.0))
    out = form_reasons(A, B, s, {"age_missing": 0.3, "reach_diff": -0.2}, 0.4)
    assert out == ["Adesanya has a five-inch reach advantage."]
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


def test_same_surname_uses_full_names():
    assert display_names("Bruno Silva", "Rafael Silva") == ("Bruno Silva", "Rafael Silva")
    assert display_names("Umar Magomedov", "Israel Adesanya") == ("Magomedov", "Adesanya")


def test_names_pass_through_unchanged():
    assert display_names("Sean O'Malley", "Jean-Claude Van Damme") == ("O'Malley", "Damme")
    assert display_names("Jiří Procházka", "Rose Namajunas") == ("Procházka", "Namajunas")
    assert display_names("Madonna", "Cher") == ("Madonna", "Cher")
    assert display_names("Jose Aldo Jr.", "Cub Swanson") == ("Aldo", "Swanson")
    s = snap(facts(age_years=25.0), facts(age_years=26.0))
    assert form_reasons("Sean O'Malley", "X Yan", s, {"age_diff": 0.3}, 0.6) == ["O'Malley is one year younger."]


def test_singular_units():
    s = snap(facts(age_years=29.0, height_in=71.0), facts(age_years=30.0, height_in=70.0))
    assert form_reasons(A, B, s, {"age_diff": 0.3}, 0.6) == ["Magomedov is one year younger."]
    assert form_reasons(A, B, s, {"height_diff": 0.3}, 0.6) == ["Magomedov is one inch taller."]
    s = snap(facts(age_years=28.0, height_in=72.0), facts(age_years=30.0, height_in=70.0))
    assert form_reasons(A, B, s, {"age_diff": 0.3}, 0.6) == ["Magomedov is two years younger."]
    assert form_reasons(A, B, s, {"height_diff": 0.3}, 0.6) == ["Magomedov is two inches taller."]


def test_older_winner_and_large_numbers_as_digits():
    s = snap(facts(age_years=41.0), facts(age_years=30.0))
    assert form_reasons(A, B, s, {"age_diff": 0.3}, 0.6) == ["Magomedov is 11 years older."]


def test_debut_and_layoff_sentences():
    s = snap(facts(layoff_days=90), facts(layoff_days=None))
    assert form_reasons(A, B, s, {"debut": 0.3}, 0.6) == ["Adesanya is making a UFC debut."]
    s = snap(facts(layoff_days=90), facts(layoff_days=400))
    assert form_reasons(A, B, s, {"layoff_diff": 0.3}, 0.6) == ["Adesanya has not fought for 13 months."]
    s = snap(facts(layoff_days=90), facts(layoff_days=200))
    assert form_reasons(A, B, s, {"layoff_diff": 0.3}, 0.6) == ["Magomedov has fought more recently."]
    s = snap(facts(layoff_days=None), facts(layoff_days=None))
    assert form_reasons(A, B, s, {"debut": 0.3}, 0.6) == []
    s = snap(facts(layoff_days=None), facts(layoff_days=90))
    assert form_reasons(A, B, s, {"debut": 0.3}, 0.6) == []


def test_experience_form_finishing_striking_wrestling():
    w = facts(ufc_fights=12, wins3=(3, 3), wins5=(4, 5), finish_rate=0.666, sig_str_pm=1.26, td_p15=0.94)
    l = facts(ufc_fights=3, wins3=(1, 3), wins5=(1, 3), finish_rate=0.25, sig_str_pm=0.5, td_p15=-1.0)
    s = snap(w, l)
    one = lambda k, v: form_reasons(A, B, s, {k: v}, 0.6)
    assert one("fights_diff", 0.3) == ["Magomedov has 12 UFC fights to Adesanya's 3."]
    assert one("win5_diff", 0.3) == ["Magomedov has won four of their last five fights."]
    assert one("finish_diff", 0.3) == ["Magomedov has finished 67% of their wins."]
    assert one("sig_str_diff", 0.3) == ["Magomedov lands 1.3 more significant strikes a minute than they absorb."]
    assert one("td_diff", 0.3) == ["Magomedov averages 0.9 more takedowns than they concede per 15 minutes."]


def test_unknown_opponent_stats_still_allow_the_known_side():
    w = facts(wins5=(2, 2), finish_rate=0.5, sig_str_pm=1.0, td_p15=2.0)
    s = snap(w, facts())
    for k, text in [
        ("form_missing", "Magomedov has won two of their last two fights."),
        ("finish_missing", "Magomedov has finished 50% of their wins."),
        ("stats_missing", "Magomedov lands 1.0 more significant strikes a minute than they absorb."),
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
    assert elo_reasons("A Aaa", "B Bbb", s, 0.586) == ["Aaa is rated higher, 1560 to 1500."]
    assert elo_reasons("A Aaa", "B Bbb", s, 0.505) == []
    assert elo_reasons("A Aaa", "B Bbb", s, 0.5) == []
    s2 = snap(facts(rating=1500.0), facts(rating=1560.0))
    assert elo_reasons("A Aaa", "B Bbb", s2, 0.414) == ["Bbb is rated higher, 1560 to 1500."]
    # the favourite by probability is not the higher-rated: no sentence
    assert elo_reasons("A Aaa", "B Bbb", s2, 0.6) == []


def test_rating_in_form_reasons_needs_the_higher_rating():
    s = snap(facts(rating=1500.0), facts(rating=1560.0))
    assert form_reasons("A Aaa", "B Bbb", s, {"elo_diff": 0.4}, 0.6) == []
    s = snap(facts(rating=1560.0), facts(rating=1500.0))
    assert form_reasons("A Aaa", "B Bbb", s, {"elo_diff": 0.2, "elo_diff_x_five": 0.1}, 0.6) == [
        "Aaa is rated higher, 1560 to 1500."
    ]
