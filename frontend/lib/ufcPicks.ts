/** Client for the UFC picks game (backend/app/api/ufc_picks.py) and the one
 *  place its copy lives, so every screen words a pick, the model's call and a
 *  verdict the same way. Mirrors lib/nrlTips.ts: device_id-keyed, anonymous by
 *  default, and every call goes through session.ts's `request` (same-origin
 *  proxy, credentials, cold-start timeout, {error:{code,message}} -> ApiError).
 *  The device id is sent only in the body or query of the site's own API,
 *  never in a path. A fight with no model call (null) is the normal case. */
import type { ChipTone } from "@/components/ui";
import { kickoffDate, relativeDayLabel, tzAbbrev } from "@/lib/datetime";
import { kickoffTimeLower } from "@/components/match/matchPageData";
import { request } from "./session";
import { isTba } from "./ufcDisplay";
import type {
  UfcBoutSummary,
  UfcModelCall,
  UfcMyPicksResponse,
  UfcPick,
  UfcPickMethod,
  UfcPickSubmitResponse,
  UfcPicksSummaryResponse,
} from "./ufcTypes";

export const UFC_PICK_METHODS: readonly UfcPickMethod[] = ["ko_tko", "submission", "decision"];
export const UFC_SCORING = "Winner and method 5 points, winner 2.";
export const UFC_PICK_RULES = `${UFC_SCORING} A locked pick is final.`;

const LABELS: Record<UfcPickMethod, "KO/TKO" | "Submission" | "Decision"> = {
  ko_tko: "KO/TKO",
  submission: "Submission",
  decision: "Decision",
};
const WORDS: Record<UfcPickMethod, "KO/TKO" | "submission" | "decision"> = {
  ko_tko: "KO/TKO",
  submission: "submission",
  decision: "decision",
};

/** Control labels: "KO/TKO", "Submission", "Decision". */
export const methodLabel = (m: UfcPickMethod) => LABELS[m];
/** The method inside a sentence: "KO/TKO", "submission", "decision". */
export const methodWord = (m: UfcPickMethod) => WORDS[m];

export const lockInLabel = (name: string, m: UfcPickMethod): string => `Lock in ${name} by ${methodWord(m)}`;

type Named = { name: string } | string;
const nameOf = (f: Named): string => (typeof f === "string" ? f : f.name);

/** The full stored name of the fighter on a side. */
export function pickedName(bout: { fighter_a: Named; fighter_b: Named }, side: "a" | "b"): string {
  return nameOf(side === "a" ? bout.fighter_a : bout.fighter_b);
}

type BoutNames = { fighter_a: Named; fighter_b: Named };

export function pickLine(bout: BoutNames, pick: { winner: "a" | "b"; method: UfcPickMethod | null }): string {
  const name = pickedName(bout, pick.winner).trim();
  if (!name) return "";
  return pick.method ? `You: ${name}, ${methodWord(pick.method)}` : `You: ${name}`;
}

/** "" when the model's fighter has no name. "Model: Shara Magomedov 54%", or "Model: too close to call" when it names no one. */
export function modelLine(bout: BoutNames, call: UfcModelCall): string {
  if (call.winner == null) return "Model: too close to call";
  if (!pickedName(bout, call.winner).trim()) return "";
  const pct = Math.round(100 * Math.max(call.p_a, call.p_b));
  return `Model: ${pickedName(bout, call.winner)} ${pct}%`;
}

/** How the model's call compares with the player's pick; null with no call or a call that names no one. */
export function agreementLine(
  bout: BoutNames,
  pick: { winner: "a" | "b"; method: UfcPickMethod | null },
  call: UfcModelCall | null,
): string | null {
  if (!call || call.winner == null) return null;
  const name = pickedName(bout, call.winner).trim();
  if (!name) return null;
  const m = call.method ? methodWord(call.method) : null;
  if (call.winner !== pick.winner) return m ? `The model picks ${name} by ${m}.` : `The model picks ${name}.`;
  if (!m) return `The model also picks ${name}.`;
  return call.method === pick.method ? `The model agrees: ${name} by ${m}.` : `The model also picks ${name}, by ${m}.`;
}

/** Open by the viewer's clock: scheduled, a start time set and not yet reached, two named fighters.
 *  The server decides the real lock; this may close a control early, never open one. */
export function pickOpenByClock(bout: UfcBoutSummary, now: Date): boolean {
  if (bout.status !== "scheduled" || !bout.scheduled_utc) return false;
  const t = Date.parse(bout.scheduled_utc);
  if (!Number.isFinite(t) || now.getTime() >= t) return false;
  return !isTba(bout.fighter_a) && !isTba(bout.fighter_b);
}

/** "" for a missing or invalid time. "Picks close at 6:00 pm GMT" today in the viewer's zone, else "Picks close Sat 5 Dec, 6:00 pm GMT". */
export function pickLockLine(lockIso: string, tz: string, now: Date): string {
  if (!lockIso || !Number.isFinite(Date.parse(lockIso))) return "";
  try {
    const time = `${kickoffTimeLower(lockIso, tz)} ${tzAbbrev(lockIso, tz)}`;
    return relativeDayLabel(lockIso, tz, now) === "Today"
      ? `Picks close at ${time}`
      : `Picks close ${kickoffDate(lockIso, tz)}, ${time}`;
  } catch {
    return ""; // a bad time or zone: no line rather than a thrown render
  }
}

export type Verdict = { label: string; tone: ChipTone | undefined };

const VERDICTS: Record<5 | 2 | 0, Verdict> = {
  5: { label: "Winner and method · 5 points", tone: "good" },
  2: { label: "Winner · 2 points", tone: "ok" },
  0: { label: "Missed · 0 points", tone: "miss" },
};
const VOID: Verdict = { label: "Void · no points", tone: undefined };

/** The server's grade of a pick; null while pending. */
export function pickVerdict(pick: UfcPick): Verdict | null {
  if (pick.state === "void") return { ...VOID };
  if (pick.state !== "graded" || pick.points == null) return null;
  return { ...(VERDICTS[pick.points === 5 ? 5 : pick.points === 2 ? 2 : 0]) };
}

/** The model's call on a finished fight, scored as a pick is (backend ufc_rules.score_pick):
 *  5 winner and method, 2 winner only (also when the result's method is dq/other or the call has
 *  no method), 0 otherwise; draw, no contest and cancelled are void; null before a result. */
export function modelVerdict(bout: UfcBoutSummary, call: UfcModelCall): Verdict | null {
  if (bout.status === "cancelled") return { ...VOID };
  if (bout.status !== "finished" || call.winner == null || !bout.result) return null;
  const { winner, method } = bout.result;
  if (winner == null || method === "draw" || method === "no_contest") return { ...VOID };
  if (call.winner !== winner) return { ...VERDICTS[0] };
  return { ...VERDICTS[call.method != null && call.method === method ? 5 : 2] };
}

export const submitUfcPick = (body: { device_id: string; bout_id: number; winner: "a" | "b"; method: UfcPickMethod }) =>
  request<UfcPickSubmitResponse>("/api/ufc/picks/submit", { method: "POST", body: JSON.stringify(body) });

export const getMyUfcPicks = (device_id: string, event: string) =>
  request<UfcMyPicksResponse>(`/api/ufc/picks/mine?${new URLSearchParams({ device_id, event })}`);

export const getUfcPicksSummary = (device_id: string) =>
  request<UfcPicksSummaryResponse>(`/api/ufc/picks/summary?${new URLSearchParams({ device_id })}`);
