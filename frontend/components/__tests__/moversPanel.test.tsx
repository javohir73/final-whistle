import { render, screen, waitFor } from "@testing-library/react";
import { MoversPanel } from "@/components/MoversPanel";
import { getMovers } from "@/lib/api";
import type { Mover } from "@/lib/types";

jest.mock("@/lib/api");
const mockGetMovers = getMovers as jest.MockedFunction<typeof getMovers>;

const movers: Mover[] = [
  {
    entity_id: 16, name: "Warriors", market: "win_match",
    prob: 0.63, delta: 0.02, series: [0.6, 0.63], match_url: "/nrl/match/2026/19/3",
  },
];

afterEach(() => jest.resetAllMocks());

it("links an NRL win_match row to its match detail page", async () => {
  mockGetMovers.mockResolvedValue({
    sport: "nrl", as_of: "2026-07-10", movers,
    disclaimer: "For analytics and entertainment only. Not betting advice.",
  });
  render(<MoversPanel sport="nrl" />);

  await waitFor(() => expect(screen.getByText("Warriors")).toBeInTheDocument());
  expect(screen.getByRole("link", { name: /Warriors/ })).toHaveAttribute(
    "href", "/nrl/match/2026/19/3",
  );
});

it("renders a plain row when match_url is null", async () => {
  mockGetMovers.mockResolvedValue({
    sport: "nrl", as_of: "2026-07-10",
    movers: [{ ...movers[0], match_url: null }],
    disclaimer: "For analytics and entertainment only. Not betting advice.",
  });
  render(<MoversPanel sport="nrl" />);

  await waitFor(() => expect(screen.getByText("Warriors")).toBeInTheDocument());
  expect(screen.queryByRole("link", { name: /Warriors/ })).not.toBeInTheDocument();
});

// ---- Nothing moved: no panel (the off-season "Today's movers ▲0.0") --------

const flat = (name: string, delta: number | null): Mover => ({
  entity_id: name.length, name, market: "win_match", prob: 0.6, delta, series: [0.6, 0.6], match_url: null,
});

function feed(rows: Mover[]) {
  mockGetMovers.mockResolvedValue({
    sport: "nrl", as_of: "2026-10-03", movers: rows,
    disclaimer: "For analytics and entertainment only. Not betting advice.",
  });
}

it("renders nothing when every delta is 0", async () => {
  feed([flat("Roosters", 0), flat("Knights", 0)]);
  const { container } = render(<MoversPanel sport="nrl" />);

  await waitFor(() => expect(mockGetMovers).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(screen.queryByText("Today's movers")).not.toBeInTheDocument();
});

it("also treats a move that would print as ▲ 0.0 as no move", async () => {
  feed([flat("Roosters", 0.0003), flat("Knights", -0.0004)]);
  const { container } = render(<MoversPanel sport="nrl" />);

  await waitFor(() => expect(mockGetMovers).toHaveBeenCalled());
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("still shows the panel when at least one row moved", async () => {
  feed([flat("Roosters", 0), flat("Knights", -0.021)]);
  render(<MoversPanel sport="nrl" />);

  // "Today's movers" is already in the loading skeleton; wait for the rows.
  expect(await screen.findByText("Knights")).toBeInTheDocument();
  expect(screen.getByText("Today's movers")).toBeInTheDocument();
});

it("still shows a row with no history yet (null delta)", async () => {
  feed([flat("Dolphins", null)]);
  render(<MoversPanel sport="nrl" />);

  expect(await screen.findByText("Dolphins")).toBeInTheDocument();
  expect(screen.getByText("Today's movers")).toBeInTheDocument();
});
