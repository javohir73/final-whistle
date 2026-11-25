/** Pure display helpers for the public UFC pages. All copy about fighters and
 *  results lives here so every page says the same thing. Every helper is
 *  total: unknown or null input gives a fallback, never "undefined" or "NaN". */
import { kickoffTimeLower } from "@/components/match/matchPageData";
import { dayKey, kickoffDate } from "@/lib/datetime";
import type {
  UfcBoutSummary,
  UfcEventDetail,
  UfcMethod,
  UfcRecord,
  UfcResult,
} from "@/lib/ufcTypes";

export const TBA = "TBA";
const DASH = "–";

export const eventHref = (slug: string) => `/ufc/event/${slug}`;
export const boutHref = (id: number) => `/ufc/fight/${id}`;
export const fighterHref = (slug: string) => `/ufc/fighter/${slug}`;

const EVENT_SLUG = /^[a-z0-9-]{1,220}$/;
const FIGHTER_SLUG = /^[a-z0-9-]{1,140}$/;
const BOUT_ID = /^[1-9]\d{0,9}$/;
const INT32_MAX = 2147483647; // the API serves 0 < id <= INT32_MAX
export const isEventSlug = (s: string): boolean => EVENT_SLUG.test(s);
export const isFighterSlug = (s: string): boolean => FIGHTER_SLUG.test(s);
export const isBoutId = (s: string): boolean => BOUT_ID.test(s) && Number(s) <= INT32_MAX;

export const ABOUT_NOTE =
  "Upcoming UFC cards, with results and fighter records to follow, and times in your local time. Predictions and a picks game are coming to these pages.";
export const NOT_AFFILIATED = "FinalWhistle is not affiliated with the UFC.";

const num = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** "TBA" and "Opponent TBA" are placeholders for a fighter not yet named, not people. */
const PLACEHOLDER = /^(opponent\s+)?tba$/i;
export function isTba(f: { name: string }): boolean {
  return PLACEHOLDER.test((f.name ?? "").trim());
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/** First letter of the first and last word; one word gives its first two letters. */
export function fighterInitials(name: string): string {
  const all = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (all.length === 0 || isTba({ name })) return "?";
  const named = all.filter((w, i) => i === 0 || !NAME_SUFFIX.test(w));
  const words = named.length > 0 ? named : all;
  const letters = (w: string) => Array.from(w);
  const out =
    words.length === 1
      ? letters(words[0]).slice(0, 2).join("")
      : letters(words[0])[0] + letters(words[words.length - 1])[0];
  return out.toUpperCase();
}

export function recordText(r: UfcRecord | null): string | null {
  if (!r) return null;
  const base = `${r.wins}-${r.losses}-${r.draws}`;
  return r.no_contests > 0 ? `${base}, ${r.no_contests} NC` : base;
}

const METHOD_LABELS: Record<UfcMethod, string> = {
  ko_tko: "KO/TKO",
  submission: "Submission",
  decision: "Decision",
  dq: "Disqualification",
  draw: "Draw",
  no_contest: "No contest",
  other: "Other",
};

export function methodLabel(m: UfcMethod | null): string | null {
  return (m && METHOD_LABELS[m]) || null;
}

/** The feed's detail as given: "Decision - Unanimous" -> "Unanimous"; bare "Decision" -> null.
 *  Only an all-capitals detail is lower-cased ("REAR NAKED CHOKE" -> "rear naked choke"). */
export function methodDetailText(detail: string | null): string | null {
  if (!detail) return null;
  const t = detail.trim().replace(/^decision\b\s*(?:-\s*)?/i, "").trim();
  if (!t) return null;
  return /\p{L}/u.test(t) && t === t.toUpperCase() ? t.toLowerCase() : t;
}

export function resultBoxText(r: UfcResult): string {
  const round = num(r.end_round) ? `R${r.end_round}` : null;
  const withRound = (word: string) => (round ? `${word} ${round}` : word);
  switch (r.method) {
    case "ko_tko": return withRound("KO");
    case "submission": return withRound("SUB");
    case "dq": return withRound("DQ");
    case "decision": return "DEC";
    case "draw": return "DRAW";
    case "no_contest": return "NC";
    default: return round ?? DASH;
  }
}

export function resultLine(
  b: Pick<UfcBoutSummary, "status" | "result" | "fighter_a" | "fighter_b">,
): string | null {
  if (b.status !== "finished") return null;
  const r = b.result;
  const TBC = "Result to be confirmed";
  if (!r) return TBC;
  const d = methodDetailText(r.method_detail);
  const detail = d ? ` (${d})` : "";
  const rc = num(r.end_round) ? `, round ${r.end_round}${r.end_clock ? `, ${r.end_clock}` : ""}` : "";
  if (r.method === "draw") return `Draw${detail}${rc}`;
  if (r.method === "no_contest") return `No contest${detail}${rc}`;
  const winner = r.winner === "a" ? b.fighter_a : r.winner === "b" ? b.fighter_b : null;
  if (!winner) return TBC;
  const W = winner.name;
  switch (r.method) {
    case "ko_tko": return `${W} won by KO/TKO${detail}${rc}`;
    case "submission": return `${W} won by submission${detail}${rc}`;
    case "decision": return `${W} won by decision${detail}`;
    case "dq": return `${W} won by disqualification${rc}`;
    default: return `${W} won${rc}`;
  }
}

export function methodRoundText(method: UfcMethod | null, endRound: number | null): string | null {
  const label = methodLabel(method);
  if (!label) return null;
  return method === "decision" || !num(endRound) ? label : `${label} · R${endRound}`;
}

/** "Main Card" -> "Main card". */
export function segmentTitle(label: string): string {
  const t = (label ?? "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function heightText(inches: number | null): string | null {
  if (!num(inches) || inches <= 0) return null;
  const total = Math.round(inches);
  return `${Math.floor(total / 12)}′ ${total % 12}″`;
}

export function reachText(inches: number | null): string | null {
  return num(inches) && inches > 0 ? `${inches}″` : null;
}

/** The stance as written, or null when it has no letter ("--", "-", ""). */
export function stanceText(stance: string | null): string | null {
  const t = (stance ?? "").trim();
  return /\p{L}/u.test(t) ? t : null;
}

export function controlTimeText(seconds: number | null): string {
  if (!num(seconds) || seconds < 0) return DASH;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Id of the headline bout: lowest card_order among bouts not cancelled, nulls last, ties on lowest id. */
export function mainEventId(event: UfcEventDetail): number | null {
  let best: UfcBoutSummary | null = null;
  for (const seg of event.segments ?? []) {
    for (const b of seg.bouts ?? []) {
      if (b.status === "cancelled") continue;
      if (!best) { best = b; continue; }
      const cur = num(best.card_order) ? best.card_order : Infinity;
      const next = num(b.card_order) ? b.card_order : Infinity;
      if (next < cur || (next === cur && b.id < best.id)) best = b;
    }
  }
  return best ? best.id : null;
}

export function boutSubLine(b: UfcBoutSummary, isMainEvent: boolean): string {
  return [
    b.weight_class || "Weight class to be confirmed",
    b.is_title ? "title fight" : isMainEvent ? "main event" : null,
    b.scheduled_rounds ? `${b.scheduled_rounds} ${b.scheduled_rounds === 1 ? "round" : "rounds"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Local clock time ("5:00 am"), or null for a missing or malformed time. */
export function localTime(iso: string | null, tz: string): string | null {
  if (!iso) return null;
  try {
    return kickoffTimeLower(iso, tz);
  } catch {
    return null;
  }
}

/** "Sat 5 Dec", with the year ("Sat 5 Dec 2019") when it is not the current
 *  year in the viewer's zone. Throws on a malformed date, like `kickoffDate`. */
export function dateWithYear(iso: string, tz: string, now: Date = new Date()): string {
  const date = kickoffDate(iso, tz);
  const year = dayKey(iso, tz).slice(0, 4);
  return year === dayKey(now.toISOString(), tz).slice(0, 4) ? date : `${date} ${year}`;
}

/** A segment's start: the time alone, or "Sun 13 Dec, 2:00 am" when its local
 *  day is not the card's local day (given by the card's first bout). */
export function segmentStartText(iso: string | null, cardStartIso: string | null, tz: string): string | null {
  const time = localTime(iso, tz);
  if (!time || !iso) return null;
  try {
    if (cardStartIso && dayKey(iso, tz) !== dayKey(cardStartIso, tz)) return `${kickoffDate(iso, tz)}, ${time}`;
  } catch {
    /* a malformed card start: the time alone is still true */
  }
  return time;
}

export function eventStatusNote(e: UfcEventDetail, tz: string): string {
  switch (e.status) {
    case "live": return "Live now.";
    case "finished": return "Finished.";
    case "cancelled": return "This card was cancelled.";
    default: {
      const main = (e.segments ?? []).find((s) => s.key === "main");
      const withDay = (iso: string | null): string | null => {
        const time = localTime(iso, tz);
        return time && iso ? `${kickoffDate(iso, tz)}, ${time}` : null;
      };
      const mainStart = withDay(main?.scheduled_utc ?? null);
      if (mainStart) return `Main card starts ${mainStart}. Times are in your local time.`;
      const first = withDay(e.first_bout_utc);
      if (first) return `Starts ${first}. Times are in your local time.`;
      return "Start time to be confirmed.";
    }
  }
}
