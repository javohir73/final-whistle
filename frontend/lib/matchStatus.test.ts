import {
  isPickable,
  matchPhase,
  STALE_AFTER_MINUTES,
  schemaEventStatus,
  showsKickoffCountdown,
  stoppedLabel,
  willBePlayed,
} from "@/lib/matchStatus";

describe("match status semantics", () => {
  it.each([
    ["postponed", "Postponed"],
    ["cancelled", "Cancelled"],
    ["suspended", "Suspended"],
  ])("labels deliberate stop %s", (status, label) => {
    expect(stoppedLabel(status)).toBe(label);
    expect(showsKickoffCountdown(status)).toBe(false);
  });

  it("only exposes pick controls for scheduled and postponed fixtures", () => {
    expect(isPickable("scheduled")).toBe(true);
    expect(isPickable("postponed")).toBe(true);
    for (const status of ["in_play", "finished", "cancelled", "suspended", "future_status"]) {
      expect(isPickable(status)).toBe(false);
    }
  });

  it("fails closed for unknown playability", () => {
    expect(willBePlayed("scheduled")).toBe(true);
    expect(willBePlayed("postponed")).toBe(true);
    expect(willBePlayed("cancelled")).toBe(false);
    expect(willBePlayed("suspended")).toBe(false);
    expect(willBePlayed("future_status")).toBe(false);
  });

  it("emits structured status only for explicitly mapped states", () => {
    expect(schemaEventStatus("scheduled")).toBe("https://schema.org/EventScheduled");
    expect(schemaEventStatus("in_play")).toBe("https://schema.org/EventScheduled");
    expect(schemaEventStatus("finished")).toBe("https://schema.org/EventScheduled");
    expect(schemaEventStatus(null)).toBe("https://schema.org/EventScheduled");
    expect(schemaEventStatus("postponed")).toBe("https://schema.org/EventPostponed");
    expect(schemaEventStatus("cancelled")).toBe("https://schema.org/EventCancelled");
    expect(schemaEventStatus("suspended")).toBeNull();
    expect(schemaEventStatus("future_status")).toBeNull();
  });
});

/** matchPhase: the one place a surface asks "what state is this fixture in?".
 *  The honesty rule: FULL TIME only when the feed says finished. A feed that
 *  stalls leaves `in_play` (or never-flipped `scheduled`) rows behind; those
 *  read "Result pending" -- never an inferred final, never a ticking LIVE. */
describe("matchPhase", () => {
  const NOW = new Date("2026-11-08T18:00:00Z");
  const ko = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString();

  it("is upcoming for a scheduled fixture before kickoff", () => {
    expect(matchPhase({ status: "scheduled", kickoff_utc: ko(-60) }, NOW)).toBe("upcoming");
  });

  it("is upcoming for a scheduled fixture with no kickoff yet", () => {
    expect(matchPhase({ status: "scheduled", kickoff_utc: null }, NOW)).toBe("upcoming");
  });

  it("stays upcoming just after kickoff while the feed catches up", () => {
    // A lagging feed is not a result: nothing is inferred inside the window.
    expect(matchPhase({ status: "scheduled", kickoff_utc: ko(20) }, NOW)).toBe("upcoming");
  });

  it("is stale when a scheduled fixture's kickoff is long past", () => {
    expect(matchPhase({ status: "scheduled", kickoff_utc: ko(STALE_AFTER_MINUTES + 1) }, NOW)).toBe("stale");
  });

  it("is live only while in_play inside the live window", () => {
    expect(matchPhase({ status: "in_play", kickoff_utc: ko(57) }, NOW)).toBe("live");
  });

  it("is stale -- not finished -- when in_play is stranded past the window", () => {
    expect(matchPhase({ status: "in_play", kickoff_utc: ko(8 * 60) }, NOW)).toBe("stale");
  });

  it("is finished only when the feed says so", () => {
    expect(matchPhase({ status: "finished", kickoff_utc: ko(120) }, NOW)).toBe("finished");
  });

  it.each(["postponed", "cancelled", "suspended"] as const)("passes the deliberate stop %s through", (status) => {
    expect(matchPhase({ status, kickoff_utc: ko(600) }, NOW)).toBe(status);
  });

  it("fails closed for a status it does not recognise", () => {
    expect(matchPhase({ status: "abandoned" as never, kickoff_utc: ko(600) }, NOW)).toBe("stale");
    expect(matchPhase({ status: "abandoned" as never, kickoff_utc: ko(-600) }, NOW)).toBe("upcoming");
  });
});
