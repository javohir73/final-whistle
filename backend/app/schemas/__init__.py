"""Pydantic response schemas. The PredictionOut shape is the PRD §17 contract
that the frontend consumes."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class HealthOut(BaseModel):
    status: str
    app: str
    model_version: str


class TeamsOut(BaseModel):
    home: str
    away: str


class ProbabilitiesOut(BaseModel):
    home_win: float
    draw: float
    away_win: float


class PredictedScoreOut(BaseModel):
    home: int | None
    away: int | None
    probability: float | None


class FeatureWeightOut(BaseModel):
    name: str
    weight: float


class HeadToHeadOut(BaseModel):
    matches: int
    home_wins: int
    draws: int
    away_wins: int


class OddsComparisonOut(BaseModel):
    """Market consensus vs the model. ``market`` is the margin-free implied
    1X2 triple from the latest pre-kickoff odds snapshot (median across
    bookmakers) — probabilities only, never prices or bookmaker names."""
    available: bool = False
    market: ProbabilitiesOut | None = None
    captured_at: str | None = None


class TeamGoalBandsOut(BaseModel):
    to_score: float
    p2: float
    p3: float
    p4: float


class GoalTotalsOut(BaseModel):
    over_1_5: float
    over_2_5: float
    over_3_5: float


class GoalMarketsOut(BaseModel):
    home: TeamGoalBandsOut
    away: TeamGoalBandsOut
    total: GoalTotalsOut
    btts: float


class AvailabilityPlayerOut(BaseModel):
    name: str
    weight: float
    status: str | None = None
    reason: str | None = None


class TeamAvailabilityOut(BaseModel):
    side: str  # "home" | "away"
    attack_delta_pct: float
    players_out: list[AvailabilityPlayerOut]
    note: str


class AvailabilityOut(BaseModel):
    """Announced-XI availability context (v1). Explanation only — it does NOT move
    the published `probabilities`; the adjusted forecast is logged as a shadow twin."""
    has_lineup: bool
    per_team: list[TeamAvailabilityOut]


class KnockoutPathOut(BaseModel):
    """One side's routes through a knockout tie. Unconditional probabilities:
    the three sum to that side's advance probability."""
    win_90: float
    win_et: float
    win_pens: float


class KnockoutPathsOut(BaseModel):
    home: KnockoutPathOut
    away: KnockoutPathOut


class KnockoutOut(BaseModel):
    """Knockout resolution block (model v0.5, ml/models/knockout.py): who goes
    through, decomposed past the 90th minute. Only present for stage != group."""
    p_advance_home: float
    p_advance_away: float
    p_extra_time: float  # level after 90 — the regulation draw probability
    p_shootout: float    # still level after 120
    paths: KnockoutPathsOut


class WriteupOut(BaseModel):
    """Fable-style narrative sections (ml/explain/writeup.py — deterministic
    template). Presentation of the stored numbers only; every sentence derives
    from a model field, so the prose can never disagree with the payload."""
    case_home: str
    case_away: str
    call: str
    caveat: str


class PredictionOut(BaseModel):
    """PRD §17 prediction contract."""

    match_id: int
    model_version: str
    generated_at: str | None
    teams: TeamsOut
    home_team_id: int | None = None
    away_team_id: int | None = None
    group: str | None = None
    group_id: int | None = None
    stage: str | None = None
    # League fixtures only (null for the World Cup): lets the match page find
    # the device's scoreline tip without walking matchweeks.
    matchweek: int | None = None
    is_neutral: bool
    kickoff_utc: str | None = None
    venue: str | None = None
    venue_city: str | None = None
    venue_country: str | None = None
    probabilities: ProbabilitiesOut
    predicted_score: PredictedScoreOut
    confidence: str | None
    reasons: list[str]
    top_features: list[FeatureWeightOut]
    head_to_head: HeadToHeadOut
    odds_comparison: OddsComparisonOut
    disclaimer: str
    goal_markets: GoalMarketsOut | None = None
    availability: AvailabilityOut | None = None
    knockout: KnockoutOut | None = None
    writeup: WriteupOut | None = None


class TeamOut(BaseModel):
    id: int
    name: str
    country_code: str | None
    confederation: str | None
    fifa_rank: int | None
    elo_rating: float | None
    is_host: bool


class GoalEventOut(BaseModel):
    minute: int | None
    side: str          # "home" | "away"
    player: str
    type: str          # "goal" | "penalty" | "own_goal"


class CardEventOut(BaseModel):
    minute: int | None
    side: str          # "home" | "away"
    player: str
    type: str          # "yellow" | "red" (a second yellow arrives as one "red")


class MatchSummaryOut(BaseModel):
    match_id: int
    stage: str
    group: str | None
    # League fixtures only (null for the World Cup): lets the match page find
    # the device's scoreline tip without walking matchweeks.
    matchweek: int | None = None
    kickoff_utc: str | None
    venue: str | None
    venue_city: str | None
    venue_country: str | None
    is_neutral: bool
    status: str
    score_home: int | None
    score_away: int | None
    # Regulation-time (90') score when captured — the basis the model's
    # scoreline prediction is judged on (FR-2.2); null falls back to the final.
    score_home_90: int | None = None
    score_away_90: int | None = None
    minute: int | None
    period: str | None = None
    injury_time: int | None = None
    penalty_home: int | None = None
    penalty_away: int | None = None
    goal_events: list[GoalEventOut] = []
    card_events: list[CardEventOut] = []
    teams: TeamsOut
    predicted_winner: str | None
    probabilities: ProbabilitiesOut | None
    predicted_score: PredictedScoreOut | None
    confidence: str | None
    # In-play win probability (home/draw/away) given the current score and time
    # left. Present only while the match is live; None otherwise (use the
    # pre-match `probabilities`).
    live_probabilities: ProbabilitiesOut | None = None
    # Public competition code of the match's tournament ("wc26", "epl", ...),
    # so a bare /match/:id link can be routed to /football/{competition}/...
    # None when the tournament has no public code.
    competition: str | None = None


class StandingRowOut(BaseModel):
    """A projected (not played) final-table row from the group Monte-Carlo."""

    team_id: int
    team: str
    projected_points: int
    projected_goals_for: int
    projected_goal_diff: int
    qualification_prob: float | None
    # The full league table. Despite the `projected_*` names above (kept for
    # wire compatibility), those three are already REAL tallies from finished
    # results — see group_to_out's docstring. The remaining columns were
    # computed in the same pass and then dropped at this boundary, so a league
    # standings page could show points and goal difference but not played, won,
    # drawn, lost or goals against. Same source, no new query, no migration.
    played: int = 0
    won: int = 0
    drawn: int = 0
    lost: int = 0
    goals_against: int = 0


class GroupOut(BaseModel):
    id: int
    name: str
    standings: list[StandingRowOut]


class TournamentOddsOut(BaseModel):
    """Per-team knockout-run probabilities from the tournament Monte-Carlo."""

    team_id: int
    team: str
    make_knockout: float | None
    reach_r16: float | None
    reach_qf: float | None
    reach_sf: float | None
    reach_final: float | None
    win_title: float | None


class KnockoutSideOut(BaseModel):
    team_id: int | None
    team: str | None
    score: int | None
    penalty: int | None


class KnockoutTieOut(BaseModel):
    match_no: int
    match_id: int | None
    stage: str
    status: str
    kickoff_utc: datetime | None
    home: KnockoutSideOut
    away: KnockoutSideOut
    minute: int | None
    period: str | None
    injury_time: int | None


class KnockoutBracketOut(BaseModel):
    ties: list[KnockoutTieOut]


class FormResultOut(BaseModel):
    opponent: str
    score_for: int
    score_against: int
    result: str  # W/D/L
    date: str | None


class TeamProfileOut(BaseModel):
    team: TeamOut
    group_id: int | None = None
    group_name: str | None = None
    recent_form: list[FormResultOut]
    strengths: list[str]
    weaknesses: list[str]
    # Public competition code this profile belongs to: the requested
    # ?competition=, else the team's current one (see
    # competition_scope.competition_for_team), so a bare /team/:id link can be
    # routed to /football/{competition}/team/:id. None when it has none.
    competition: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorOut(BaseModel):
    error: ErrorBody


# ---- Auth (first-party email + password) ----
class RegisterIn(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class DeleteAccountIn(BaseModel):
    password: str


class RequestResetIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


class VerifyEmailIn(BaseModel):
    token: str


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str | None = None
    avatar_url: str | None = None
    # Whether the email has been confirmed. Non-blocking (an in-app banner
    # prompts verification); defaults False so older clients ignore it harmlessly.
    email_verified: bool = False


# ---- WC26 retention bridge (post-final "what's next" email capture) ----
class BridgeNotifyIn(BaseModel):
    email: str
    source: str = "wc26_final_bridge"


# ---- Anonymous device-level activity ping (D7/D14 retention cohorts) ----
class ActivityPingIn(BaseModel):
    device_id: str


# ---- NRL user tips (beat-the-AI loop, Slice 2) ----
class NrlTipSubmitIn(BaseModel):
    device_id: str
    match_id: int
    pick: str  # home/draw/away
    margin: int | None = None  # featured-match-only guess, 0..100


class NrlTipClaimIn(BaseModel):
    device_id: str


# ---- League score predictions (Beat-the-AI's scoreline, football leagues) ----
class LeagueScorePredictionSubmitIn(BaseModel):
    device_id: str
    match_id: int
    predicted_home: int  # 0..15, validated in the endpoint
    predicted_away: int  # 0..15, validated in the endpoint


# ---- Accounts / brackets / leaderboard ----
class GroupPickIn(BaseModel):
    match_id: int
    pick: str  # home/draw/away


class KnockoutPickIn(BaseModel):
    match_no: int
    picked_team_id: int


class BracketIn(BaseModel):
    group_picks: list[GroupPickIn] = []
    knockout_picks: list[KnockoutPickIn] = []
    champion_team_id: int | None = None
    encoded_state: str | None = None


class BracketScoreOut(BaseModel):
    group_points: int
    knockout_points: int
    champion_bonus: int
    total_points: int
    rank: int | None = None


class BracketOut(BaseModel):
    id: int
    visibility: str
    display_name: str | None = None
    champion_team_id: int | None = None
    completion_pct: float
    group_picks: list[GroupPickIn]
    knockout_picks: list[KnockoutPickIn]
    score: BracketScoreOut | None = None
    submitted_at: str | None = None
    updated_at: str | None = None


# ---- Per-match picks (account copy of the device-local match predictions) ----
class MatchPickIn(BaseModel):
    match_id: int
    pick: str  # home/draw/away


class MatchPicksIn(BaseModel):
    picks: list[MatchPickIn] = []


class MatchPicksOut(BaseModel):
    picks: list[MatchPickIn]
    updated_at: str | None = None


class JoinLeaderboardIn(BaseModel):
    display_name: str
    visibility: str = "public"  # public/private


class LeaderboardRowOut(BaseModel):
    rank: int | None = None
    display_name: str
    champion: str | None = None
    total_points: int
    percentile: int | None = None
    updated_at: str | None = None


# ---- Match lineups (display-only; never feeds the prediction model) ----
class LineupPlayerOut(BaseModel):
    name: str
    number: int | None
    position: str | None
    grid: str | None
    is_starter: bool


class TeamLineupOut(BaseModel):
    team: str
    formation: str | None
    coach: str | None
    start_xi: list[LineupPlayerOut]
    bench: list[LineupPlayerOut]


class MatchLineupsOut(BaseModel):
    available: bool
    message: str | None
    home: TeamLineupOut | None
    away: TeamLineupOut | None
    fetched_at: str | None


class GoalscorerOut(BaseModel):
    name: str
    position: str | None
    p_score: float
    p_score_2plus: float
    xg: float


class GoalscorersOut(BaseModel):
    mode: str                     # "lineup" | "squad"
    home: list[GoalscorerOut]
    away: list[GoalscorerOut]


# ---- Versioned public markets API (/v1/markets/{match}) ----
# Additive Phase-2 contract (docs/ROADMAP-ENGINE.md). 1X2 + double chance come
# from the STORED calibrated triple; every scoreline-grid market is priced off
# the raw Poisson grid on the stored lambdas — calibration only touches W/D/L.
class DoubleChanceOut(BaseModel):
    home_or_draw: float
    home_or_away: float
    draw_or_away: float


class TotalsLineOut(BaseModel):
    line: float
    over: float
    under: float


class BttsOut(BaseModel):
    yes: float
    no: float


class CorrectScoreOut(BaseModel):
    home: int
    away: int
    prob: float


class AsianHandicapLineOut(BaseModel):
    line: float
    home: float
    push: float
    away: float


class DerivedMarketsOut(BaseModel):
    one_x_two: ProbabilitiesOut
    double_chance: DoubleChanceOut
    totals: list[TotalsLineOut]
    btts: BttsOut
    correct_score: list[CorrectScoreOut]
    asian_handicap: list[AsianHandicapLineOut]


class MarketsExplanationOut(BaseModel):
    confidence: str | None
    reasons: list[str]
    top_features: list[FeatureWeightOut]


class MarketsCalibrationOut(BaseModel):
    basis: str
    per_market_vs_close: str | None = None


class LiveMarketsStateOut(BaseModel):
    """The live match state a ``?live=1`` markets payload was priced from, so a
    consumer can tie the numbers to a minute/scoreline. Present only on live
    responses; every field defaults None."""

    minute: int | None = None
    current_home: int | None = None
    current_away: int | None = None


class MarketsOut(BaseModel):
    match_id: int
    model_version: str
    generated_at: str | None
    teams: TeamsOut
    markets: DerivedMarketsOut
    explanation: MarketsExplanationOut
    calibration: MarketsCalibrationOut
    disclaimer: str
    # Phase-3 in-play re-pricing (additive; defaults preserve the Phase-2 shape).
    # is_live=True + live set only on a ?live=1 response for an in-play match with
    # a usable clock; otherwise the payload is the frozen pre-match markets.
    is_live: bool = False
    live: LiveMarketsStateOut | None = None
# ---- UFC (public, read-only; no model fields until phase 4) ----
class UfcRecordOut(BaseModel):
    wins: int
    losses: int
    draws: int
    no_contests: int


class UfcFighterMiniOut(BaseModel):
    slug: str
    name: str
    country: str | None
    record: UfcRecordOut | None


class UfcMainEventOut(BaseModel):
    fighter_a: UfcFighterMiniOut
    fighter_b: UfcFighterMiniOut


class UfcResultOut(BaseModel):
    winner: Literal["a", "b"] | None
    method: str | None
    method_detail: str | None
    end_round: int | None
    end_clock: str | None


class UfcBoutSummaryOut(BaseModel):
    id: int
    card_order: int | None
    weight_class: str | None
    scheduled_rounds: int | None
    is_title: bool | None
    scheduled_utc: datetime | None
    status: str
    fighter_a: UfcFighterMiniOut
    fighter_b: UfcFighterMiniOut
    result: UfcResultOut | None


class UfcSegmentOut(BaseModel):
    key: str
    label: str
    scheduled_utc: datetime | None
    bouts: list[UfcBoutSummaryOut]


class UfcEventSummaryOut(BaseModel):
    slug: str
    name: str
    status: str
    first_bout_utc: datetime | None
    last_bout_utc: datetime | None
    venue: str | None
    bout_count: int
    main_event: UfcMainEventOut | None


class UfcEventDetailOut(UfcEventSummaryOut):
    segments: list[UfcSegmentOut]


class UfcEventsOut(BaseModel):
    events: list[UfcEventSummaryOut]


class UfcEventRefOut(BaseModel):
    slug: str
    name: str
    first_bout_utc: datetime | None


class UfcSegmentRefOut(BaseModel):
    key: str
    label: str


class UfcTapeSideOut(BaseModel):
    age: int | None
    height_in: float | None
    reach_in: float | None
    stance: str | None


class UfcTapeOut(BaseModel):
    a: UfcTapeSideOut
    b: UfcTapeSideOut


class UfcStatLineOut(BaseModel):
    knockdowns: int | None
    sig_strikes_landed: int | None
    sig_strikes_attempted: int | None
    total_strikes_landed: int | None
    total_strikes_attempted: int | None
    takedowns_landed: int | None
    takedowns_attempted: int | None
    submission_attempts: int | None
    reversals: int | None
    control_seconds: int | None


class UfcStatsOut(BaseModel):
    a: UfcStatLineOut
    b: UfcStatLineOut


class UfcJudgesOut(BaseModel):
    a: list[int]
    b: list[int]


class UfcBoutDetailOut(UfcBoutSummaryOut):
    event: UfcEventRefOut
    segment: UfcSegmentRefOut
    tape: UfcTapeOut
    stats: UfcStatsOut | None
    judges: UfcJudgesOut | None


class UfcOpponentOut(BaseModel):
    slug: str
    name: str
    country: str | None


class UfcFighterEventOut(BaseModel):
    slug: str
    name: str
    date: datetime | None


class UfcFighterBoutOut(BaseModel):
    id: int
    event: UfcFighterEventOut
    opponent: UfcOpponentOut
    outcome: Literal["win", "loss", "draw", "no_contest"] | None
    method: str | None
    end_round: int | None
    end_clock: str | None
    weight_class: str | None
    status: str
    scheduled_utc: datetime | None


class UfcFighterDetailOut(BaseModel):
    slug: str
    name: str
    country: str | None
    date_of_birth: date | None
    age: int | None
    height_in: float | None
    reach_in: float | None
    stance: str | None
    record: UfcRecordOut | None
    bouts: list[UfcFighterBoutOut]
