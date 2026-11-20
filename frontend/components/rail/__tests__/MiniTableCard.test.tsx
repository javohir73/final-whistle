import { render, screen, waitFor } from "@testing-library/react";
import { MiniTableCard } from "../MiniTableCard";

const row = (team_id: number, team: string, pts: number, gd: number, played = 10) => ({
  team_id, team, projected_points: pts, projected_goals_for: 10, projected_goal_diff: gd,
  qualification_prob: null, played, won: 0, drawn: 0, lost: 0, goals_against: 0,
});

const TABLE = [{ id: 13, name: "Premier League", standings: [
  row(339, "Arsenal", 27, 10), row(343, "Brighton", 22, 19), row(353, "Manchester City", 21, 8),
  row(352, "Liverpool", 18, 4), row(344, "Chelsea", 16, 3), row(347, "Everton", 16, 2),
  row(348, "Crystal Palace", 7, -14),
] }];

function mockFetch(impl: () => Promise<unknown>) {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

afterEach(() => jest.restoreAllMocks());

describe("MiniTableCard", () => {
  it("renders the top rows with club links, short names and signed GD", async () => {
    mockFetch(async () => ({ ok: true, json: async () => TABLE }));
    render(<MiniTableCard competition="epl" />);
    expect(await screen.findByRole("link", { name: "Arsenal" })).toHaveAttribute("href", "/football/epl/team/339");
    expect(screen.getByRole("link", { name: "Man City" })).toHaveAttribute("href", "/football/epl/team/353");
    expect(screen.getByRole("link", { name: "Full table" })).toHaveAttribute("href", "/football/epl/standings");
    expect(screen.getByRole("heading", { name: "Table" })).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    // limit 6: the seventh club is not listed
    expect(screen.queryByText("Crystal Palace")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7); // header + 6
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("/api/groups?competition=epl");
  });

  it("keeps a long name on one line: full name in the tooltip, cut only if it cannot fit", async () => {
    const t = [{ id: 1, name: "La Liga", standings: [row(541, "Real Sociedad", 20, 5)] }];
    mockFetch(async () => ({ ok: true, json: async () => t }));
    render(<MiniTableCard competition="laliga" />);
    const link = await screen.findByRole("link", { name: "Real Sociedad" });
    const name = screen.getByTitle("Real Sociedad");
    expect(name).toHaveClass("truncate");
    expect(link).toContainElement(name);
    expect(link.closest("table")).toHaveClass("table-fixed");
  });

  it("uses a real minus sign for negative goal difference", async () => {
    mockFetch(async () => ({ ok: true, json: async () => TABLE }));
    render(<MiniTableCard competition="epl" limit={7} />);
    expect(await screen.findByText("−14")).toBeInTheDocument();
  });

  it("shows fixed skeleton rows while loading", () => {
    mockFetch(() => new Promise(() => {}));
    const { container } = render(<MiniTableCard competition="epl" limit={4} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("renders nothing when the request fails", async () => {
    mockFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { container } = render(<MiniTableCard competition="epl" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing for an empty table", async () => {
    mockFetch(async () => ({ ok: true, json: async () => [{ id: 1, name: "x", standings: [] }] }));
    const { container } = render(<MiniTableCard competition="ucl" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing (and fetches nothing) for a competition without a league table", () => {
    mockFetch(async () => ({ ok: true, json: async () => TABLE }));
    const { container: wc } = render(<MiniTableCard competition="wc26" />);
    expect(wc).toBeEmptyDOMElement();
    const { container: nrl } = render(<MiniTableCard competition="nrl" />);
    expect(nrl).toBeEmptyDOMElement();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
