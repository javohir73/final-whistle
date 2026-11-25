import { act, render, screen, waitFor } from "@testing-library/react";
import { UfcPicksProvider, useUfcPicks } from "@/components/ufc/UfcPicksProvider";
import { announceTipsIdentityChanged } from "@/components/play/tipsIdentity";
import { getMyUfcPicks } from "@/lib/ufcPicks";
import { getOrCreateDeviceId } from "@/lib/session";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import type { UfcModelCall, UfcMyPicksResponse, UfcPickSubmitResponse } from "@/lib/ufcTypes";

jest.mock("@/lib/ufcPicks", () => ({ getMyUfcPicks: jest.fn() }));
jest.mock("@/lib/session", () => ({ getOrCreateDeviceId: jest.fn() }));
jest.mock("@/components/play/viewerHandle", () => ({ reportViewerHandle: jest.fn() }));

const DEVICE = "7b0f6d52-3c1a-4e1f-9d3a-1a2b3c4d5e6f";
const SLUG = "ufc-x";
const mine = getMyUfcPicks as jest.Mock;
const device = getOrCreateDeviceId as jest.Mock;

const PICK = { winner: "b", method: "decision", created_at: "2026-12-01T00:00:00Z", state: "pending", points: null,
  winner_correct: null, method_correct: null } as const;
const PAYLOAD: UfcMyPicksResponse = {
  event: { slug: SLUG, name: "UFC X", first_bout_utc: null },
  handle: "SwiftStriker42",
  bouts: [{ bout_id: 1, status: "scheduled", fighter_a: "A One", fighter_b: "B Two", locks_at: null,
    picks_open: true, pick: null, model: null }],
  changed_picks: [],
  totals: { picked: 0, graded: 0, points: 0, winner_method: 0 },
  disclaimer: "d",
};

let ctx: ReturnType<typeof useUfcPicks> = null;
function Probe() {
  ctx = useUfcPicks();
  return (
    <p data-testid="s">
      {ctx?.status}|{ctx?.data ? "data" : "nodata"}|{ctx?.myBout(1)?.pick?.method ?? "-"}|{ctx?.myBout(1)?.model ? "model" : "nomodel"}
    </p>
  );
}
const view = () => render(<UfcPicksProvider eventSlug={SLUG}><Probe /></UfcPicksProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  device.mockReturnValue(DEVICE);
  mine.mockResolvedValue(PAYLOAD);
});

it("starts loading, then serves this device's picks for the card", async () => {
  view();
  expect(screen.getByTestId("s")).toHaveTextContent("loading|nodata");
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready|data"));
  expect(mine).toHaveBeenCalledTimes(1);
  expect(mine).toHaveBeenCalledWith(DEVICE, SLUG);
});

it("renders loading with no data, and touches neither the device id nor storage, until after mount", async () => {
  const seen: { status?: string; data: boolean; deviceReads: number; storageReads: number }[] = [];
  const storage = jest.spyOn(Storage.prototype, "getItem");
  function Spy() {
    const c = useUfcPicks();
    seen.push({ status: c?.status, data: !!c?.data, deviceReads: device.mock.calls.length, storageReads: storage.mock.calls.length });
    return null;
  }
  render(<UfcPicksProvider eventSlug={SLUG}><Spy /></UfcPicksProvider>);
  // The first render is what the server (and hydration) produces: the same for every visitor.
  expect(seen[0]).toEqual({ status: "loading", data: false, deviceReads: 0, storageReads: 0 });
  expect(mine).toHaveBeenCalledWith(DEVICE, SLUG);
  await waitFor(() => expect(seen[seen.length - 1].status).toBe("ready"));
  storage.mockRestore();
});

it("says no-device when storage is blocked", async () => {
  device.mockReturnValue(null);
  view();
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("no-device"));
  expect(mine).not.toHaveBeenCalled();
});

it("exposes an error state and retries; an empty payload is ready, not an error", async () => {
  mine.mockRejectedValueOnce(new Error("network"));
  view();
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("error|nodata"));
  act(() => ctx!.retry());
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready|data"));
  expect(mine).toHaveBeenCalledTimes(2);
});

it("refetches after a sign-in claim", async () => {
  view();
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready"));
  act(() => announceTipsIdentityChanged());
  await waitFor(() => expect(mine).toHaveBeenCalledTimes(2));
});

it("applies a submitted pick without a refetch", async () => {
  view();
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready"));
  const call: UfcModelCall = { model_version: "v1", winner: "b", p_a: 0.4, p_b: 0.6, method: "decision", method_probs: null, reasons: [] };
  const res: UfcPickSubmitResponse = { ok: true, handle: "SwiftStriker42", bout_id: 1, pick: PICK, model: call, disclaimer: "d" };
  act(() => ctx!.applySubmitted(res));
  expect(screen.getByTestId("s")).toHaveTextContent("ready|data|decision|model");
  expect(mine).toHaveBeenCalledTimes(1);
  expect(reportViewerHandle).toHaveBeenCalledWith("SwiftStriker42");
});

it("reports the handle for the leaderboard", async () => {
  view();
  await waitFor(() => expect(reportViewerHandle).toHaveBeenCalledWith("SwiftStriker42"));
});

it("is null outside a provider", () => {
  render(<Probe />);
  expect(ctx).toBeNull();
});
