import {
  ABOUT_NOTE, NOT_AFFILIATED, boutHref, boutSubLine, controlTimeText, eventHref, eventStatusNote,
  fighterHref, fighterInitials, heightText, isBoutId, isEventSlug, isFighterSlug, isTba, mainEventId, methodDetailText, methodLabel,
  methodRoundText, reachText, recordText, resultBoxText, resultLine, segmentTitle, stanceText, dateWithYear,
  localTime, segmentStartText,
} from "@/lib/ufcDisplay";
import type { UfcBoutSummary, UfcResult } from "@/lib/ufcTypes";
import { EMPTY_EVENT, FINISHED_EVENT, NEXT_DAY_EVENT, UPCOMING_EVENT } from "@/components/ufc/fixtures.testutil";

describe("ufcDisplay", () => {
  it("makes initials", () => {
    expect(fighterInitials("Israel Adesanya")).toBe("IA");
    expect(fighterInitials("Jiří Procházka")).toBe("JP");
    expect(fighterInitials("Mateusz Rębecki")).toBe("MR");
    expect(fighterInitials("Shara")).toBe("SH");
    expect(fighterInitials("TBA")).toBe("?");
    expect(fighterInitials("")).toBe("?");
    expect(fighterInitials("  ")).toBe("?");
    expect(fighterInitials("X")).toBe("X");
    expect(isTba({ name: "TBA" })).toBe(true);
    expect(isTba({ name: "Israel Adesanya" })).toBe(false);
  });
  it("treats every placeholder spelling as TBA", () => {
    expect(isTba({ name: "Opponent TBA" })).toBe(true);
    expect(isTba({ name: "  opponent   tba " })).toBe(true);
    expect(isTba({ name: "Tba" })).toBe(true);
    expect(isTba({ name: "Tbaker Smith" })).toBe(false);
    expect(isTba({ name: "Opponent Tbasco" })).toBe(false);
    expect(fighterInitials("Opponent TBA")).toBe("?");
  });
  it("ignores name suffixes when choosing the last initial", () => {
    expect(fighterInitials("Michael Johnson Jr.")).toBe("MJ");
    expect(fighterInitials("Tony Ferguson Jr")).toBe("TF");
    expect(fighterInitials("Pat Barry Sr.")).toBe("PB");
    expect(fighterInitials("Ray Allen III")).toBe("RA");
    expect(fighterInitials("Ray Allen II")).toBe("RA");
    expect(fighterInitials("Ray Allen IV")).toBe("RA");
    expect(fighterInitials("Jon Jr")).toBe("JO");
  });
  it("prints records", () => {
    expect(recordText({ wins: 24, losses: 6, draws: 0, no_contests: 0 })).toBe("24-6-0");
    expect(recordText({ wins: 9, losses: 2, draws: 1, no_contests: 1 })).toBe("9-2-1, 1 NC");
    expect(recordText(null)).toBeNull();
  });
  it("labels methods", () => {
    expect(methodLabel("ko_tko")).toBe("KO/TKO");
    expect(methodLabel("dq")).toBe("Disqualification");
    expect(methodLabel("no_contest")).toBe("No contest");
    expect(methodLabel(null)).toBeNull();
    expect(methodLabel("mystery" as never)).toBeNull();
  });
  it("shows a method detail as the feed gives it", () => {
    expect(methodDetailText("Rear Naked Choke")).toBe("Rear Naked Choke");
    expect(methodDetailText("D'Arce Choke")).toBe("D'Arce Choke");
    expect(methodDetailText("Punches")).toBe("Punches");
    expect(methodDetailText("REAR NAKED CHOKE")).toBe("rear naked choke");
    expect(methodDetailText("  ")).toBeNull();
    expect(methodDetailText("Decision - Unanimous")).toBe("Unanimous");
    expect(methodDetailText("Decision")).toBeNull();
    expect(methodDetailText(null)).toBeNull();
  });
  it.each([
    [{ winner: "b", method: "ko_tko", method_detail: "Punch", end_round: 2, end_clock: "4:58" }, "KO R2"],
    [{ winner: "a", method: "submission", method_detail: null, end_round: 1, end_clock: "3:01" }, "SUB R1"],
    [{ winner: "b", method: "decision", method_detail: "Decision - Unanimous", end_round: 3, end_clock: "5:00" }, "DEC"],
    [{ winner: null, method: "draw", method_detail: "Majority", end_round: 3, end_clock: "5:00" }, "DRAW"],
    [{ winner: null, method: "no_contest", method_detail: null, end_round: 1, end_clock: "2:10" }, "NC"],
    [{ winner: "a", method: "ko_tko", method_detail: null, end_round: null, end_clock: null }, "KO"],
    [{ winner: "a", method: "dq", method_detail: null, end_round: 2, end_clock: null }, "DQ R2"],
    [{ winner: "a", method: "dq", method_detail: null, end_round: null, end_clock: null }, "DQ"],
    [{ winner: "a", method: "other", method_detail: null, end_round: 4, end_clock: null }, "R4"],
    [{ winner: "a", method: null, method_detail: null, end_round: null, end_clock: null }, "–"],
  ] as const)("boxes %o as %s", (r, text) => expect(resultBoxText(r)).toBe(text));
  it("writes result lines", () => {
    const [ko, dec, draw, nc] = FINISHED_EVENT.segments[0].bouts;
    expect(resultLine(ko)).toBe("Navajo Stirling won by KO/TKO (Punch), round 2, 4:58");
    expect(resultLine(dec)).toBe("Kevin Vallejos won by decision (Unanimous)");
    expect(resultLine(draw)).toBe("Draw (Majority), round 3, 5:00");
    expect(resultLine(nc)).toBe("No contest (Accidental eye poke), round 1, 2:10");
    expect(resultLine(UPCOMING_EVENT.segments[0].bouts[0])).toBeNull();
  });
  it("writes result lines for the other methods and gaps", () => {
    const base = FINISHED_EVENT.segments[0].bouts[0];
    const line = (result: Partial<UfcResult> | null, status: UfcBoutSummary["status"] = "finished") =>
      resultLine({
        ...base, status,
        result: result && { winner: "a", method: null, method_detail: null, end_round: null, end_clock: null, ...result },
      });
    expect(line({ method: "submission", method_detail: "Rear Naked Choke", end_round: 1, end_clock: "3:01" }))
      .toBe("Jiří Procházka won by submission (Rear Naked Choke), round 1, 3:01");
    expect(line({ method: "ko_tko", end_round: 2 })).toBe("Jiří Procházka won by KO/TKO, round 2");
    expect(line({ method: "dq", end_round: 1, end_clock: "0:30" })).toBe("Jiří Procházka won by disqualification, round 1, 0:30");
    expect(line({ method: "other" })).toBe("Jiří Procházka won");
    expect(line({ method: null, winner: "b" })).toBe("Navajo Stirling won");
    expect(line({ method: "draw", winner: null })).toBe("Draw");
    expect(line({ method: "other", winner: null })).toBe("Result to be confirmed");
    expect(line(null)).toBe("Result to be confirmed");
    expect(line({ method: "ko_tko" }, "live")).toBeNull();
    expect(line({ method: "ko_tko" }, "cancelled")).toBeNull();
  });
  it("formats the tape", () => {
    expect(heightText(76)).toBe("6′ 4″"); expect(heightText(75)).toBe("6′ 3″"); expect(heightText(null)).toBeNull();
    expect(heightText(75.6)).toBe("6′ 4″"); expect(heightText(Number.NaN)).toBeNull();
    expect(heightText(0)).toBeNull(); expect(heightText(-3)).toBeNull();
    expect(reachText(0)).toBeNull(); expect(reachText(-1)).toBeNull();
    expect(reachText(80)).toBe("80″"); expect(reachText(74.5)).toBe("74.5″"); expect(reachText(null)).toBeNull();
    expect(controlTimeText(18)).toBe("0:18"); expect(controlTimeText(312)).toBe("5:12"); expect(controlTimeText(null)).toBe("–");
    expect(controlTimeText(Number.NaN)).toBe("–");
  });
  it("hides a stance with no letters", () => {
    for (const v of ["--", "-", "", "  ", null]) expect(stanceText(v)).toBeNull();
    expect(stanceText(" Orthodox ")).toBe("Orthodox");
    expect(stanceText("Switch")).toBe("Switch");
  });
  it("titles segments and sub-lines", () => {
    expect(segmentTitle("Main Card")).toBe("Main card"); expect(segmentTitle("Early Prelims")).toBe("Early prelims");
    expect(segmentTitle("")).toBe("");
    const main = UPCOMING_EVENT.segments[0].bouts[0];
    expect(boutSubLine(main, true)).toBe("Middleweight · main event · 5 rounds");
    expect(boutSubLine({ ...main, scheduled_rounds: 1 }, false)).toBe("Middleweight · 1 round");
    expect(boutSubLine({ ...main, is_title: true }, true)).toBe("Middleweight · title fight · 5 rounds");
    expect(boutSubLine({ ...main, weight_class: null, scheduled_rounds: null }, false)).toBe("Weight class to be confirmed");
    expect(mainEventId(UPCOMING_EVENT)).toBe(main.id);
    expect(mainEventId(EMPTY_EVENT)).toBeNull();
  });
  it("picks the main event around cancelled and unordered bouts", () => {
    const [a, b, c] = UPCOMING_EVENT.segments[0].bouts;
    const ev = { ...UPCOMING_EVENT, segments: [{ ...UPCOMING_EVENT.segments[0], bouts: [
      { ...a, status: "cancelled" as const, card_order: 1 },
      { ...b, card_order: null },
      { ...c, status: "scheduled" as const, card_order: 5 },
    ] }] };
    expect(mainEventId(ev)).toBe(c.id);
    const tie = { ...ev, segments: [{ ...ev.segments[0], bouts: [{ ...a, id: 9, card_order: 2 }, { ...b, id: 4, card_order: 2 }] }] };
    expect(mainEventId(tie)).toBe(4);
  });
  it("states the card's status in local time", () => {
    expect(eventStatusNote(UPCOMING_EVENT, "Australia/Sydney")).toBe("Main card starts Sun 6 Dec, 5:00 am. Times are in your local time.");
    expect(eventStatusNote(UPCOMING_EVENT, "UTC")).toBe("Main card starts Sat 5 Dec, 6:00 pm. Times are in your local time.");
    expect(eventStatusNote({ ...UPCOMING_EVENT, segments: [] }, "UTC")).toBe("Starts Sat 5 Dec, 3:00 pm. Times are in your local time.");
    expect(eventStatusNote(NEXT_DAY_EVENT, "Europe/London")).toBe("Main card starts Sun 13 Dec, 2:00 am. Times are in your local time.");
    expect(eventStatusNote({ ...UPCOMING_EVENT, segments: [], first_bout_utc: null }, "UTC")).toBe("Start time to be confirmed.");
    expect(eventStatusNote({ ...UPCOMING_EVENT, status: "live" }, "UTC")).toBe("Live now.");
    expect(eventStatusNote(FINISHED_EVENT, "UTC")).toBe("Finished.");
    expect(eventStatusNote({ ...UPCOMING_EVENT, status: "cancelled" }, "UTC")).toBe("This card was cancelled.");
    expect(eventStatusNote({ ...UPCOMING_EVENT, first_bout_utc: "garbage", segments: [] }, "UTC")).toBe("Start time to be confirmed.");
  });
  it("writes method and round for the fighter table", () => {
    expect(methodRoundText("ko_tko", 2)).toBe("KO/TKO · R2"); expect(methodRoundText("decision", 3)).toBe("Decision");
    expect(methodRoundText("submission", null)).toBe("Submission");
    expect(methodRoundText(null, null)).toBeNull();
  });
  it("builds links and shared copy", () => {
    expect(eventHref("a-b")).toBe("/ufc/event/a-b");
    expect(boutHref(7)).toBe("/ufc/fight/7");
    expect(fighterHref("x")).toBe("/ufc/fighter/x");
    expect(NOT_AFFILIATED).toBe("FinalWhistle is not affiliated with the UFC.");
    expect(ABOUT_NOTE).toMatch(/^Upcoming UFC cards, with results and fighter records to follow/);
    expect(ABOUT_NOTE).toMatch(/Pick the winner of each fight, and how they win\.$/);
    expect(ABOUT_NOTE).not.toMatch(/\bcoming\b/i);
    expect(ABOUT_NOTE).not.toMatch(/every UFC event/i);
  });
  it("adds the year to a date only when it is not the current year in the viewer's zone", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(dateWithYear("2026-12-05T18:00:00Z", "UTC", now)).toBe("Sat 5 Dec");
    expect(dateWithYear("2019-12-05T18:00:00Z", "UTC", now)).toBe("Thu 5 Dec 2019");
    expect(dateWithYear("2027-02-06T20:00:00Z", "UTC", now)).toBe("Sat 6 Feb 2027");
    // 31 Dec 2026 23:30 UTC is already 2027 in Sydney, and "now" is 2027 there too.
    expect(dateWithYear("2026-12-31T23:30:00Z", "Australia/Sydney", new Date("2027-01-02T00:00:00Z"))).toBe("Fri 1 Jan");
    expect(dateWithYear("2026-12-31T23:30:00Z", "UTC", new Date("2027-01-02T00:00:00Z"))).toBe("Thu 31 Dec 2026");
    expect(() => dateWithYear("garbage", "UTC", now)).toThrow();
  });
  it("has a total local time", () => {
    expect(localTime("2026-12-05T18:00:00Z", "UTC")).toBe("6:00 pm");
    expect(localTime("garbage", "UTC")).toBeNull();
    expect(localTime(null, "UTC")).toBeNull();
    expect(localTime("2026-12-05T18:00:00Z", "Not/AZone")).toBeNull();
  });
  it("shows the day of a segment only when it is not the card's day", () => {
    const prelims = "2026-12-12T23:00:00Z";
    const main = "2026-12-13T02:00:00Z";
    expect(segmentStartText(main, prelims, "Europe/London")).toBe("Sun 13 Dec, 2:00 am");
    expect(segmentStartText(prelims, prelims, "Europe/London")).toBe("11:00 pm");
    expect(segmentStartText(main, prelims, "America/New_York")).toBe("9:00 pm");
    expect(segmentStartText(main, null, "Europe/London")).toBe("2:00 am");
    expect(segmentStartText(null, prelims, "UTC")).toBeNull();
    expect(segmentStartText("garbage", prelims, "UTC")).toBeNull();
  });
  it("guards route params", () => {
    expect(isEventSlug("ufc-300-2024-04-13")).toBe(true);
    expect(isEventSlug("../etc")).toBe(false);
    expect(isEventSlug("a".repeat(221))).toBe(false);
    expect(isBoutId("12")).toBe(true);
    expect(isBoutId("1e3")).toBe(false);
    expect(isBoutId("2147483647")).toBe(true);
    expect(isBoutId("2147483648")).toBe(false);
    expect(isBoutId("1000000000")).toBe(true);
    expect(isBoutId("0")).toBe(false);
    expect(isBoutId("007")).toBe(false);
    expect(isFighterSlug("jiri-prochazka")).toBe(true);
    expect(isFighterSlug("Bad Slug!")).toBe(false);
  });
});
