import {
  buildRounds,
  currentRoundIndex,
  knockoutWinner,
  matchCountLabel,
  modelRoundPoints,
  modelVerdict,
  resultsRoundIndex,
  seasonFromMatches,
  seasonFromName,
  withoutModel,
} from "./matchweeks";
import type { MatchSummary } from "./types";

let id = 0;
function m(over: Partial<MatchSummary> = {}): MatchSummary {
  id += 1;
  return {
    match_id: id, stage: "group", group: null, kickoff_utc: "2026-11-21T15:00:00Z", venue: null,
    venue_city: null, venue_country: null, is_neutral: false, status: "scheduled", score_home: null,
    score_away: null, minute: null, period: null, injury_time: null, penalty_home: null, penalty_away: null,
    goal_events: [], teams: { home: "A", away: "B" }, predicted_winner: null, probabilities: null,
    predicted_score: { home: 1, away: 0, probability: 0.1 }, confidence: null, matchweek: 11, ...over,
  };
}
const NOW = new Date("2026-11-20T12:00:00Z");

describe("buildRounds", () => {
  it("groups a league by matchweek, in order, kickoff-sorted", () => {
    const rounds = buildRounds("epl", [
      m({ matchweek: 12, kickoff_utc: "2026-11-28T15:00:00Z" }),
      m({ matchweek: 11, kickoff_utc: "2026-11-22T15:00:00Z" }),
      m({ matchweek: 11, kickoff_utc: "2026-11-21T15:00:00Z" }),
    ]);
    expect(rounds.map((r) => r.title)).toEqual(["Matchweek 11", "Matchweek 12"]);
    expect(rounds[0].matches[0].kickoff_utc).toBe("2026-11-21T15:00:00Z");
  });

  it("calls UCL league-phase weeks matchdays and leaves qualifying out", () => {
    const rounds = buildRounds("ucl", [m({ matchweek: 5 }), m({ matchweek: null, stage: "qualifying" })]);
    expect(rounds.map((r) => r.title)).toEqual(["Matchday 5"]);
  });

  it("splits a tournament into group matchdays and knockout stages, final with third place", () => {
    const group = (g: string, day: number) => m({ group: g, matchweek: null, kickoff_utc: `2026-06-1${day}T15:00:00Z` });
    const rounds = buildRounds("wc26", [
      group("Group A", 1), group("Group A", 1), group("Group A", 2), group("Group A", 2), group("Group A", 3), group("Group A", 4),
      m({ stage: "R16", matchweek: null }),
      m({ stage: "final", matchweek: null }),
      m({ stage: "third_place", matchweek: null }),
    ]);
    expect(rounds.map((r) => r.key)).toEqual(["md1", "md2", "md3", "r16", "final"]);
    expect(rounds.find((r) => r.key === "final")!.matches).toHaveLength(2);
  });
});

describe("currentRoundIndex / resultsRoundIndex", () => {
  const rounds = buildRounds("epl", [
    m({ matchweek: 10, status: "finished", score_home: 1, score_away: 0, kickoff_utc: "2026-11-08T15:00:00Z" }),
    // A ghost fixture: scheduled, kickoff long gone -- it never makes a week current.
    m({ matchweek: 9, status: "scheduled", kickoff_utc: "2026-11-01T15:00:00Z" }),
    m({ matchweek: 11, kickoff_utc: "2026-11-21T15:00:00Z" }),
    m({ matchweek: 12, kickoff_utc: "2026-11-28T15:00:00Z" }),
  ]);

  it("opens on the next kick-off's round", () => {
    expect(rounds[currentRoundIndex(rounds, NOW)].key).toBe("11");
  });

  it("prefers a round with a live match", () => {
    const live = buildRounds("epl", [m({ matchweek: 3, status: "in_play" }), m({ matchweek: 4 })]);
    expect(live[currentRoundIndex(live, NOW)].key).toBe("3");
  });

  it("falls back to the last round when nothing is ahead", () => {
    const done = buildRounds("epl", [m({ matchweek: 1, status: "finished" }), m({ matchweek: 2, status: "finished" })]);
    expect(currentRoundIndex(done, NOW)).toBe(1);
    expect(resultsRoundIndex(done, 1)).toBe(1);
  });

  it("finds the latest earlier round with results", () => {
    expect(rounds[resultsRoundIndex(rounds, currentRoundIndex(rounds, NOW))].key).toBe("10");
  });
});

describe("verdicts and points", () => {
  it("grades the model's scoreline like the pick game", () => {
    expect(modelVerdict(m({ status: "finished", score_home: 1, score_away: 0 }))?.kind).toBe("exact");
    expect(modelVerdict(m({ status: "finished", score_home: 3, score_away: 1 }))?.points).toBe(2);
    expect(modelVerdict(m({ status: "finished", score_home: 0, score_away: 0 }))?.label).toBe("Missed");
    expect(modelVerdict(m({ status: "scheduled" }))).toBeNull();
    expect(modelVerdict(m({ status: "finished", score_home: 1, score_away: 0, predicted_score: null }))).toBeNull();
  });

  it("totals a finished round only", () => {
    const [r] = buildRounds("epl", [
      m({ status: "finished", score_home: 1, score_away: 0 }),
      m({ status: "finished", score_home: 2, score_away: 0 }),
    ]);
    expect(modelRoundPoints(r)).toBe(7);
    const [open] = buildRounds("epl", [m({ status: "finished", score_home: 1, score_away: 0 }), m()]);
    expect(modelRoundPoints(open)).toBeNull();
  });

  it("names a knockout winner, penalties included", () => {
    expect(knockoutWinner(m({ status: "finished", score_home: 1, score_away: 1, penalty_home: 4, penalty_away: 5 }))).toBe("B");
    expect(knockoutWinner(m({ status: "finished", score_home: 2, score_away: 1 }))).toBe("A");
  });
});

describe("helpers", () => {
  it("strips every model field", () => {
    const s = withoutModel(m({ probabilities: { home_win: 0.5, draw: 0.3, away_win: 0.2 }, predicted_winner: "A", confidence: "High" }));
    expect(s.predicted_score).toBeNull();
    expect(s.probabilities).toBeNull();
    expect(s.predicted_winner).toBeNull();
    expect(s.confidence).toBeNull();
  });

  it("reads the season", () => {
    expect(seasonFromName("Premier League 2026-27")).toBe("2026–27");
    expect(seasonFromName("FIFA World Cup 2026")).toBe("2026");
    expect(seasonFromName("La Liga")).toBeNull();
    expect(seasonFromMatches([m({ kickoff_utc: "2026-08-21T19:00:00Z" })])).toBe("2026–27");
  });

  it("words small counts", () => {
    expect(matchCountLabel(10)).toBe("Ten matches");
    expect(matchCountLabel(1)).toBe("One match");
    expect(matchCountLabel(24)).toBe("24 matches");
  });
});
