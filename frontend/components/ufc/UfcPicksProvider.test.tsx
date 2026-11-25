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
  // The real device-id helper, so a storage read before mount would be seen.
  device.mockImplementation(jest.requireActual("@/lib/session").getOrCreateDeviceId);
  const storage = jest.spyOn(Storage.prototype, "getItem");
  function Spy() {
    const c = useUfcPicks();
    seen.push({ status: c?.status, data: !!c?.data, deviceReads: device.mock.calls.length, storageReads: storage.mock.calls.length });
    return null;
  }
  render(<UfcPicksProvider eventSlug={SLUG}><Spy /></UfcPicksProvider>);
  // The first render is what the server (and hydration) produces: the same for every visitor.
  expect(seen[0]).toEqual({ status: "loading", data: false, deviceReads: 0, storageReads: 0 });
  expect(storage.mock.calls.length).toBeGreaterThan(0); // the mount effect does read it
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

const SUB = (over: Partial<UfcPickSubmitResponse> = {}): UfcPickSubmitResponse => ({
  ok: true, handle: "SwiftStriker42", bout_id: 1, pick: PICK, model: null, disclaimer: "d", ...over,
});
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const OTHER: UfcMyPicksResponse = {
  ...PAYLOAD,
  event: { slug: "ufc-y", name: "UFC Y", first_bout_utc: null },
  handle: "OtherHandle",
  totals: { picked: 3, graded: 1, points: 5, winner_method: 1 },
};
const Slug = ({ slug }: { slug: string }) => (
  <UfcPicksProvider eventSlug={slug}><Probe /><Who /></UfcPicksProvider>
);
function Who() {
  const c = useUfcPicks();
  return <p data-testid="who">{c?.data?.event.slug ?? "none"}</p>;
}

it("never shows the previous card's data after the slug changes", async () => {
  const next = deferred<UfcMyPicksResponse>();
  const { rerender } = render(<Slug slug={SLUG} />);
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready|data"));
  expect(screen.getByTestId("who")).toHaveTextContent(SLUG);
  mine.mockReturnValueOnce(next.promise);
  rerender(<Slug slug="ufc-y" />);
  expect(screen.getByTestId("s")).toHaveTextContent("loading|nodata");
  expect(screen.getByTestId("who")).toHaveTextContent("none");
  await act(async () => next.resolve(OTHER));
  expect(screen.getByTestId("who")).toHaveTextContent("ufc-y");
  expect(mine).toHaveBeenLastCalledWith(DEVICE, "ufc-y");
});

it("shows an error with no data when the new card's fetch fails", async () => {
  const { rerender } = render(<Slug slug={SLUG} />);
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready|data"));
  mine.mockRejectedValueOnce(new Error("x"));
  rerender(<Slug slug="ufc-y" />);
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("error|nodata"));
});

it("keeps the same card's data when a later refresh fails", async () => {
  view();
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready|data"));
  mine.mockRejectedValueOnce(new Error("x"));
  act(() => announceTipsIdentityChanged());
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("error|data"));
});

it("does not update state after unmount", async () => {
  const d = deferred<UfcMyPicksResponse>();
  mine.mockReturnValueOnce(d.promise);
  const err = jest.spyOn(console, "error").mockImplementation(() => {});
  const { unmount } = view();
  unmount();
  await act(async () => d.resolve(PAYLOAD));
  expect(reportViewerHandle).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});

it("ignores an older request that resolves after a newer one", async () => {
  const older = deferred<UfcMyPicksResponse>();
  const newer = deferred<UfcMyPicksResponse>();
  mine.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  view();
  act(() => announceTipsIdentityChanged());
  await act(async () => newer.resolve({ ...PAYLOAD, handle: "NewHandle" }));
  await act(async () => older.resolve({ ...PAYLOAD, handle: "OldHandle" }));
  expect(reportViewerHandle).toHaveBeenCalledWith("NewHandle");
  expect(reportViewerHandle).not.toHaveBeenCalledWith("OldHandle");
});

it("applySubmitted sets picks_open false, bumps picked once, and is a no-op without data or for an unknown bout", async () => {
  const d = deferred<UfcMyPicksResponse>();
  mine.mockReturnValueOnce(d.promise);
  view();
  act(() => ctx!.applySubmitted(SUB()));
  expect(ctx!.data).toBeNull(); // unloaded: nothing to change now
  await act(async () => d.resolve(PAYLOAD));
  expect(ctx!.data!.totals.picked).toBe(1); // remembered, and laid over the read that landed
  act(() => ctx!.applySubmitted(SUB({ bout_id: 999 })));
  expect(ctx!.data!.bouts).toHaveLength(1);
  expect(ctx!.data!.totals.picked).toBe(1); // unknown bout: no change
  act(() => ctx!.applySubmitted(SUB()));
  act(() => ctx!.applySubmitted(SUB()));
  expect(ctx!.myBout(1)!.picks_open).toBe(false);
  expect(ctx!.data!.totals.picked).toBe(1);
});

it("a read that was in flight when a pick was saved never drops that pick", async () => {
  const d = deferred<UfcMyPicksResponse>();
  view();
  await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready"));
  mine.mockReturnValueOnce(d.promise);
  act(() => announceTipsIdentityChanged());
  act(() => ctx!.applySubmitted(SUB()));
  await act(async () => d.resolve(PAYLOAD)); // read before the pick was stored: pick null, open
  expect(ctx!.myBout(1)!.pick?.method).toBe("decision");
  expect(ctx!.myBout(1)!.picks_open).toBe(false);
  expect(ctx!.data!.totals.picked).toBe(1);
});

describe("a remembered pick yields to any later answer from the server", () => {
  const unpicked = (): UfcMyPicksResponse => ({ ...PAYLOAD, totals: { picked: 0, graded: 0, points: 0, winner_method: 0 } });
  const stored = (): UfcMyPicksResponse => ({
    ...PAYLOAD,
    bouts: [{ ...PAYLOAD.bouts[0], pick: PICK, picks_open: false }],
    totals: { picked: 1, graded: 0, points: 0, winner_method: 0 },
  });
  const ready = async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready"));
  };

  it("(a) a read requested after the apply that returns the bout unpicked is shown as the server says", async () => {
    await ready();
    act(() => ctx!.applySubmitted(SUB()));
    expect(ctx!.myBout(1)!.pick).not.toBeNull();
    mine.mockResolvedValueOnce(unpicked());
    act(() => ctx!.retry());
    await waitFor(() => expect(ctx!.myBout(1)!.pick).toBeNull());
    expect(ctx!.myBout(1)!.picks_open).toBe(true);
    expect(ctx!.data!.totals.picked).toBe(0);
    mine.mockResolvedValueOnce(unpicked());
    act(() => ctx!.retry());
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(3));
    expect(ctx!.myBout(1)!.pick).toBeNull(); // never resurrected
  });

  it("(b) a sign-in claim refetch that returns the bout unpicked is shown unpicked", async () => {
    await ready();
    act(() => ctx!.applySubmitted(SUB()));
    mine.mockResolvedValueOnce(unpicked());
    act(() => announceTipsIdentityChanged());
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ctx!.myBout(1)!.pick).toBeNull());
  });

  it("(b2) a read already in flight when the identity changes does not bring the old pick back", async () => {
    await ready();
    const d = deferred<UfcMyPicksResponse>();
    mine.mockReturnValueOnce(d.promise);
    act(() => ctx!.retry());
    act(() => ctx!.applySubmitted(SUB()));
    mine.mockResolvedValueOnce(unpicked());
    act(() => announceTipsIdentityChanged());
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(3));
    await act(async () => d.resolve(unpicked()));
    await waitFor(() => expect(ctx!.myBout(1)!.pick).toBeNull());
  });

  it("(c) a read requested before the apply keeps the pick; the next read shows the server's pick once", async () => {
    await ready();
    const d = deferred<UfcMyPicksResponse>();
    mine.mockReturnValueOnce(d.promise);
    act(() => ctx!.retry());
    act(() => ctx!.applySubmitted(SUB()));
    await act(async () => d.resolve(unpicked()));
    expect(ctx!.myBout(1)!.pick?.method).toBe("decision");
    expect(ctx!.data!.totals.picked).toBe(1);
    mine.mockResolvedValueOnce(stored());
    act(() => ctx!.retry());
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(ctx!.myBout(1)!.picks_open).toBe(false));
    expect(ctx!.myBout(1)!.pick?.method).toBe("decision");
    expect(ctx!.data!.totals.picked).toBe(1);
  });

  it("(d) retry() after an apply is authoritative", async () => {
    mine.mockRejectedValueOnce(new Error("x"));
    view();
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("error"));
    mine.mockResolvedValueOnce(unpicked());
    act(() => ctx!.retry());
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("ready"));
    act(() => ctx!.applySubmitted(SUB()));
    mine.mockResolvedValueOnce(unpicked());
    act(() => ctx!.retry());
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(ctx!.myBout(1)!.pick).toBeNull());
  });
});
