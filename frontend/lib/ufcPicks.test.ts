import {
  UFC_PICK_METHODS,
  UFC_PICK_RULES,
  UFC_SCORING,
  agreementLine,
  getMyUfcPicks,
  getUfcPicksSummary,
  lockInLabel,
  methodLabel,
  methodWord,
  modelLine,
  modelVerdict,
  pickLine,
  pickLockLine,
  pickOpenByClock,
  pickVerdict,
  pickedName,
  submitUfcPick,
} from "@/lib/ufcPicks";
import type { UfcBoutSummary, UfcModelCall, UfcPick } from "@/lib/ufcTypes";
import { SCHEDULED_BOUT, OPPONENT_TBA_BOUT } from "@/components/ufc/fixtures.testutil";

const BOUT: UfcBoutSummary = SCHEDULED_BOUT; // Israel Adesanya (a) v Shara Magomedov (b)
const pick = (winner: "a" | "b", method: UfcPick["method"], over: Partial<UfcPick> = {}): UfcPick => ({
  winner, method, created_at: "2026-12-01T00:00:00Z", state: "pending", points: null,
  winner_correct: null, method_correct: null, ...over,
});
const call = (over: Partial<UfcModelCall> = {}): UfcModelCall => ({
  model_version: "v1", winner: "b", p_a: 0.463, p_b: 0.537, method: "decision",
  method_probs: { ko_tko: 0.2, submission: 0.1, decision: 0.7 }, reasons: [], ...over,
});
const PICK_B_DEC = pick("b", "decision");
const PICK_B_KO = pick("b", "ko_tko");
const PICK_A_SUB = pick("a", "submission");
const CALL_B_DEC = call();

it("exposes the methods and the scoring copy verbatim", () => {
  expect(UFC_PICK_METHODS).toEqual(["ko_tko", "submission", "decision"]);
  expect(UFC_SCORING).toBe("Winner and method 5 points, winner 2.");
  expect(UFC_PICK_RULES).toBe("Winner and method 5 points, winner 2. A locked pick is final.");
  expect(UFC_PICK_METHODS.map(methodLabel)).toEqual(["KO/TKO", "Submission", "Decision"]);
  expect(UFC_PICK_METHODS.map(methodWord)).toEqual(["KO/TKO", "submission", "decision"]);
});

it("words the lock button and the pick line with full names", () => {
  expect(lockInLabel("Shara Magomedov", "decision")).toBe("Lock in Shara Magomedov by decision");
  expect(lockInLabel("Israel Adesanya", "ko_tko")).toBe("Lock in Israel Adesanya by KO/TKO");
  expect(pickLine(BOUT, { winner: "b", method: "decision" })).toBe("You: Shara Magomedov, decision");
  expect(pickLine(BOUT, { winner: "a", method: null })).toBe("You: Israel Adesanya");
  expect(pickedName(BOUT, "a")).toBe("Israel Adesanya");
  expect(pickedName({ fighter_a: "Max Holloway", fighter_b: "Jalin Turner" }, "b")).toBe("Jalin Turner");
});

it("says how the model's call compares", () => {
  expect(agreementLine(BOUT, PICK_B_DEC, CALL_B_DEC)).toBe("The model agrees: Shara Magomedov by decision.");
  expect(agreementLine(BOUT, PICK_B_KO, CALL_B_DEC)).toBe("The model also picks Shara Magomedov, by decision.");
  expect(agreementLine(BOUT, PICK_B_KO, call({ method: null }))).toBe("The model also picks Shara Magomedov.");
  expect(agreementLine(BOUT, PICK_A_SUB, CALL_B_DEC)).toBe("The model picks Shara Magomedov by decision.");
  expect(agreementLine(BOUT, PICK_A_SUB, call({ method: null }))).toBe("The model picks Shara Magomedov.");
  expect(agreementLine(BOUT, PICK_A_SUB, null)).toBeNull();
  expect(agreementLine(BOUT, PICK_A_SUB, { ...CALL_B_DEC, winner: null })).toBeNull();
});

it("prints the model line", () => {
  expect(modelLine(BOUT, call({ p_a: 0.463, p_b: 0.537 }))).toBe("Model: Shara Magomedov 54%");
  expect(modelLine(BOUT, call({ winner: "a", p_a: 0.6, p_b: 0.4 }))).toBe("Model: Israel Adesanya 60%");
  expect(modelLine(BOUT, call({ winner: null, p_a: 0.5, p_b: 0.5 }))).toBe("Model: too close to call");
});

it("prints the lock line in the viewer's zone", () => {
  expect(pickLockLine("2026-12-05T18:00:00Z", "Europe/London", new Date("2026-12-05T09:00:00Z"))).toBe(
    "Picks close at 6:00 pm GMT",
  );
  expect(pickLockLine("2026-12-05T18:00:00Z", "Australia/Sydney", new Date("2026-12-04T09:00:00Z"))).toBe(
    "Picks close Sun 6 Dec, 5:00 am GMT+11",
  );
});

it("is open by the clock only before the start and with two named fighters", () => {
  const at = "2026-12-05T18:00:00Z";
  const b = (over: Partial<UfcBoutSummary>): UfcBoutSummary => ({ ...BOUT, scheduled_utc: at, ...over });
  expect(pickOpenByClock(b({}), new Date("2026-12-05T17:59:59Z"))).toBe(true);
  expect(pickOpenByClock(b({}), new Date(at))).toBe(false);
  expect(pickOpenByClock(b({ scheduled_utc: null }), new Date("2026-12-01T00:00:00Z"))).toBe(false);
  expect(pickOpenByClock(b({ status: "cancelled" }), new Date("2026-12-01T00:00:00Z"))).toBe(false);
  expect(pickOpenByClock(b({ status: "live" }), new Date("2026-12-01T00:00:00Z"))).toBe(false);
  expect(
    pickOpenByClock({ ...OPPONENT_TBA_BOUT, scheduled_utc: at }, new Date("2026-12-01T00:00:00Z")),
  ).toBe(false);
});

it("labels verdicts", () => {
  expect(pickVerdict(pick("b", "decision", { state: "graded", points: 5 }))).toEqual({
    label: "Winner and method · 5 points", tone: "good",
  });
  expect(pickVerdict(pick("b", "decision", { state: "graded", points: 2 }))).toEqual({
    label: "Winner · 2 points", tone: "ok",
  });
  expect(pickVerdict(pick("b", "decision", { state: "graded", points: 0 }))).toEqual({
    label: "Missed · 0 points", tone: "miss",
  });
  expect(pickVerdict(pick("b", "decision", { state: "void" }))).toEqual({ label: "Void · no points", tone: undefined });
  expect(pickVerdict(pick("b", "decision"))).toBeNull();
});

describe("scores the model's call like a pick", () => {
  const finished = (winner: "a" | "b" | null, method: string | null, status: UfcBoutSummary["status"] = "finished") =>
    ({
      ...BOUT,
      status,
      result: { winner, method, method_detail: null, end_round: null, end_clock: null },
    }) as unknown as UfcBoutSummary;
  it("gives 5, 2, 0", () => {
    expect(modelVerdict(finished("b", "decision"), CALL_B_DEC)?.label).toBe("Winner and method · 5 points");
    expect(modelVerdict(finished("b", "ko_tko"), CALL_B_DEC)?.label).toBe("Winner · 2 points");
    expect(modelVerdict(finished("a", "decision"), CALL_B_DEC)).toEqual({ label: "Missed · 0 points", tone: "miss" });
  });
  it("gives winner only when the method cannot be checked, and 2 with no model method", () => {
    expect(modelVerdict(finished("b", "dq"), CALL_B_DEC)?.label).toBe("Winner · 2 points");
    expect(modelVerdict(finished("b", "other"), CALL_B_DEC)?.label).toBe("Winner · 2 points");
    expect(modelVerdict(finished("b", "decision"), call({ method: null }))?.label).toBe("Winner · 2 points");
  });
  it("voids draws, no contests and cancelled fights; null before the result or with no pick", () => {
    expect(modelVerdict(finished(null, "draw"), CALL_B_DEC)).toEqual({ label: "Void · no points", tone: undefined });
    expect(modelVerdict(finished(null, "no_contest"), CALL_B_DEC)?.label).toBe("Void · no points");
    expect(modelVerdict(finished(null, null, "cancelled"), CALL_B_DEC)?.label).toBe("Void · no points");
    expect(modelVerdict(BOUT, CALL_B_DEC)).toBeNull();
    expect(modelVerdict(finished("b", "decision"), call({ winner: null }))).toBeNull();
  });
});

describe("requests", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const mock = (body: unknown) => {
    const fn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  };
  const DEVICE = "7b0f6d52-3c1a-4e1f-9d3a-1a2b3c4d5e6f";

  it("posts the pick and reads mine with the device id", async () => {
    const f = mock({ ok: true });
    await submitUfcPick({ device_id: DEVICE, bout_id: 7, winner: "b", method: "decision" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/ufc\/picks\/submit$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ device_id: DEVICE, bout_id: 7, winner: "b", method: "decision" });
    expect(init.credentials).toBe("include");

    const g = mock({ bouts: [] });
    await getMyUfcPicks(DEVICE, "ufc-x");
    const u = String(g.mock.calls[0][0]);
    expect(u).toMatch(/\/api\/ufc\/picks\/mine\?/);
    expect(new URL(u, "http://x").searchParams.get("device_id")).toBe(DEVICE);
    expect(new URL(u, "http://x").searchParams.get("event")).toBe("ufc-x");
    expect(u.split("?")[0]).not.toContain(DEVICE);

    const h = mock({ cards: [] });
    await getUfcPicksSummary(DEVICE);
    expect(String(h.mock.calls[0][0])).toMatch(/\/api\/ufc\/picks\/summary\?device_id=/);
  });
});
