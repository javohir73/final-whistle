/** Fixtures for the pick status on the card: a "mine" payload built from a card's own bouts, and a
 *  fetch mock, so tests go through the real provider with only the network replaced. */
import { isTba } from "@/lib/ufcDisplay";
import type { UfcEventDetail, UfcModelCall, UfcMyBout, UfcMyPicksResponse, UfcPick, UfcChangedPick } from "@/lib/ufcTypes";

export const DEVICE = "7b0f6d52-3c1a-4e1f-9d3a-1a2b3c4d5e6f";

export const pick = (over: Partial<UfcPick> = {}): UfcPick => ({
  winner: "b", method: "decision", created_at: "2026-12-01T00:00:00Z", state: "pending",
  points: null, winner_correct: null, method_correct: null, ...over,
});

export const graded = (points: 5 | 2 | 0, over: Partial<UfcPick> = {}): UfcPick =>
  pick({ state: "graded", points, winner_correct: points > 0, method_correct: points === 5, ...over });

export const call = (over: Partial<UfcModelCall> = {}): UfcModelCall => ({
  model_version: "m1", winner: "b", p_a: 0.46, p_b: 0.54, method: "decision", method_probs: null, reasons: [], ...over,
});

/** What the server says for every bout of the card: open when scheduled with two named fighters. */
export function mineFor(
  event: UfcEventDetail,
  over: Record<number, Partial<UfcMyBout>> = {},
  extra: { changed?: UfcChangedPick[]; totals?: Partial<UfcMyPicksResponse["totals"]>; handle?: string | null } = {},
): UfcMyPicksResponse {
  const bouts: UfcMyBout[] = event.segments.flatMap((s) => s.bouts).map((b) => ({
    bout_id: b.id,
    status: b.status,
    fighter_a: b.fighter_a.name,
    fighter_b: b.fighter_b.name,
    locks_at: b.scheduled_utc,
    picks_open: b.status === "scheduled" && !isTba(b.fighter_a) && !isTba(b.fighter_b),
    pick: null,
    model: null,
    ...over[b.id],
  }));
  const picked = bouts.filter((b) => b.pick).map((b) => b.pick!);
  const gradedPicks = picked.filter((p) => p.state === "graded");
  return {
    event: { slug: event.slug, name: event.name, first_bout_utc: event.first_bout_utc },
    handle: extra.handle === undefined ? "SwiftStriker42" : extra.handle,
    bouts,
    changed_picks: extra.changed ?? [],
    totals: {
      picked: picked.length,
      graded: gradedPicks.length,
      points: gradedPicks.reduce((n, p) => n + (p.points ?? 0), 0),
      winner_method: gradedPicks.filter((p) => p.points === 5).length,
      ...extra.totals,
    },
    disclaimer: "d",
  };
}

export type Answer = UfcMyPicksResponse | "fail" | "pending";

/** Replaces the network: the picks read answers with `answer`; any other path fails the test. */
export function mockMine(answer: Answer): jest.Mock {
  const fn = jest.fn((url: string) => {
    if (!String(url).includes("/api/ufc/picks/mine")) return Promise.reject(new Error(`unexpected fetch ${url}`));
    if (answer === "pending") return new Promise(() => {});
    if (answer === "fail") return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => answer });
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}
