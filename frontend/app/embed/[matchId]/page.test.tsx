import { render, screen } from "@testing-library/react";

const getMatchServer = jest.fn();
const getMatchSummaryServer = jest.fn();
jest.mock("@/lib/api", () => ({
  getMatchServer: (...a: unknown[]) => getMatchServer(...a),
  getMatchSummaryServer: (...a: unknown[]) => getMatchSummaryServer(...a),
}));

const cardProps = jest.fn();
jest.mock("@/components/EmbedPredictionCard", () => ({
  EMBED_PALETTE: { muted: "#5b6470" },
  embedCardStyle: () => ({}),
  EmbedFooter: () => null,
  EmbedPredictionCard: (props: { revealed: boolean }) => {
    cardProps(props);
    return <div data-testid="card" data-revealed={String(props.revealed)} />;
  },
}));

import EmbedPage from "./page";

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const prediction = { match_id: 210, kickoff_utc: FUTURE, teams: { home: "Arsenal", away: "Chelsea" } };

async function renderEmbed() {
  const ui = await EmbedPage({
    params: Promise.resolve({ matchId: "210" }),
    searchParams: Promise.resolve({}),
  });
  render(ui);
}

beforeEach(() => {
  getMatchServer.mockReset();
  getMatchSummaryServer.mockReset();
  cardProps.mockReset();
});

describe("embed reveal rule (public viewer)", () => {
  it("hides the model on an open fixture", async () => {
    getMatchServer.mockResolvedValue(prediction);
    getMatchSummaryServer.mockResolvedValue({ competition: "epl", status: "scheduled", kickoff_utc: FUTURE });
    await renderEmbed();
    expect(screen.getByTestId("card")).toHaveAttribute("data-revealed", "false");
  });

  it("fails closed when the summary request fails", async () => {
    getMatchServer.mockResolvedValue(prediction);
    getMatchSummaryServer.mockRejectedValue(new Error("cold start"));
    await renderEmbed();
    expect(screen.getByTestId("card")).toHaveAttribute("data-revealed", "false");
  });

  it("fails closed when the summary has no competition", async () => {
    getMatchServer.mockResolvedValue({ ...prediction, kickoff_utc: FUTURE });
    getMatchSummaryServer.mockResolvedValue({ competition: "", status: "scheduled", kickoff_utc: FUTURE });
    await renderEmbed();
    expect(screen.getByTestId("card")).toHaveAttribute("data-revealed", "false");
  });

  it("shows the model once the match is finished", async () => {
    getMatchServer.mockResolvedValue({ ...prediction, kickoff_utc: PAST });
    getMatchSummaryServer.mockResolvedValue({ competition: "epl", status: "finished", kickoff_utc: PAST });
    await renderEmbed();
    expect(screen.getByTestId("card")).toHaveAttribute("data-revealed", "true");
  });

  it("renders the unavailable card when the match is missing", async () => {
    getMatchServer.mockResolvedValue(null);
    getMatchSummaryServer.mockResolvedValue(null);
    await renderEmbed();
    expect(screen.getByText("Prediction unavailable")).toBeInTheDocument();
    expect(cardProps).not.toHaveBeenCalled();
  });
});
