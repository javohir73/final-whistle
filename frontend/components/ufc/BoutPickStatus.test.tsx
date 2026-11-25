import { render, screen, waitFor } from "@testing-library/react";
import { BoutPickStatus, hasPickSlot } from "./BoutPickStatus";
import { UfcPicksProvider } from "./UfcPicksProvider";
import { FINISHED_EVENT, UPCOMING_EVENT, freezeNow } from "./fixtures.testutil";
import { call, graded, mineFor, mockMine, pick } from "./BoutPick.fixtures.testutil";
import type { UfcBoutSummary, UfcMyBout } from "@/lib/ufcTypes";

const [main, tba, cancelled] = UPCOMING_EVENT.segments[0].bouts;
const [prelimA] = UPCOMING_EVENT.segments[1].bouts;
const [ko, decision, draw, noContest] = FINISHED_EVENT.segments[0].bouts;
const NOW = new Date("2026-12-01T00:00:00Z");

function view(bout: UfcBoutSummary, now: Date | null = NOW, event = UPCOMING_EVENT) {
  return render(
    <UfcPicksProvider eventSlug={event.slug}>
      <BoutPickStatus bout={bout} now={now} />
    </UfcPicksProvider>,
  );
}
const served = (bout: UfcBoutSummary, over: Partial<UfcMyBout>, event = UPCOMING_EVENT) =>
  mockMine(mineFor(event, { [bout.id]: over }));
const slot = () => screen.getByTestId("pick-slot");

beforeEach(() => {
  localStorage.clear();
  freezeNow("2026-12-01T00:00:00Z");
});
afterEach(() => jest.useRealTimers());

it("shows nothing, and no flash, while the picks load", () => {
  mockMine("pending");
  view(main);
  expect(slot()).toBeEmptyDOMElement();
});

it("invites a pick on an open fight, linking to the fight page", async () => {
  mockMine(mineFor(UPCOMING_EVENT));
  view(main);
  const link = await screen.findByRole("link", { name: "Pick the winner of Israel Adesanya v Shara Magomedov" });
  expect(link).toHaveTextContent("Pick winner");
  expect(link).toHaveAttribute("href", `/ufc/fight/${main.id}#pick`);
});

it("shows the viewer's pick with the full name, and the model only when there is a call", async () => {
  served(main, { pick: pick() });
  view(main);
  expect(await screen.findByText("You: Shara Magomedov, decision")).toBeInTheDocument();
  expect(screen.queryByText(/^Model:/)).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
});

it("shows the model's call beside a pick when the server sent one", async () => {
  served(main, { pick: pick(), model: call() });
  view(main);
  expect(await screen.findByText("Model: Shara Magomedov 54%")).toBeInTheDocument();
});

it("says picks are closed on a scheduled fight past its lock, whatever the server last said", async () => {
  mockMine(mineFor(UPCOMING_EVENT)); // the server still says open
  view(prelimA, new Date("2026-12-05T16:00:00Z"));
  expect(await screen.findByText("Picks closed")).toBeInTheDocument();
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps a locked pick as the pick line", async () => {
  served(prelimA, { pick: pick({ winner: "a", method: null }), picks_open: false });
  view(prelimA, new Date("2026-12-05T16:00:00Z"));
  expect(await screen.findByText("You: Mateusz Rębecki")).toBeInTheDocument();
  expect(screen.queryByText("Picks closed")).toBeNull();
});

it.each([
  [5, "Winner and method · 5 points"],
  [2, "Winner · 2 points"],
  [0, "Missed · 0 points"],
] as const)("shows the graded verdict for %s points instead of the model line", async (pts, label) => {
  const ev = FINISHED_EVENT;
  mockMine(mineFor(ev, { [ko.id]: { pick: graded(pts), model: call() } }));
  view(ko, NOW, ev);
  expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.getByText("You: Navajo Stirling, decision")).toBeInTheDocument();
  expect(screen.queryByText(/^Model:/)).toBeNull();
});

it("shows a void pick as void, with no points", async () => {
  mockMine(mineFor(FINISHED_EVENT, { [draw.id]: { pick: pick({ state: "void" }) } }));
  view(draw, NOW, FINISHED_EVENT);
  expect(await screen.findByText("Void · no points")).toBeInTheDocument();
});

it("shows the public call on a finished fight the viewer did not pick", async () => {
  mockMine(mineFor(FINISHED_EVENT));
  view({ ...decision, model: call({ winner: "a", p_a: 0.6, p_b: 0.4 }) }, NOW, FINISHED_EVENT);
  expect(await screen.findByText("Model: Aljamain Sterling 60%")).toBeInTheDocument();
});

it("shows nothing on a finished fight with no pick and no call", async () => {
  const fetchMock = mockMine(mineFor(FINISHED_EVENT));
  view(noContest, NOW, FINISHED_EVENT);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(slot()).toBeEmptyDOMElement());
});

it("has no slot for a cancelled fight or a placeholder fighter", () => {
  expect(hasPickSlot(cancelled)).toBe(false);
  expect(hasPickSlot(tba)).toBe(false);
  expect(hasPickSlot(main)).toBe(true);
  expect(hasPickSlot(ko)).toBe(true);
});

it("falls back to the read-only look when the picks cannot be read", async () => {
  const fetchMock = mockMine("fail");
  view(main);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(slot()).toBeEmptyDOMElement());
  expect(screen.queryByText(/error|wrong|fail/i)).toBeNull();
});

it("reserves more room on a finished fight, where the verdict adds a line", () => {
  mockMine("pending");
  const a = view(main);
  const open = slot().className;
  a.unmount();
  view(ko, NOW, FINISHED_EVENT);
  expect(slot().className).not.toBe(open);
  expect(open).toContain("min-h-[44px]");
});

it("opens by the server answer when the clock is not known yet", async () => {
  mockMine(mineFor(UPCOMING_EVENT));
  view(main, null);
  expect(await screen.findByRole("link", { name: /^Pick the winner of/ })).toBeInTheDocument();
});
