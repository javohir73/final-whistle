/** Fixtures and a fetch mock for the fight page's pick control tests. The tests render the real
 *  UfcPicksProvider and the real lib/ufcPicks + lib/session; only `fetch` is faked. */
import type {
  UfcBoutDetail,
  UfcModelCall,
  UfcMyBout,
  UfcMyPicksResponse,
  UfcPick,
  UfcPickSubmitResponse,
} from "@/lib/ufcTypes";
import { SCHEDULED_BOUT } from "./fixtures.testutil";

export const DEVICE = "8b1c5d2e-1f3a-4c5b-9d6e-7f8a9b0c1d2e";
export const LOCK_ISO = "2026-12-05T18:00:00Z";
/** A moment well before the lock (Tue 1 Dec 12:00 UTC). */
export const BEFORE_LOCK = "2026-12-01T12:00:00Z";

/** Israel Adesanya (a) v Shara Magomedov (b), main card, locks 2026-12-05T18:00Z. */
export const BOUT: UfcBoutDetail = { ...SCHEDULED_BOUT, id: 7, scheduled_utc: LOCK_ISO };

export const PENDING_PICK: UfcPick = {
  winner: "b", method: "decision", created_at: "2026-12-01T10:00:00Z", state: "pending",
  points: null, winner_correct: null, method_correct: null,
};

export const CALL_B_DECISION: UfcModelCall = {
  model_version: "ufc-v1", winner: "b", p_a: 0.46, p_b: 0.54, method: "decision",
  method_probs: { ko_tko: 0.2, submission: 0.1, decision: 0.7 },
  reasons: ["Shara Magomedov is ahead on FinalWhistle's own fighter rating, 1710 to 1655.", "He lands more per minute."],
};

export function myBout(over: Partial<UfcMyBout> = {}): UfcMyBout {
  return {
    bout_id: 7, status: "scheduled", fighter_a: "Israel Adesanya", fighter_b: "Shara Magomedov",
    locks_at: LOCK_ISO, picks_open: true, pick: null, model: null, ...over,
  };
}

export const OTHER_OPEN_BOUT = myBout({
  bout_id: 8, fighter_a: "Ian Machado Garry", fighter_b: "Shavkat Rakhmonov",
});

export function mine(bouts: UfcMyBout[] = [myBout()], over: Partial<UfcMyPicksResponse> = {}): UfcMyPicksResponse {
  const picked = bouts.filter((b) => b.pick).length;
  return {
    event: { slug: BOUT.event.slug, name: BOUT.event.name, first_bout_utc: LOCK_ISO },
    handle: null, bouts, changed_picks: [],
    totals: { picked, graded: 0, points: 0, winner_method: 0 },
    disclaimer: "For analytics and entertainment only. Not betting advice.",
    ...over,
  };
}

export function submitted(over: Partial<UfcPickSubmitResponse> = {}): UfcPickSubmitResponse {
  return {
    ok: true, handle: "SwiftStriker42", bout_id: 7, pick: PENDING_PICK, model: null,
    disclaimer: "For analytics and entertainment only. Not betting advice.", ...over,
  };
}

export type Answer = { status: number; body: unknown } | "network";
export const ok = (body: unknown): Answer => ({ status: 200, body });
export const apiError = (status: number, code: string, message: string): Answer => ({
  status, body: { error: { code, message } },
});

/** Replaces global fetch. `mineAnswers` and `submitAnswers` are consumed in order (the last one repeats). */
export function mockNetwork(opts: { mineAnswers: Answer[]; submitAnswers?: Answer[] }) {
  const calls = { mine: 0, submit: [] as unknown[] };
  const next = (list: Answer[], n: number) => list[Math.min(n, list.length - 1)];
  const respond = (a: Answer) => {
    if (a === "network") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({
      ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body,
    } as Response);
  };
  const fn = jest.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/ufc/picks/submit")) {
      const n = calls.submit.length;
      calls.submit.push(JSON.parse(String(init?.body)));
      return respond(next(opts.submitAnswers ?? [apiError(500, "x", "no submit expected")], n));
    }
    if (String(url).includes("/api/ufc/picks/mine")) {
      const n = calls.mine++;
      return respond(next(opts.mineAnswers, n));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return { calls, fetch: fn };
}
