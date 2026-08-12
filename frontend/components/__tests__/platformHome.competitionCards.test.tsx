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

  it("leaves competition card copy colour to the authoritative component layer", () => {
    const { container } = render(<PlatformHome />);

    for (const copy of container.querySelectorAll(".competition-card__copy")) {
      expect(copy).not.toHaveClass("text-muted");
    }
  });

  it("leaves competition card arrow colour and motion to the authoritative component layer", () => {
    const { container } = render(<PlatformHome />);

    for (const arrow of container.querySelectorAll(".competition-card__arrow")) {
      for (const className of ["text-muted", "text-lime-deep", "transition"]) {
        expect(arrow).not.toHaveClass(className);
      }
      expect(Array.from(arrow.classList).some((name) => name.startsWith("group-hover:"))).toBe(
        false,
      );
    }
  });
});
