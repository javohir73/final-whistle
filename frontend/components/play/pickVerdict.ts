import type { ChipTone } from "@/components/ui";

/** Display-only verdict for a scoreline call against a final score, worded and
 *  scored the way the game scores it (exact score 5, right result 2). The
 *  server's graded `points` always win where they exist -- this is only for
 *  labelling (the model's call on a finished match, or a pick awaiting
 *  grading). */
export type Verdict = { label: "Exact score" | "Right result" | "Missed"; tone: ChipTone; points: 5 | 2 | 0 };

function outcome(h: number, a: number): number {
  return h > a ? 1 : h < a ? -1 : 0;
}

export function scoreVerdict(
  call: { home: number; away: number },
  final: { home: number; away: number },
): Verdict {
  if (call.home === final.home && call.away === final.away) return { label: "Exact score", tone: "good", points: 5 };
  if (outcome(call.home, call.away) === outcome(final.home, final.away)) {
    return { label: "Right result", tone: "ok", points: 2 };
  }
  return { label: "Missed", tone: "miss", points: 0 };
}

/** Verdict from the server's grading of a pick (points/exact), when graded. */
export function gradedVerdict(points: number | null, exact: boolean | null): Verdict | null {
  if (points == null) return null;
  if (exact) return { label: "Exact score", tone: "good", points: 5 };
  if (points > 0) return { label: "Right result", tone: "ok", points: 2 };
  return { label: "Missed", tone: "miss", points: 0 };
}

/** "2026–27": a European football season from a date (Jul–Jun). */
export function footballSeasonLabel(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, "0")}`;
}
