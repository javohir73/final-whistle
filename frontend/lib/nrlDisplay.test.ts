import { nrlFinalsRounds, nrlGrandFinal, nrlModelCall, ordinal, signedNumber } from "./nrlDisplay";
import type { NrlMatch, NrlRound } from "./types";

const m = (id: number, over: Partial<NrlMatch> = {}): NrlMatch => ({
  id, match_no: id, kickoff_utc: "2026-09-01T08:00:00Z", venue: null, home: "Roosters", away: "Knights",
  home_team_id: 1, away_team_id: 2, score_home: 19, score_away: 18, status: "finished", prediction: null, ...over,
});
const round = (n: number, count: number): NrlRound => ({ round: n, matches: Array.from({ length: count }, (_, i) => m(n * 10 + i)) });

it("finds the finals as the trailing run of small rounds, named by stage", () => {
  const rounds = [round(26, 8), round(27, 8), round(28, 4), round(29, 2), round(30, 2), round(31, 1)];
  expect(nrlFinalsRounds(rounds).map((f) => [f.round, f.stage])).toEqual([
    [28, "Finals week one"], [29, "Semi-finals"], [30, "Preliminary finals"], [31, "Grand Final"],
  ]);
  expect(nrlGrandFinal(rounds)?.round).toBe(31);
});

it("works mid-finals and finds nothing in the regular season (Origin rounds of 5 are not finals)", () => {
  expect(nrlFinalsRounds([round(27, 8), round(28, 4)]).map((f) => f.stage)).toEqual(["Finals week one"]);
  expect(nrlFinalsRounds([round(11, 8), round(12, 5)])).toEqual([]);
  expect(nrlGrandFinal([round(27, 8), round(28, 4)])).toBeNull();
});

it("grades the model's call on a finished match, and makes none without a prediction", () => {
  const pred = { p_home: 0.64, p_draw: 0.01, p_away: 0.35, expected_margin: 4, model_version: "v", created_at: null, is_shadow: true };
  expect(nrlModelCall(m(1, { prediction: pred }))).toEqual({ team: "Roosters", probability: 0.64, called: true });
  expect(nrlModelCall(m(1, { prediction: pred, score_home: 10, score_away: 20 }))?.called).toBe(false);
  expect(nrlModelCall(m(1, { prediction: pred, status: "scheduled", score_home: null, score_away: null }))?.called).toBeNull();
  expect(nrlModelCall(m(1))).toBeNull();
});

it("formats signed numbers with a real minus and ordinals", () => {
  expect(signedNumber(164)).toBe("+164");
  expect(signedNumber(-94)).toBe("−94");
  expect(signedNumber(0)).toBe("0");
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
});
