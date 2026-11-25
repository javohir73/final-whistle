/** Paging helpers for /ufc/events. Kept out of page.tsx: a Next.js page module
 *  may export only the page and route fields, or `next build` fails. */
export const EVENTS_PAGE = 20;
/** The API answers anything above this offset with a 4xx. */
export const MAX_OFFSET = 10_000;

/** A non-negative whole number up to the API's cap; anything else is 0. */
export function offsetParam(v: string | string[] | undefined): number {
  if (typeof v !== "string" || !/^\d{1,5}$/.test(v)) return 0;
  const n = Number(v);
  return n <= MAX_OFFSET ? n : 0;
}
