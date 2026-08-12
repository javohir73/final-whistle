"""Public and premium market surfaces must not contradict each other.

The bug: an anonymous match page rendered the public Goals section (Over 2.5 =
53%, Both score = 56%) directly above a premium teaser claiming Over 2.5 = 57%
and BTTS = 48% for the same match. Two numbers for one quantity, on one page.

Part of that was a fabricated teaser (fixed in the frontend). The rest was real:
poisson.goal_markets and markets.derive_scoreline_markets built their own grids
with different cleaning and different rounding, and disagreed by ~5e-5. Invisible
at whole-percent display — until either side moves.

Both now go through poisson.normalized_score_matrix + total_over/btts_yes. These
tests assert EXACT equality, so any future divergence is a test failure rather
than a support ticket.
"""
import pytest

from ml.models.markets import both_teams_to_score, derive_scoreline_markets, over_under
from ml.models.poisson import goal_markets

# Spread of realistic match shapes: even, home-heavy, away-heavy, low- and
# high-scoring, with and without the Dixon-Coles correction.
LAMBDAS = [
    (1.6, 1.2, -0.03),
    (2.1, 0.7, -0.05),
    (1.35, 1.35, 0.0),
    (0.9, 2.4, -0.08),
    (3.0, 0.4, -0.12),
    (0.6, 0.5, 0.05),
    (2.8, 2.6, -0.02),
]


@pytest.mark.parametrize("lam_home,lam_away,rho", LAMBDAS)
def test_over_2_5_is_identical_on_both_surfaces(lam_home, lam_away, rho):
    public = goal_markets(lam_home, lam_away, rho)["total"]["over_2_5"]
    premium = next(
        t["over"] for t in derive_scoreline_markets(lam_home, lam_away, rho)["totals"]
        if t["line"] == 2.5
    )
    assert public == premium


@pytest.mark.parametrize("lam_home,lam_away,rho", LAMBDAS)
def test_btts_is_identical_on_both_surfaces(lam_home, lam_away, rho):
    public = goal_markets(lam_home, lam_away, rho)["btts"]
    premium = derive_scoreline_markets(lam_home, lam_away, rho)["btts"]["yes"]
    assert public == premium


@pytest.mark.parametrize("lam_home,lam_away,rho", LAMBDAS)
def test_over_3_5_is_identical_on_both_surfaces(lam_home, lam_away, rho):
    # The Goals section renders Over 3.5 too, and the premium ladder carries it.
    public = goal_markets(lam_home, lam_away, rho)["total"]["over_3_5"]
    premium = next(
        t["over"] for t in derive_scoreline_markets(lam_home, lam_away, rho)["totals"]
        if t["line"] == 3.5
    )
    assert public == premium


@pytest.mark.parametrize("lam_home,lam_away,rho", LAMBDAS)
def test_standalone_helpers_agree_with_the_bundle(lam_home, lam_away, rho):
    """over_under()/both_teams_to_score() are the public one-market entry points;
    derive_scoreline_markets() is the bundle. A caller must not get a different
    answer depending on which one they reached for."""
    bundle = derive_scoreline_markets(lam_home, lam_away, rho)
    solo_totals = over_under(lam_home, lam_away, rho)
    for line in (0.5, 1.5, 2.5, 3.5, 4.5):
        assert (
            next(t["over"] for t in solo_totals if t["line"] == line)
            == next(t["over"] for t in bundle["totals"] if t["line"] == line)
        )
    assert both_teams_to_score(lam_home, lam_away, rho) == bundle["btts"]


@pytest.mark.parametrize("lam_home,lam_away,rho", LAMBDAS)
def test_complements_sum_to_one_as_displayed(lam_home, lam_away, rho):
    """over+under and yes+no must total exactly 1 at display precision. Rounding
    each side independently is how a panel ends up reading 57% / 44%."""
    bundle = derive_scoreline_markets(lam_home, lam_away, rho)
    for t in bundle["totals"]:
        assert t["over"] + t["under"] == pytest.approx(1.0, abs=1e-9)
    assert bundle["btts"]["yes"] + bundle["btts"]["no"] == pytest.approx(1.0, abs=1e-9)


@pytest.mark.parametrize("lam_home,lam_away,rho", LAMBDAS)
def test_totals_ladder_is_monotonic(lam_home, lam_away, rho):
    """A sanity property the shared grid must preserve: P(total > line) can only
    fall as the line rises."""
    overs = [t["over"] for t in sorted(
        derive_scoreline_markets(lam_home, lam_away, rho)["totals"],
        key=lambda t: t["line"],
    )]
    assert overs == sorted(overs, reverse=True)
