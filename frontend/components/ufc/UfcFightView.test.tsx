import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UfcFightView } from "./UfcFightView";
import { BEFORE_LOCK, BOUT, CALL_B_DECISION, DEVICE, mine, mockNetwork, myBout, ok, submitted } from "./PickControl.fixtures.testutil";
import { DECISION_BOUT, freezeNow, KO_BOUT, SCHEDULED_BOUT } from "./fixtures.testutil";

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("fw_device_id", DEVICE);
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Europe/London", confirmed: true }));
  freezeNow(BEFORE_LOCK);
  mockNetwork({ mineAnswers: [ok(mine([myBout({ bout_id: SCHEDULED_BOUT.id })]))] });
});
afterEach(() => jest.useRealTimers());
/** Lets the picks fetch land inside act, so no update happens after the test. */
const settle = () => act(async () => {});

it("shows a scheduled fight with the tape only", async () => {
  render(<UfcFightView bout={SCHEDULED_BOUT} />);
  expect(screen.getByRole("link", { name: /UFC Fight Night: Adesanya vs Magomedov/ })).toHaveAttribute(
    "href",
    "/ufc/event/ufc-fight-night-adesanya-vs-magomedov-2026-12-05",
  );
  expect(screen.getByText("Tale of the tape")).toBeInTheDocument();
  expect(screen.queryByText("Fight stats")).toBeNull();
  expect(screen.queryByText("Judges' scorecards")).toBeNull();
  await settle();
});

it("shows stats for a finished fight and judges only when set", async () => {
  const { rerender } = render(<UfcFightView bout={KO_BOUT} />);
  expect(screen.getByText("Fight stats")).toBeInTheDocument();
  expect(screen.queryByText("Judges' scorecards")).toBeNull();
  rerender(<UfcFightView bout={DECISION_BOUT} />);
  expect(screen.getByText("Judges' scorecards")).toBeInTheDocument();
  await settle();
});

it("puts the back link in a nav with space before the hero", async () => {
  render(<UfcFightView bout={SCHEDULED_BOUT} />);
  const link = screen.getByRole("link", { name: /UFC Fight Night/ });
  expect(link.closest("nav")).toHaveClass("pb-5");
  await settle();
});

it("shows no model card and no gap without a call", async () => {
  render(<UfcFightView bout={BOUT} />);
  await screen.findByRole("button", { name: "Pick a winner and how they win" }).catch(() => null);
  expect(screen.queryByRole("region", { name: "The model's call" })).toBeNull();
  expect(document.getElementById("model-call")).toBeNull();
  expect(screen.queryByText(/model/i)).toBeNull();
});

it("reveals the model card once the viewer locks a pick", async () => {
  mockNetwork({
    mineAnswers: [ok(mine())],
    submitAnswers: [ok(submitted({ model: CALL_B_DECISION }))],
  });
  render(<UfcFightView bout={BOUT} />);
  await screen.findByRole("group", { name: "Pick a winner" });
  expect(screen.queryByRole("region", { name: "The model's call" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Shara Magomedov" }));
  fireEvent.click(screen.getByRole("button", { name: "Decision" }));
  fireEvent.click(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" }));
  const card = await screen.findByRole("region", { name: "The model's call" });
  expect(card).toHaveTextContent("54%");
  expect(card.compareDocumentPosition(screen.getByText("Tale of the tape")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("shows the public call on a locked fight to a viewer who did not pick", async () => {
  mockNetwork({ mineAnswers: [ok(mine([myBout({ status: "live", picks_open: false })]))] });
  render(<UfcFightView bout={{ ...BOUT, status: "live", model: CALL_B_DECISION }} />);
  expect(screen.getByRole("region", { name: "The model's call" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Lock in/ })).toBeNull());
});
