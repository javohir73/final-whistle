import {
  isPickable,
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
