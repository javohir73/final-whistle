/** The round-row tip cell: the model's call on an open match appears only
 *  once this device has tipped it (lib/reveal.ts), whatever /tips/mine sends. */
import { render, screen } from "@testing-library/react";
import { NrlTipCell } from "./NrlTipCell";
import { resetMyNrlRoundCache } from "./useMyNrlRound";
import { getMyNrlTips } from "@/lib/nrlTips";
import type { NrlMyTipsResponse } from "@/lib/types";

jest.mock("@/lib/nrlTips", () => ({ ...jest.requireActual("@/lib/nrlTips"), getMyNrlTips: jest.fn() }));
const mockMine = getMyNrlTips as jest.MockedFunction<typeof getMyNrlTips>;

const future = new Date(Date.now() + 86_400_000).toISOString();
const mine = (tipped: boolean): NrlMyTipsResponse => ({
  season: 2026, round: 5, handle: "H", disclaimer: "",
  matches: [{
    id: 7, home: "Storm", away: "Eels", kickoff_utc: future, status: "scheduled", score_home: null, score_away: null,
    is_featured: false, model: { pick: "home", pick_confidence: 0.64, expected_margin: 4 },
    your_tip: tipped ? { pick: "away", margin: null, points: null, round_margin: null, graded_at: null, updated_at: null } : null,
  }],
});

beforeEach(() => {
  localStorage.clear();
  resetMyNrlRoundCache();
});

it("offers the tip action and hides the model's call before a tip", async () => {
  mockMine.mockResolvedValue(mine(false));
  render(<NrlTipCell season={2026} round={5} matchId={7} home="Storm" away="Eels" />);
  expect(await screen.findByRole("link", { name: "Tip Storm v Eels" })).toHaveAttribute("href", "/nrl/tips");
  expect(screen.queryByText(/64%/)).not.toBeInTheDocument();
});

it("shows 'You X / Model X 64%' once tipped", async () => {
  mockMine.mockResolvedValue(mine(true));
  render(<NrlTipCell season={2026} round={5} matchId={7} home="Storm" away="Eels" />);
  expect(await screen.findByText("64%")).toBeInTheDocument();
  expect(screen.getByText("Eels")).toBeInTheDocument();
  expect(screen.getByText(/Model Storm/)).toBeInTheDocument();
});
