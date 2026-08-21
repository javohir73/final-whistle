import { render } from "@testing-library/react";
import { PlatformHome } from "@/components/PlatformHome";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

const competitionIds: CompetitionId[] = Object.values(COMPETITIONS).map(
  (competition) => competition.id,
);

const authoritativeCardSurfaces =
  "[data-competition-card], .competition-card__copy, .competition-card__arrow, [data-competition-logo]";
const nonColorTextUtility = /^text-(?:xs|sm|base|lg|xl|[2-9]xl|micro|mini|note|label|meta|body|lead|sub|numeral|headline|score(?:-sm)?|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[(?:[\d.]+(?:px|rem|em|%|vw|vh)|clamp\(.+\))\])$/;

function classParts(className: string): string[] {
  const parts: string[] = [];
  let bracketDepth = 0;
  let start = 0;

  for (let index = 0; index < className.length; index += 1) {
    if (className[index] === "[") bracketDepth += 1;
    if (className[index] === "]") bracketDepth -= 1;
    if (className[index] === ":" && bracketDepth === 0) {
      parts.push(className.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(className.slice(start));
  return parts;
}

function normalizedUtility(className: string): string {
  return classParts(className).at(-1)!.replace(/^!|!$/g, "");
}

function isTextColorUtility(className: string): boolean {
  const name = normalizedUtility(className);
  return (
    (name.startsWith("text-") && !nonColorTextUtility.test(name)) ||
    /^\[color:.+\]$/.test(name)
  );
}

function isHoverTransformUtility(className: string): boolean {
  const parts = classParts(className);
  const name = normalizedUtility(className);
  const hasHoverVariant = parts.slice(0, -1).some((variant) => variant.includes("hover"));
  const changesTransform =
    /^(?:-?(?:translate-[xy]|rotate|skew-[xy])-.+|scale(?:-[xy])?-.+|transform(?:-.+)?|origin-.+)$/.test(
      name,
    ) || /^\[(?:transform|translate|rotate|scale|skew):.+\]$/.test(name);
  return hasHoverVariant && changesTransform;
}

describe("PlatformHome competition cards", () => {
  it("gives every competition the shared branded treatment", () => {
    const { container } = render(<PlatformHome />);

    for (const id of competitionIds) {
      const card = container.querySelector(`[data-competition-card="${id}"]`);
      expect(card).toHaveClass("competition-card");
      expect(card).toHaveClass("rounded-2xl");
      expect(card?.querySelector(".competition-card__copy")).toBeInTheDocument();
      expect(card?.querySelector(".competition-card__arrow")).toBeInTheDocument();
    }

    expect(container.querySelectorAll("[data-competition-card]")).toHaveLength(6);
    expect(container.querySelector('[data-competition-card="nrl"]')).toHaveClass(
      "competition-card--wide",
    );
    expect(
      container.querySelector('[data-competition-card="nrl"] .competition-card__wide-copy'),
    ).toBeInTheDocument();
  });

  it("keeps Tailwind text colours off every authoritative competition card surface", () => {
    const { container } = render(<PlatformHome />);
    const violations = Array.from(container.querySelectorAll(authoritativeCardSurfaces)).flatMap(
      (element) => Array.from(element.classList).filter(isTextColorUtility),
    );

    expect(violations).toEqual([]);
  });

  it("keeps Tailwind hover transforms off every authoritative competition card surface", () => {
    const { container } = render(<PlatformHome />);

    for (const element of container.querySelectorAll(authoritativeCardSurfaces)) {
      expect(Array.from(element.classList).filter(isHoverTransformUtility)).toEqual([]);
    }
  });

  it("gives the football row the approved larger Graphic split proportions", () => {
    const { container } = render(<PlatformHome />);
    const footballCards = Array.from(
      container.querySelectorAll('[data-competition-card]:not([data-competition-card="nrl"])'),
    );

    expect(footballCards).toHaveLength(5);
    expect(footballCards[0]?.parentElement).toHaveClass(
      "competition-card-grid",
      "items-start",
      "sm:grid-cols-2",
      "md:grid-cols-3",
      "xl:grid-cols-5",
    );
    expect(footballCards[0]?.parentElement).not.toHaveClass("lg:grid-cols-5");

    for (const card of footballCards) {
      expect(card).toHaveClass(
        "competition-card--compact",
        "h-[300px]",
        "p-5",
      );
      expect(card.querySelector("h3")).toHaveClass(
        "text-[22px]",
        "leading-[1.08]",
      );
      expect(card.querySelector(".competition-card__description")).toHaveClass(
        "text-[11px]",
        "leading-[1.4]",
      );
    }

    for (const card of footballCards.filter(
      (item) => item.getAttribute("data-competition-card") !== "wc26",
    )) {
      expect(card.querySelector("[data-competition-logo]")).toHaveStyle({
        width: "60px",
        height: "60px",
      });
    }

    const worldCupCard = container.querySelector('[data-competition-card="wc26"]');
    expect(worldCupCard?.querySelector("[data-competition-logo]")).toHaveStyle({
      width: "84px",
      height: "72px",
    });
    expect(worldCupCard?.querySelector("[data-competition-logo] img")).toHaveClass(
      "object-cover",
      "competition-card__wc26-mark",
    );
  });

  it("keeps the wide NRL action readable instead of forcing it into the circular arrow", () => {
    const { container } = render(<PlatformHome />);
    const nrlAction = container.querySelector(
      '[data-competition-card="nrl"] .competition-card__arrow',
    );

    expect(nrlAction).toHaveClass(
      "competition-card__arrow--wide",
      "whitespace-nowrap",
    );
    expect(nrlAction).toHaveTextContent("Open NRL");
  });
});
