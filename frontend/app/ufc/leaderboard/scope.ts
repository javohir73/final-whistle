import { isEventSlug } from "@/lib/ufcDisplay";

/** Which board /ufc/leaderboard shows: one card, or one UTC year (the default). */
export type UfcBoardScope = { kind: "card"; slug: string } | { kind: "year"; year: number };

type Param = string | string[] | undefined;

/** The years the API accepts; anything else would be refused, so it is never sent. */
export const MIN_BOARD_YEAR = 2020;
export const MAX_BOARD_YEAR = 2100;

const first = (v: Param): string | undefined => (Array.isArray(v) ? v[0] : v);

function validYear(raw: string | undefined): number | null {
  if (raw === undefined || !/^[0-9]{4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= MIN_BOARD_YEAR && n <= MAX_BOARD_YEAR ? n : null;
}

/** URL parameters to a scope that is always safe to ask the API for. `view=year` wins over
 *  `event` (the API takes exactly one of the two); a bad year or a bad card slug falls back
 *  to the current UTC year (also the default view), so a hand-typed value never errors. */
export function parseBoardScope(
  sp: { event?: Param; view?: Param; year?: Param },
  now: Date,
): UfcBoardScope {
  const current = Math.min(MAX_BOARD_YEAR, Math.max(MIN_BOARD_YEAR, now.getUTCFullYear()));
  if (first(sp.view) === "year") return { kind: "year", year: validYear(first(sp.year)) ?? current };
  const event = first(sp.event);
  if (event !== undefined && isEventSlug(event)) return { kind: "card", slug: event };
  return { kind: "year", year: current };
}

/** The URL of a board; a year link always names its year. */
export function boardHref(scope: UfcBoardScope): string {
  if (scope.kind === "year") return `/ufc/leaderboard?view=year&year=${scope.year}`;
  return `/ufc/leaderboard?event=${scope.slug}`;
}
