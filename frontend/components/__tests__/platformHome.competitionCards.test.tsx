import { render } from "@testing-library/react";
import { PlatformHome } from "@/components/PlatformHome";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

const competitionIds: CompetitionId[] = [
  "epl",
  "laliga",
  "bundesliga",
  "ucl",
  "wc26",
  "nrl",
];

describe("PlatformHome competition cards", () => {
  it("gives every competition the shared branded treatment and registry accent", () => {
    const { container } = render(<PlatformHome />);

    for (const id of competitionIds) {
      const card = container.querySelector(`[data-competition-card="${id}"]`);
      expect(card).toHaveClass("competition-card");
      expect(card).toHaveAttribute(
        "style",
        expect.stringContaining(
          `--competition-card-accent: var(${COMPETITIONS[id].accentVar})`,
        ),
      );
      expect(card?.querySelector(".competition-card__copy")).toBeInTheDocument();
      expect(card?.querySelector(".competition-card__arrow")).toBeInTheDocument();
    }

    expect(container.querySelectorAll("[data-competition-card]")).toHaveLength(6);
    expect(container.querySelector('[data-competition-card="nrl"]')).toHaveClass(
      "competition-card--wide",
    );
  });
});
