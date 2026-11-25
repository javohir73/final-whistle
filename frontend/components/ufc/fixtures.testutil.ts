/** Shared UFC payload fixtures for frontend tests, adapted from the phase 1
 *  recorded data (pipeline/sports/testdata/ufc/README.md). The values are
 *  adapted test data, not a record of real results. */
import type {
  UfcBoutDetail,
  UfcBoutSummary,
  UfcEventDetail,
  UfcEventSummary,
  UfcFighterDetail,
  UfcFighterMini,
  UfcStatLine,
  UfcTapeSide,
} from "@/lib/ufcTypes";

const fighter = (slug: string, name: string, country: string | null = null, record: UfcFighterMini["record"] = null): UfcFighterMini => ({
  slug, name, country, record,
});
const rec = (wins: number, losses: number, draws = 0, no_contests = 0) => ({ wins, losses, draws, no_contests });

const ADESANYA = fighter("israel-adesanya-4285679", "Israel Adesanya", "New Zealand", rec(24, 6));
const MAGOMEDOV = fighter("shara-magomedov-4421784", "Shara Magomedov", "Russia");
const HOLLOWAY = fighter("max-holloway-3022677", "Max Holloway", "United States", rec(26, 8));
const TBA_FIGHTER = fighter("tba-5300001", "TBA");
const OPPONENT_TBA = fighter("opponent-tba", "Opponent TBA");
const TURNER = fighter("jalin-turner-4294226", "Jalin Turner", "United States", rec(15, 8));
const GREEN = fighter("bobby-green-2970911", "Bobby Green", "United States", rec(33, 15, 0, 1));
const REBECKI = fighter("mateusz-rebecki-4689965", "Mateusz Rębecki", "Poland", rec(20, 2));
const BRENER = fighter("elves-brener-5110006", "Elves Brener", "Brazil", rec(15, 3));
const HUSSEIN = fighter("abdul-hussein-4905308", "Abdul Hussein", "Australia");
const WOLFE = fighter("maximiliano-bartholomew-wolfeschlegelsteinhausen-5236383", "Maximiliano Bartholomew Wolfeschlegelsteinhausen", "Argentina");
const PROCHAZKA = fighter("jiri-prochazka-3156612", "Jiří Procházka", "Czech Republic", rec(1, 1));
const STIRLING = fighter("navajo-stirling-5216713", "Navajo Stirling", "United States", rec(8, 2));
const STERLING = fighter("aljamain-sterling-3031559", "Aljamain Sterling", "United States", rec(24, 5));
const VALLEJOS = fighter("kevin-vallejos-5145681", "Kevin Vallejos", "Argentina", rec(18, 1));
const HOOKER = fighter("dan-hooker-3109135", "Dan Hooker", "New Zealand", rec(24, 13));
const ORTEGA = fighter("brian-ortega-2961777", "Brian Ortega", "United States", rec(16, 4, 1, 1));

function bout(id: number, a: UfcFighterMini, b: UfcFighterMini, over: Partial<UfcBoutSummary> = {}): UfcBoutSummary {
  return {
    id, card_order: null, weight_class: null, scheduled_rounds: 3, is_title: false, scheduled_utc: null,
    status: "scheduled", fighter_a: a, fighter_b: b, result: null, ...over,
  };
}

const MAIN_UPCOMING_UTC = "2026-12-05T18:00:00Z";
const PRELIMS_UTC = "2026-12-05T15:00:00Z";

const ADESANYA_BOUT = bout(401933595, ADESANYA, MAGOMEDOV, {
  card_order: 1, weight_class: "Middleweight", scheduled_rounds: 5, scheduled_utc: MAIN_UPCOMING_UTC,
});
const TBA_BOUT = bout(401933596, HOLLOWAY, TBA_FIGHTER, {
  card_order: 2, weight_class: "Lightweight", scheduled_utc: MAIN_UPCOMING_UTC,
});
const CANCELLED_BOUT = bout(401933597, TURNER, GREEN, {
  card_order: 3, weight_class: "Lightweight", status: "cancelled", scheduled_utc: MAIN_UPCOMING_UTC,
});

export const UPCOMING_EVENT: UfcEventDetail = {
  slug: "ufc-fight-night-adesanya-vs-magomedov-2026-12-05",
  name: "UFC Fight Night: Adesanya vs Magomedov",
  status: "scheduled",
  first_bout_utc: PRELIMS_UTC,
  last_bout_utc: MAIN_UPCOMING_UTC,
  venue: "Meta APEX, Las Vegas",
  bout_count: 4,
  main_event: { fighter_a: ADESANYA, fighter_b: MAGOMEDOV },
  segments: [
    { key: "main", label: "Main Card", scheduled_utc: MAIN_UPCOMING_UTC, bouts: [ADESANYA_BOUT, TBA_BOUT, CANCELLED_BOUT] },
    {
      key: "prelims1", label: "Prelims", scheduled_utc: PRELIMS_UTC,
      bouts: [
        bout(401936473, REBECKI, BRENER, { card_order: 12, weight_class: "Lightweight", scheduled_utc: PRELIMS_UTC }),
        bout(401933606, HUSSEIN, WOLFE, { card_order: 14, weight_class: "Bantamweight", scheduled_utc: PRELIMS_UTC }),
      ],
    },
  ],
};

const MAIN_FINISHED_UTC = "2026-11-21T18:00:00Z";
const finishedBout = (id: number, order: number, a: UfcFighterMini, b: UfcFighterMini, weight: string, rounds: number, result: UfcBoutSummary["result"]) =>
  bout(id, a, b, { card_order: order, weight_class: weight, scheduled_rounds: rounds, scheduled_utc: MAIN_FINISHED_UTC, status: "finished", result });

export const FINISHED_EVENT: UfcEventDetail = {
  slug: "ufc-fight-night-prochazka-vs-stirling-2026-11-21",
  name: "UFC Fight Night: Procházka vs Stirling",
  status: "finished",
  first_bout_utc: MAIN_FINISHED_UTC,
  last_bout_utc: MAIN_FINISHED_UTC,
  venue: "Etihad Arena, Abu Dhabi",
  bout_count: 4,
  main_event: { fighter_a: PROCHAZKA, fighter_b: STIRLING },
  segments: [
    {
      key: "main", label: "Main Card", scheduled_utc: MAIN_FINISHED_UTC,
      bouts: [
        finishedBout(401922277, 1, PROCHAZKA, STIRLING, "Light Heavyweight", 5,
          { winner: "b", method: "ko_tko", method_detail: "Punch", end_round: 2, end_clock: "4:58" }),
        finishedBout(401927850, 2, STERLING, VALLEJOS, "Featherweight", 3,
          { winner: "b", method: "decision", method_detail: "Decision - Unanimous", end_round: 3, end_clock: "5:00" }),
        finishedBout(401922278, 3, HOOKER, ORTEGA, "Lightweight", 3,
          { winner: null, method: "draw", method_detail: "Majority", end_round: 3, end_clock: "5:00" }),
        finishedBout(401922279, 4, GREEN, TURNER, "Lightweight", 3,
          { winner: null, method: "no_contest", method_detail: "Accidental eye poke", end_round: 1, end_clock: "2:10" }),
      ],
    },
  ],
};

export const EMPTY_EVENT: UfcEventDetail = {
  slug: "ufc-324-2027-01-16",
  name: "UFC 324",
  status: "scheduled",
  first_bout_utc: null,
  last_bout_utc: null,
  venue: null,
  bout_count: 0,
  main_event: null,
  segments: [],
};

const summaryOf = ({ segments: _segments, ...summary }: UfcEventDetail): UfcEventSummary => summary;

export const UPCOMING_LIST: UfcEventSummary[] = [
  summaryOf(UPCOMING_EVENT),
  {
    slug: "ufc-325-2026-12-19", name: "UFC 325", status: "scheduled",
    first_bout_utc: "2026-12-19T22:00:00Z", last_bout_utc: "2026-12-20T03:00:00Z", venue: "T-Mobile Arena, Las Vegas",
    bout_count: 13, main_event: { fighter_a: HOLLOWAY, fighter_b: TURNER },
  },
  {
    slug: "ufc-fight-night-2027-01-09", name: "UFC Fight Night", status: "scheduled",
    first_bout_utc: "2027-01-09T19:00:00Z", last_bout_utc: "2027-01-10T00:00:00Z", venue: null,
    bout_count: 11, main_event: { fighter_a: HUSSEIN, fighter_b: BRENER },
  },
  summaryOf(EMPTY_EVENT),
];

export const PAST_LIST: UfcEventSummary[] = [
  summaryOf(FINISHED_EVENT),
  {
    slug: "ufc-323-2026-11-14", name: "UFC 323", status: "finished",
    first_bout_utc: "2026-11-14T20:00:00Z", last_bout_utc: "2026-11-15T03:00:00Z", venue: "Madison Square Garden, New York",
    bout_count: 12, main_event: { fighter_a: STERLING, fighter_b: HOOKER },
  },
];

const statLine = (over: Partial<UfcStatLine>): UfcStatLine => ({
  knockdowns: null, sig_strikes_landed: null, sig_strikes_attempted: null, total_strikes_landed: null,
  total_strikes_attempted: null, takedowns_landed: null, takedowns_attempted: null, submission_attempts: null,
  reversals: null, control_seconds: null, ...over,
});
const tape = (over: Partial<UfcTapeSide> = {}): UfcTapeSide => ({ age: null, height_in: null, reach_in: null, stance: null, ...over });

function detailOf(b: UfcBoutSummary, ev: UfcEventDetail, segment: { key: string; label: string }, extra: Partial<UfcBoutDetail>): UfcBoutDetail {
  return {
    ...b,
    event: { slug: ev.slug, name: ev.name, first_bout_utc: ev.first_bout_utc },
    segment,
    tape: { a: tape(), b: tape() },
    stats: null,
    judges: null,
    ...extra,
  };
}

const finishedBouts = FINISHED_EVENT.segments[0].bouts;
const MAIN_SEGMENT = { key: "main", label: "Main Card" };

export const KO_BOUT: UfcBoutDetail = detailOf(finishedBouts[0], FINISHED_EVENT, MAIN_SEGMENT, {
  tape: {
    a: tape({ age: 34, height_in: 75, reach_in: 80, stance: "Orthodox" }),
    b: tape({ age: 29, height_in: 76, reach_in: 77, stance: "Southpaw" }),
  },
  stats: {
    a: statLine({
      knockdowns: 0, sig_strikes_landed: 23, sig_strikes_attempted: 40, total_strikes_landed: 26,
      total_strikes_attempted: 48, takedowns_landed: 0, takedowns_attempted: 0, submission_attempts: 0,
      reversals: 0, control_seconds: 18,
    }),
    b: statLine({
      knockdowns: 1, sig_strikes_landed: 45, sig_strikes_attempted: 90, total_strikes_landed: 51,
      total_strikes_attempted: 98, takedowns_landed: 0, takedowns_attempted: 1, submission_attempts: 0,
      reversals: 0, control_seconds: 0,
    }),
  },
  judges: null,
});

export const DECISION_BOUT: UfcBoutDetail = detailOf(finishedBouts[1], FINISHED_EVENT, MAIN_SEGMENT, {
  tape: {
    a: tape({ age: 37, height_in: 67, reach_in: 71, stance: "Orthodox" }),
    b: tape({ age: 24, height_in: 68, reach_in: 70, stance: "Orthodox" }),
  },
  stats: {
    a: statLine({
      knockdowns: 0, sig_strikes_landed: 61, sig_strikes_attempted: 120, total_strikes_landed: 80,
      total_strikes_attempted: 142, takedowns_landed: 2, takedowns_attempted: 5, submission_attempts: 0,
      reversals: 0, control_seconds: 312,
    }),
    b: statLine({
      knockdowns: 0, sig_strikes_landed: 88, sig_strikes_attempted: 150, total_strikes_landed: 95,
      total_strikes_attempted: 160, takedowns_landed: 1, takedowns_attempted: 2, submission_attempts: 1,
      reversals: 1, control_seconds: 95,
    }),
  },
  judges: { a: [27, 28, 27], b: [30, 29, 30] },
});

/** A finished decision whose method_detail is null, as real decisions arrive. */
export const DECISION_NO_DETAIL_BOUT: UfcBoutDetail = {
  ...DECISION_BOUT,
  result: { winner: "b", method: "decision", method_detail: null, end_round: 3, end_clock: "5:00" },
};

export const SCHEDULED_BOUT: UfcBoutDetail = detailOf(ADESANYA_BOUT, UPCOMING_EVENT, MAIN_SEGMENT, {
  tape: {
    a: tape({ age: 37, height_in: 76, reach_in: 80, stance: "Switch" }),
    b: tape({ age: null, height_in: 74, reach_in: null, stance: "Orthodox" }),
  },
});

export const UNKNOWN_TAPE_BOUT: UfcBoutDetail = detailOf(TBA_BOUT, UPCOMING_EVENT, MAIN_SEGMENT, {});

export const FIGHTER: UfcFighterDetail = {
  slug: PROCHAZKA.slug,
  name: PROCHAZKA.name,
  country: "Czech Republic",
  date_of_birth: "1992-10-14",
  age: 34,
  height_in: 75,
  reach_in: 80,
  stance: "Orthodox",
  record: rec(1, 1),
  bouts: [
    {
      id: 401940001, event: { slug: "ufc-fight-night-2027-02-06", name: "UFC Fight Night", date: "2027-02-06T20:00:00Z" },
      opponent: { slug: ADESANYA.slug, name: ADESANYA.name, country: ADESANYA.country }, outcome: null, method: null,
      end_round: null, end_clock: null, weight_class: "Light Heavyweight", status: "scheduled", scheduled_utc: "2027-02-06T20:00:00Z",
    },
    {
      id: KO_BOUT.id, event: { slug: FINISHED_EVENT.slug, name: FINISHED_EVENT.name, date: FINISHED_EVENT.first_bout_utc },
      opponent: { slug: STIRLING.slug, name: STIRLING.name, country: STIRLING.country }, outcome: "loss", method: "ko_tko",
      end_round: 2, end_clock: "4:58", weight_class: "Light Heavyweight", status: "finished", scheduled_utc: MAIN_FINISHED_UTC,
    },
    {
      id: 401900123, event: { slug: "ufc-310-2026-06-06", name: "UFC 310", date: "2026-06-06T20:00:00Z" },
      opponent: { slug: HOOKER.slug, name: HOOKER.name, country: HOOKER.country }, outcome: "win", method: "submission",
      end_round: 1, end_clock: "3:01", weight_class: "Light Heavyweight", status: "finished", scheduled_utc: "2026-06-06T22:00:00Z",
    },
  ],
};

export const FIGHTER_NO_HISTORY: UfcFighterDetail = {
  slug: MAGOMEDOV.slug,
  name: MAGOMEDOV.name,
  country: "Russia",
  date_of_birth: null,
  age: null,
  height_in: null,
  reach_in: null,
  stance: null,
  record: null,
  bouts: [
    {
      id: ADESANYA_BOUT.id, event: { slug: UPCOMING_EVENT.slug, name: UPCOMING_EVENT.name, date: UPCOMING_EVENT.first_bout_utc },
      opponent: { slug: ADESANYA.slug, name: ADESANYA.name, country: ADESANYA.country }, outcome: null, method: null,
      end_round: null, end_clock: null, weight_class: "Middleweight", status: "scheduled", scheduled_utc: MAIN_UPCOMING_UTC,
    },
  ],
};

export const FIGHTER_DRAW_NC: UfcFighterDetail = {
  slug: ORTEGA.slug,
  name: ORTEGA.name,
  country: "United States",
  date_of_birth: "1991-02-21",
  age: 35,
  height_in: 70,
  reach_in: 71,
  stance: "Orthodox",
  record: rec(16, 4, 1, 1),
  bouts: [
    {
      id: finishedBouts[2].id, event: { slug: FINISHED_EVENT.slug, name: FINISHED_EVENT.name, date: FINISHED_EVENT.first_bout_utc },
      opponent: { slug: HOOKER.slug, name: HOOKER.name, country: HOOKER.country }, outcome: "draw", method: "draw",
      end_round: 3, end_clock: "5:00", weight_class: "Lightweight", status: "finished", scheduled_utc: MAIN_FINISHED_UTC,
    },
    {
      id: 401890077, event: { slug: "ufc-300-2026-03-07", name: "UFC 300", date: "2026-03-07T20:00:00Z" },
      opponent: { slug: GREEN.slug, name: GREEN.name, country: GREEN.country }, outcome: "no_contest", method: "no_contest",
      end_round: 1, end_clock: "2:10", weight_class: "Lightweight", status: "finished", scheduled_utc: "2026-03-07T21:00:00Z",
    },
  ],
};

/** A fight between two placeholders, as the feed serves one before the card is filled in:
 *  height 0, reach 0 and stance "--". */
export const PLACEHOLDER_BOUT: UfcBoutDetail = detailOf(
  bout(15, TBA_FIGHTER, OPPONENT_TBA, { card_order: 9, weight_class: "Welterweight", scheduled_utc: MAIN_UPCOMING_UTC }),
  UPCOMING_EVENT,
  MAIN_SEGMENT,
  { tape: { a: tape({ height_in: 0, reach_in: 0, stance: "--" }), b: tape({ height_in: 0, reach_in: 0, stance: "--" }) } },
);

/** A scheduled bout whose opponent is the "Opponent TBA" placeholder. */
export const OPPONENT_TBA_BOUT: UfcBoutSummary = bout(402000001, HOLLOWAY, OPPONENT_TBA, {
  card_order: 5, weight_class: "Lightweight", scheduled_utc: MAIN_UPCOMING_UTC,
});

/** A card whose prelims start on Saturday 12 Dec 23:00 UTC and whose main card starts on
 *  Sunday 13 Dec 02:00 UTC: the main card falls on the next local day in London. */
const NEXT_DAY_PRELIMS_UTC = "2026-12-12T23:00:00Z";
const NEXT_DAY_MAIN_UTC = "2026-12-13T02:00:00Z";
export const NEXT_DAY_EVENT: UfcEventDetail = {
  slug: "ufc-fight-night-2026-12-12",
  name: "UFC Fight Night: Next Day",
  status: "scheduled",
  first_bout_utc: NEXT_DAY_PRELIMS_UTC,
  last_bout_utc: NEXT_DAY_MAIN_UTC,
  venue: null,
  bout_count: 2,
  main_event: { fighter_a: HOLLOWAY, fighter_b: TURNER },
  segments: [
    { key: "main", label: "Main Card", scheduled_utc: NEXT_DAY_MAIN_UTC,
      bouts: [bout(402000002, HOLLOWAY, TURNER, { card_order: 1, weight_class: "Lightweight", scheduled_utc: NEXT_DAY_MAIN_UTC })] },
    { key: "prelims1", label: "Prelims", scheduled_utc: NEXT_DAY_PRELIMS_UTC,
      bouts: [bout(402000003, HUSSEIN, BRENER, { card_order: 2, weight_class: "Bantamweight", scheduled_utc: NEXT_DAY_PRELIMS_UTC })] },
  ],
};

/** A fighter page for a placeholder (not a person). */
export const FIGHTER_PLACEHOLDER: UfcFighterDetail = {
  slug: OPPONENT_TBA.slug, name: OPPONENT_TBA.name, country: null, date_of_birth: null, age: null,
  height_in: 0, reach_in: 0, stance: "--", record: null, bouts: [],
};

/** Pins "now" (the Date constructor only; timers keep running) for tests that show a year only when it is not the current one. */
export function freezeNow(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
      "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
      "clearInterval", "setTimeout", "clearTimeout",
    ],
  });
}
