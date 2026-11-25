import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("renders nothing for a live or finished fight the player did not pick", async () => {
    for (const status of ["live", "finished"] as const) {
      mockNetwork({ mineAnswers: [ok(mine([myBout({ status, picks_open: false })]))] });
      const { container, unmount } = renderPick({ ...BOUT, status });
      await waitFor(() => expect(screen.queryByRole("status", { name: "Loading your pick…" })).toBeNull());
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
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
    // the fighter the player did not pick is not marked as wrong
    expect(screen.queryByText(/wrong|incorrect/i)).toBeNull();
  });

  it("says a void pick on a finished fight is not scored", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout({
        status: "finished", picks_open: false, pick: { ...PENDING_PICK, state: "void" },
      })]))],
    });
    renderPick({ ...BOUT, status: "finished" });
    expect(await screen.findByRole("status")).toHaveTextContent("Void. This pick won't be scored.");
  });

  it("says a pick on a cancelled fight will not be scored", async () => {
    mockNetwork({
      mineAnswers: [ok(mine([myBout({ status: "cancelled", picks_open: false, pick: { ...PENDING_PICK, state: "void" } })]))],
    });
    renderPick({ ...BOUT, status: "cancelled" });
    expect(await screen.findByRole("status")).toHaveTextContent("Cancelled. This pick won't be scored.");
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
