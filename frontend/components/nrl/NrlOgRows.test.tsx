import { ogRowRight } from "./NrlOgRows";
import type { NrlTipsheetMatch } from "@/lib/types";

const now = new Date("2026-07-01T00:00:00Z");
const match = (over: Partial<NrlTipsheetMatch> = {}): NrlTipsheetMatch => ({
  id: 1, match_no: 1, kickoff_utc: "2026-07-03T09:00:00Z", venue: null, home: "Storm", away: "Eels",
  home_team_id: 1, away_team_id: 2, score_home: null, score_away: null, status: "scheduled",
  prediction: { p_home: 0.7, p_draw: 0.01, p_away: 0.29, expected_margin: 8, model_version: "v", created_at: null,
    is_shadow: false, pick: "home", pick_confidence: 0.7 },
  ...over,
});

it("never puts the model's pick on a public OG image for an open match", () => {
  const r = ogRowRight(match(), now);
  expect(r.text).not.toMatch(/%|Storm/);
  expect(r.tone).toBe("muted");
});

it("shows the graded pick once the match is finished", () => {
  expect(ogRowRight(match({ status: "finished", score_home: 24, score_away: 10 }), now)).toEqual({
    text: "Called · Storm 70%", tone: "brand",
  });
  expect(ogRowRight(match({ status: "finished", score_home: 4, score_away: 10 }), now).text).toBe("Missed · Storm 70%");
});
