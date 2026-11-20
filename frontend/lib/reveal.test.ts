import { canRevealModel, canRevealModelPublicly, pickGameFor, revealDecision } from "./reveal";

const NOW = new Date("2026-11-20T12:00:00Z");
const FUTURE = "2026-11-21T15:00:00Z";
const PAST = "2026-11-20T11:00:00Z";

describe("revealDecision", () => {
  it("hides an open fixture with no pick", () => {
    expect(revealDecision({ status: "scheduled", kickoff: FUTURE, now: NOW, hasLockedPick: false })).toEqual({
      revealed: false,
      reason: "hidden",
    });
  });

  it("hides an open fixture while the pick is loading or only drafted (callers pass false)", () => {
    expect(canRevealModel({ status: "scheduled", kickoff: FUTURE, now: NOW, hasLockedPick: false })).toBe(false);
  });

  it("reveals an open fixture once the pick is locked", () => {
    expect(revealDecision({ status: "scheduled", kickoff: FUTURE, now: NOW, hasLockedPick: true })).toEqual({
      revealed: true,
      reason: "locked_pick",
    });
  });

  it("reveals finished fixtures to everyone", () => {
    expect(revealDecision({ status: "finished", kickoff: PAST, now: NOW, hasLockedPick: false }).reason).toBe("finished");
    expect(revealDecision({ status: "finished", kickoff: PAST, now: null, hasLockedPick: false }).revealed).toBe(true);
    expect(
      revealDecision({ status: "finished", kickoff: PAST, now: NOW, hasLockedPick: false, viewer: "public" }).revealed,
    ).toBe(true);
  });

  it("reveals live and suspended fixtures (picks are closed)", () => {
    for (const status of ["in_play", "suspended"]) {
      expect(revealDecision({ status, kickoff: PAST, now: NOW, hasLockedPick: false })).toEqual({
        revealed: true,
        reason: "kicked_off",
      });
    }
  });

  it("reveals a scheduled fixture whose kickoff has passed by the clock (feed lag)", () => {
    expect(revealDecision({ status: "scheduled", kickoff: PAST, now: NOW, hasLockedPick: false })).toEqual({
      revealed: true,
      reason: "kicked_off",
    });
    // Exactly at kickoff counts as kicked off (picks lock at kickoff).
    expect(canRevealModel({ status: "scheduled", kickoff: NOW.toISOString(), now: NOW, hasLockedPick: false })).toBe(true);
  });

  it("decides by status alone while the clock is unknown (hydration)", () => {
    expect(canRevealModel({ status: "scheduled", kickoff: PAST, now: null, hasLockedPick: false })).toBe(false);
    expect(canRevealModel({ status: "in_play", kickoff: PAST, now: null, hasLockedPick: false })).toBe(true);
  });

  it("keeps a postponed fixture open: its old kickoff never unlocks it", () => {
    expect(revealDecision({ status: "postponed", kickoff: PAST, now: NOW, hasLockedPick: false })).toEqual({
      revealed: false,
      reason: "hidden",
    });
    expect(revealDecision({ status: "postponed", kickoff: PAST, now: NOW, hasLockedPick: true }).reason).toBe(
      "locked_pick",
    );
  });

  it("reveals a cancelled fixture (it can never be picked)", () => {
    expect(revealDecision({ status: "cancelled", kickoff: FUTURE, now: NOW, hasLockedPick: false })).toEqual({
      revealed: true,
      reason: "closed",
    });
  });

  it("fails closed for a missing kickoff, a garbage kickoff, a missing or unknown status", () => {
    expect(canRevealModel({ status: "scheduled", kickoff: null, now: NOW, hasLockedPick: false })).toBe(false);
    expect(canRevealModel({ status: "scheduled", kickoff: "not a date", now: NOW, hasLockedPick: false })).toBe(false);
    expect(canRevealModel({ status: undefined, kickoff: FUTURE, now: NOW, hasLockedPick: false })).toBe(false);
    expect(canRevealModel({ status: "awarded", kickoff: FUTURE, now: NOW, hasLockedPick: false })).toBe(false);
    // ...but an unknown status past kickoff is no longer pickable.
    expect(canRevealModel({ status: "awarded", kickoff: PAST, now: NOW, hasLockedPick: false })).toBe(true);
  });

  it("reveals open fixtures of a competition with no pick game", () => {
    expect(
      revealDecision({ status: "scheduled", kickoff: FUTURE, now: NOW, hasLockedPick: false, pickGame: false }),
    ).toEqual({ revealed: true, reason: "no_pick_game" });
  });

  it("never lets a pick unlock an open fixture for a public viewer", () => {
    expect(
      revealDecision({ status: "scheduled", kickoff: FUTURE, now: NOW, hasLockedPick: true, viewer: "public" }),
    ).toEqual({ revealed: false, reason: "hidden" });
  });
});

describe("pickGameFor", () => {
  it("maps each competition to its pick game", () => {
    expect(pickGameFor("epl")).toBe("league_tips");
    expect(pickGameFor("laliga")).toBe("league_tips");
    expect(pickGameFor("bundesliga")).toBe("league_tips");
    expect(pickGameFor("nrl")).toBe("nrl_tips");
    expect(pickGameFor("wc26")).toBe("wc_outcome");
    expect(pickGameFor("ucl")).toBeNull();
  });
});

describe("canRevealModelPublicly", () => {
  it("hides an open club-league fixture and reveals once kicked off", () => {
    expect(canRevealModelPublicly("epl", "scheduled", FUTURE, NOW)).toBe(false);
    expect(canRevealModelPublicly("epl", "scheduled", PAST, NOW)).toBe(true);
    expect(canRevealModelPublicly("epl", "finished", PAST, NOW)).toBe(true);
    expect(canRevealModelPublicly("nrl", "scheduled", FUTURE, NOW)).toBe(false);
  });

  it("reveals an open fixture with no pick game", () => {
    expect(canRevealModelPublicly("ucl", "scheduled", FUTURE, NOW)).toBe(true);
  });
});
