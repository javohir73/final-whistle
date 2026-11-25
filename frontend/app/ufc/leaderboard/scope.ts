import { isEventSlug } from "@/lib/ufcDisplay";

/** Which board /ufc/leaderboard shows. A card with a null slug is "the next card". */
export type UfcBoardScope = { kind: "card"; slug: string | null } | { kind: "year"; year: number };

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
 *  `event` (the API takes exactly one of the two); a bad year falls back to the current UTC
 *  year and a bad card slug to the next card, so a hand-typed value never errors. */
export function parseBoardScope(
  sp: { event?: Param; view?: Param; year?: Param },
  now: Date,
): UfcBoardScope {
  if (first(sp.view) === "year") {
    const current = Math.min(MAX_BOARD_YEAR, Math.max(MIN_BOARD_YEAR, now.getUTCFullYear()));
    return { kind: "year", year: validYear(first(sp.year)) ?? current };
  }
  const event = first(sp.event);
  return { kind: "card", slug: event !== undefined && isEventSlug(event) ? event : null };
}

/** The URL of a board: the card (or the next card when null) or one year. */
export function boardHref(scope: UfcBoardScope): string {
  if (scope.kind === "year") return `/ufc/leaderboard?view=year&year=${scope.year}`;
  return scope.slug ? `/ufc/leaderboard?event=${scope.slug}` : "/ufc/leaderboard";
}
