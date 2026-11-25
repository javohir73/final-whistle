import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { announceTipsIdentityChanged } from "@/components/play/tipsIdentity";
import { UfcPicksProvider } from "@/components/ufc/UfcPicksProvider";
import type { UfcBoutDetail } from "@/lib/ufcTypes";
import { BoutPick } from "./BoutPick";
import {
  apiError, type Answer, BEFORE_LOCK, BOUT, CALL_B_DECISION, DEVICE, myBout, mine, mockNetwork, OTHER_OPEN_BOUT,
  ok, PENDING_PICK, submitted,
} from "./PickControl.fixtures.testutil";
import { OPPONENT_TBA_BOUT, freezeNow } from "./fixtures.testutil";

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

function renderPick(bout: UfcBoutDetail = BOUT) {
  return render(
    <UfcPicksProvider eventSlug={bout.event.slug}>
      <BoutPick bout={bout} />
    </UfcPicksProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(screen.queryByRole("status", { name: "Loading your pick…" })).toBeNull());
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("fw_device_id", DEVICE);
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Europe/London", confirmed: true }));
  freezeNow(BEFORE_LOCK);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function choose(winner: string, method: string) {
  fireEvent.click(screen.getByRole("button", { name: winner }));
  fireEvent.click(screen.getByRole("button", { name: method }));
}

describe("loading and unavailable", () => {
  it("shows a loading block while the picks load", async () => {
    mockNetwork({ mineAnswers: [ok(mine())] });
    renderPick();
    expect(screen.getByRole("status", { name: "Loading your pick…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shara Magomedov" })).toBeNull();
    await ready();
  });

  it("asks for storage when the browser blocks it", async () => {
    const net = mockNetwork({ mineAnswers: [ok(mine())] });
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPick();
    expect(await screen.findByText("Picks need your browser's storage to remember you. Allow site data to play.")).toBeInTheDocument();
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it("offers a retry when the picks fetch fails, and recovers", async () => {
    const net = mockNetwork({ mineAnswers: ["network", ok(mine())] });
    renderPick();
    expect(await screen.findByText("Picks are unavailable right now.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Pick a winner and how they win" })).toBeDisabled();
    expect(net.calls.mine).toBe(2);
  });
});

describe("open and not picked", () => {
  it("keeps the lock button disabled until a winner and a method are chosen", async () => {
    mockNetwork({ mineAnswers: [ok(mine())] });
    renderPick();
    expect(await screen.findByRole("group", { name: "Pick a winner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick a winner and how they win" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Shara Magomedov" }));
    expect(screen.getByRole("button", { name: "Shara Magomedov" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Israel Adesanya" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Pick a winner and how they win" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Decision" }));
    expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeEnabled();
    expect(screen.getByText("Winner and method 5 points, winner 2. A locked pick is final.")).toBeInTheDocument();
    expect(screen.getByText("Picks close Sat 5 Dec, 6:00 pm GMT")).toBeInTheDocument();
  });

  it("states that the pick is final before anything is chosen, and ties it to the lock button", async () => {
    mockNetwork({ mineAnswers: [ok(mine())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    const rules = screen.getByText("Winner and method 5 points, winner 2. A locked pick is final.");
    expect(screen.getByRole("button", { name: "Pick a winner and how they win" })).toHaveAttribute("aria-describedby", rules.id);
  });

  it("lets the player change the choice before locking", async () => {
    mockNetwork({ mineAnswers: [ok(mine())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Israel Adesanya" }));
    fireEvent.click(screen.getByRole("button", { name: "KO/TKO" }));
    expect(screen.getByRole("button", { name: "Lock in Israel Adesanya by KO/TKO" })).toBeEnabled();
  });

  it("submits once, shows Locking in… while pending, and shows the model's agreement", async () => {
    let release: (v: unknown) => void = () => {};
    const net = mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: [ok(submitted({ model: CALL_B_DECISION }))] });
    const real = net.fetch.getMockImplementation()!;
    net.fetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes("submit")
        ? new Promise((r) => { release = () => r(real(url, init)); })
        : real(url, init));
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    expect(screen.getByRole("button", { name: "Locking in…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Locking in…" }));
    expect(screen.queryByText(/Locked\./)).toBeNull(); // nothing is shown as saved yet
    await act(async () => { release(null); });
    expect(net.calls.submit).toEqual([{ device_id: DEVICE, bout_id: 7, winner: "b", method: "decision" }]);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Locked. The model agrees: Shara Magomedov by decision.");
    expect(status).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull();
  });

  it("says nothing about a model when there is no call", async () => {
    mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: [ok(submitted())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Locked. Points land when the fight ends.");
    expect(screen.queryByText(/model/i)).toBeNull();
  });

  it("shows the saved pick as the player's own, read only", async () => {
    mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: [ok(submitted())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    await screen.findByRole("status");
    const mineBox = screen.getByText("Shara Magomedov").closest("div")!;
    expect(mineBox).toHaveTextContent("Picked");
    expect(mineBox).toHaveTextContent("Decision");
    expect(screen.queryByRole("button", { name: "Shara Magomedov" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decision" })).toBeNull();
  });

  it("invites a signed-out player to sign in, without blocking the pick", async () => {
    mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: [ok(submitted())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    expect(screen.queryByText(/Sign in/)).toBeNull();
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    await screen.findByRole("status");
    expect(screen.getByRole("button", { name: "Sign in to keep your picks across devices" })).toBeInTheDocument();
  });

  it("offers the next open fight, else my picks", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout(), OTHER_OPEN_BOUT]))],
      submitAnswers: [ok(submitted())],
    });
    const { unmount } = renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    const next = await screen.findByRole("link", { name: "Next: Ian Machado Garry v Shavkat Rakhmonov" });
    expect(next).toHaveAttribute("href", "/ufc/fight/8#pick");
    unmount();

    mockNetwork({ mineAnswers: [ok(mine([myBout({ pick: PENDING_PICK })]))] });
    renderPick();
    const all = await screen.findByRole("link", { name: "All picked. See my picks" });
    expect(all).toHaveAttribute("href", "/ufc/picks");
  });

  it("shows the notice for a pick voided by a changed fight, above the controls", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout()], {
        changed_picks: [{
          bout_id: 3, fighter_a: "Israel Adesanya", fighter_b: "Dricus du Plessis", pick: PENDING_PICK, replaced_by_id: 7,
        }],
      }))],
    });
    renderPick();
    expect(await screen.findByText("Your pick on Israel Adesanya v Dricus du Plessis doesn't count because the fight changed. Pick this one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shara Magomedov" })).toBeInTheDocument();
  });

  it("does not show the changed-fight notice for a pick replaced by another fight", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout()], {
        changed_picks: [{ bout_id: 3, fighter_a: "A One", fighter_b: "B Two", pick: PENDING_PICK, replaced_by_id: 99 }],
      }))],
    });
    renderPick();
    await screen.findByRole("button", { name: "Shara Magomedov" });
    expect(screen.queryByText(/doesn't count/)).toBeNull();
  });
});

describe("already picked, locked, finished", () => {
  it("shows a pick made earlier, with the model's call line when there is one", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ pick: PENDING_PICK, model: CALL_B_DECISION })]))] });
    renderPick();
    await ready();
    expect(screen.getByRole("status")).toHaveTextContent("Locked. The model agrees: Shara Magomedov by decision.");
    expect(screen.queryByRole("button", { name: /Lock in|Pick a winner/ })).toBeNull();
    expect(screen.getByText("Picked")).toBeInTheDocument();
  });

  it("says points land when the fight ends for a pick on a live fight", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ status: "live", picks_open: false, pick: PENDING_PICK, model: CALL_B_DECISION })]))] });
    renderPick();
    await ready();
    expect(screen.getByRole("status")).toHaveTextContent("Locked. Points land when the fight ends.");
  });

  it("renders nothing for a finished fight the player did not pick", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ status: "finished", picks_open: false })]))] });
    const { container } = renderPick({ ...BOUT, status: "finished" });
    await ready();
    expect(container).toBeEmptyDOMElement();
  });

  it("says a live fight is closed to a player who did not pick, and leads on to the next open fight", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ status: "live", picks_open: false }), OTHER_OPEN_BOUT]))] });
    renderPick({ ...BOUT, status: "live" });
    expect(await screen.findByText("Picks closed when this part of the card started. You didn't pick this one.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next: Ian Machado Garry v Shavkat Rakhmonov" })).toHaveAttribute("href", "/ufc/fight/8#pick");
  });

  it("leads on to the next open fight when this one closed without a pick, and offers no link when none is open", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ picks_open: false }), OTHER_OPEN_BOUT]))] });
    const { unmount } = renderPick();
    expect(await screen.findByRole("link", { name: /^Next: Ian Machado Garry/ })).toBeInTheDocument();
    unmount();
    mockNetwork({ mineAnswers: [ok(mine([myBout({ picks_open: false })]))] });
    renderPick();
    await screen.findByText(/Picks closed when/);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("closes by the player's own lock time (locks_at), not the cached page's start time", async () => {
    jest.useRealTimers();
    jest.useFakeTimers().setSystemTime(new Date("2026-12-05T17:30:00Z"));
    mockNetwork({ mineAnswers: [ok(mine([myBout({ locks_at: "2026-12-05T17:00:00Z" })]))] });
    renderPick(); // the cached page says 18:00
    expect(await screen.findByText("Picks closed when this part of the card started. You didn't pick this one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
  });

  it("states the lock time from locks_at", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ locks_at: "2026-12-05T17:00:00Z" })]))] });
    renderPick();
    expect(await screen.findByText("Picks close Sat 5 Dec, 5:00 pm GMT")).toBeInTheDocument();
  });

  it("says the fight closed without the player when it is scheduled past its lock", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ picks_open: false })]))] });
    renderPick();
    expect(await screen.findByText("Picks closed when this part of the card started. You didn't pick this one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
  });

  it.each([
    [5, "Winner and method · 5 points"],
    [2, "Winner · 2 points"],
    [0, "Missed · 0 points"],
  ])("grades a finished pick worth %i points in words", async (points, label) => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout({
        status: "finished", picks_open: false,
        pick: { ...PENDING_PICK, state: "graded", points, winner_correct: points > 0, method_correct: points === 5 },
      })]))],
    });
    renderPick({ ...BOUT, status: "finished" });
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText("Shara Magomedov").closest("div")).toHaveTextContent("Picked");
    expect(screen.getByText("Israel Adesanya").closest("div")).not.toHaveTextContent("Picked");
    // the fighter the player did not pick is not marked as wrong
    expect(screen.queryByText(/wrong|incorrect/i)).toBeNull();
  });

  it("shows a void pick on a finished fight as a chip only", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout({
        status: "finished", picks_open: false, pick: { ...PENDING_PICK, state: "void" },
      })]))],
    });
    renderPick({ ...BOUT, status: "finished" });
    expect(await screen.findByText("Void · no points")).toBeInTheDocument();
    expect(screen.queryByText(/won't be scored/)).toBeNull();
  });

  it("says a pick on a cancelled fight will not be scored", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout({ status: "cancelled", picks_open: false, pick: { ...PENDING_PICK, state: "void" } })]))],
    });
    renderPick({ ...BOUT, status: "cancelled" });
    expect(await screen.findByRole("status")).toHaveTextContent("Cancelled. This pick won't be scored.");
    expect(screen.queryByText("Void · no points")).toBeNull();
  });

  it("says a cancelled fight was cancelled when nothing was picked", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ status: "cancelled", picks_open: false })]))] });
    renderPick({ ...BOUT, status: "cancelled" });
    expect(await screen.findByText("This fight was cancelled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in|Pick a winner/ })).toBeNull();
  });
});

describe("closing", () => {
  it("closes by the clock without a reload", async () => {
    jest.useRealTimers();
    jest.useFakeTimers().setSystemTime(new Date("2026-12-05T17:59:40Z"));
    mockNetwork({ mineAnswers: [ok(mine())] });
    renderPick();
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByRole("button", { name: "Israel Adesanya" })).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(screen.getByText("Picks closed when this part of the card started. You didn't pick this one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
  });

  it("waits for both fighters when one is a placeholder", async () => {
    mockNetwork({ mineAnswers: [ok(mine([myBout({ picks_open: false })]))] });
    const bout: UfcBoutDetail = { ...BOUT, fighter_b: OPPONENT_TBA_BOUT.fighter_b };
    renderPick(bout);
    expect(screen.getByText("Picks open once both fighters are confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Opponent TBA/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pick a winner/ })).toBeNull();
    await act(async () => {});
  });
});

describe("submit failures", () => {
  async function submitWith(answer: Answer, mineAnswers: Answer[] = [ok(mine())]) {
    const net = mockNetwork({ mineAnswers, submitAnswers: [answer] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    return net;
  }

  it("shows the saved pick after a 409", async () => {
    const net = await submitWith(
      apiError(409, "pick_finalized", "You already picked this fight. A pick is final."),
      [ok(mine()), ok(mine([myBout({ pick: { ...PENDING_PICK, winner: "a", method: "submission" } })]))],
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("You already picked this fight. A pick is final.");
    await waitFor(() => expect(net.calls.mine).toBe(2));
    expect(await screen.findByText("Locked. Points land when the fight ends.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
    expect(screen.getByText("Submission")).toBeInTheDocument(); // the stored pick, not the draft
    expect(screen.getByText("Israel Adesanya").closest("div")).toHaveTextContent("Picked");
    expect(screen.getByText("Shara Magomedov").closest("div")).not.toHaveTextContent("Picked");
  });

  it("closes when the server says the fight is locked", async () => {
    const net = await submitWith(apiError(422, "fight_locked", "Picks are closed."), [ok(mine()), ok(mine([myBout({ picks_open: false })]))]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Picks for this fight have closed.");
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull();
    await waitFor(() => expect(net.calls.mine).toBe(2));
    expect(screen.queryByText(/Locked\./)).toBeNull();
  });

  it.each([
    ["opponent_tba", 422, "Picks open once both fighters are confirmed."],
    ["fight_cancelled", 422, "This fight was cancelled."],
    ["fight_changed", 422, "This fight changed, so your pick was not saved."],
  ])("drops the controls on %s and shows the server's message", async (code, status, message) => {
    await submitWith(apiError(status, code, message));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
  });

  it("keeps the server's explanation after fight_changed even though the re-fetch no longer lists the fight", async () => {
    const net = await submitWith(
      apiError(422, "fight_changed", "This fight has changed. Pick the new one on the card."),
      [ok(mine()), ok(mine([OTHER_OPEN_BOUT]))],
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This fight has changed. Pick the new one on the card.");
    await waitFor(() => expect(net.calls.mine).toBe(2));
    expect(screen.getByRole("alert")).toHaveTextContent("This fight has changed. Pick the new one on the card.");
    expect(screen.getByRole("heading", { name: "Your pick" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull();
  });

  it("says a cancelled fight was cancelled once, after the re-fetch too", async () => {
    const net = await submitWith(
      apiError(422, "fight_cancelled", "This fight was cancelled."),
      [ok(mine()), ok(mine([myBout({ status: "cancelled", picks_open: false })]))],
    );
    await waitFor(() => expect(net.calls.mine).toBe(2));
    await screen.findByRole("alert");
    expect(screen.getAllByText("This fight was cancelled.")).toHaveLength(1);
  });

  it.each([
    [408, "request_timeout"],
    [503, "http_503"],
  ])("re-fetches after an unclear %i, shows a pick that was stored, and shows nothing else as saved", async (status, code) => {
    const net = await submitWith(
      apiError(status, code, "raw server text"),
      [ok(mine()), ok(mine([myBout({ pick: PENDING_PICK })]))],
    );
    await waitFor(() => expect(net.calls.mine).toBe(2));
    expect(await screen.findByText("Locked. Points land when the fight ends.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull();
  });

  it("re-fetches after an unclear failure and keeps the choice when nothing was stored", async () => {
    const net = await submitWith(apiError(500, "http_500", "boom"), [ok(mine()), ok(mine())]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your pick. Check your connection and try again.");
    await waitFor(() => expect(net.calls.mine).toBe(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeEnabled());
    expect(screen.queryByText(/Locked\./)).toBeNull();
  });

  it("holds the choices and the commit button while the re-fetch after an unclear failure runs", async () => {
    let release: () => void = () => {};
    const net = mockNetwork({ mineAnswers: [ok(mine()), ok(mine())], submitAnswers: [apiError(503, "http_503", "boom")] });
    const real = net.fetch.getMockImplementation()!;
    net.fetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes("/picks/mine") && net.calls.mine >= 1
        ? new Promise((r) => { release = () => r(real(url, init)); })
        : real(url, init));
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shara Magomedov" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "KO/TKO" })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Shara Magomedov" })).toBeEnabled();
  });

  it.each([
    [404, "bout_not_found"],
    [403, "forbidden_origin"],
    [422, "invalid_device_id"],
    [422, "bad_pick"],
    [400, "http_400"],
  ])("shows the generic copy, not the developer text, for %i %s", async (status, code) => {
    await submitWith(apiError(status, code, "raw developer text"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your pick. Check your connection and try again.");
    expect(screen.queryByText(/raw developer text/)).toBeNull();
    expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeEnabled();
  });

  it("sends one request for a double click before the page re-renders", async () => {
    const net = mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: [ok(submitted())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    const lock = screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" });
    await act(async () => {
      fireEvent.click(lock);
      fireEvent.click(lock);
    });
    expect(net.calls.submit).toHaveLength(1);
  });

  it("disables the method choice while the pick is being saved", async () => {
    let release: () => void = () => {};
    const net = mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: [ok(submitted())] });
    const real = net.fetch.getMockImplementation()!;
    net.fetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes("submit")
        ? new Promise((r) => { release = () => r(real(url, init)); })
        : real(url, init));
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    expect(screen.getByRole("button", { name: "KO/TKO" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shara Magomedov" })).toBeDisabled();
    await act(async () => { release(); });
  });

  it("forgets what it only knew locally after a sign-in claim", async () => {
    mockNetwork({
      mineAnswers: [ok(mine()), ok(mine())],
      submitAnswers: [apiError(409, "pick_finalized", "You already picked this fight. A pick is final.")],
    });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Israel Adesanya" })).toBeNull();
    act(() => announceTipsIdentityChanged());
    expect(await screen.findByRole("button", { name: "Israel Adesanya" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the choice and the controls on a 429, and shows nothing as saved", async () => {
    await submitWith(apiError(429, "too_many_attempts", "Too many attempts. Wait a minute and try again."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Wait a minute and try again.");
    expect(screen.getByRole("button", { name: "Shara Magomedov" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeEnabled();
    expect(screen.queryByText(/Locked\./)).toBeNull();
  });

  it("keeps the choice on a network error, then saves on a second try", async () => {
    const net = mockNetwork({ mineAnswers: [ok(mine())], submitAnswers: ["network", ok(submitted())] });
    renderPick();
    await screen.findByRole("group", { name: "Pick a winner" });
    await choose("Shara Magomedov", "Decision");
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your pick. Check your connection and try again.");
    expect(screen.queryByText(/Locked\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
    expect(await screen.findByText("Locked. Points land when the fight ends.")).toBeInTheDocument();
    expect(net.calls.submit).toHaveLength(2);
  });
});

it("keeps the control inside its own section", async () => {
  mockNetwork({ mineAnswers: [ok(mine())] });
  renderPick();
  const heading = await screen.findByRole("group", { name: "Pick a winner" });
  const section = heading.closest("section")!;
  expect(section).toHaveAttribute("id", "pick");
  expect(within(section).getByRole("group", { name: "How they win" })).toBeInTheDocument();
});
