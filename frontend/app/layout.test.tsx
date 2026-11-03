/** Root layout structure (element tree only -- nothing is rendered to the
 *  DOM, so <html>/<body> nesting is not an issue). */
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import RootLayout from "./layout";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { SiteNav } from "@/components/SiteNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { CompetitionProvider } from "@/components/TournamentProvider";

jest.mock("@/lib/tournament", () => ({
  getTournament: jest.fn(async () => ({
    id: 1,
    name: "Premier League 2026-27",
    year: 2026,
    format: "league",
    has_brackets: false,
  })),
}));
jest.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
jest.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));

type El = ReactElement<{ children?: ReactNode; className?: string; initial?: unknown }>;

/** Depth-first walk over elements as written in the layout (components are
 *  not called, so this sees exactly the layout's own structure). */
function walk(node: ReactNode, visit: (el: El, ancestors: El[]) => void, ancestors: El[] = []) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const el = child as El;
    visit(el, ancestors);
    walk(el.props.children, visit, [...ancestors, el]);
  });
}

async function layoutTree() {
  return (await RootLayout({ children: <p>page</p> })) as El;
}

function findAll(tree: El, type: unknown) {
  const hits: Array<{ el: El; ancestors: El[] }> = [];
  walk(tree, (el, ancestors) => {
    if (el.type === type) hits.push({ el, ancestors });
  });
  return hits;
}

const inStickyTop = (ancestors: El[]) =>
  ancestors.some((a) => typeof a.props.className === "string" && a.props.className.includes("app-top"));

it("keeps the site nav and the offline banner in the sticky top bar", async () => {
  const tree = await layoutTree();
  expect(findAll(tree, SiteNav).map((h) => inStickyTop(h.ancestors))).toEqual([true]);
  expect(findAll(tree, OfflineBanner).map((h) => inStickyTop(h.ancestors))).toEqual([true]);
});

it("lets the disclaimer line scroll away: rendered once, outside the sticky top bar", async () => {
  const tree = await layoutTree();
  const banners = findAll(tree, DisclaimerBanner);
  expect(banners).toHaveLength(1);
  expect(inStickyTop(banners[0].ancestors)).toBe(false);
});

it("does not read the request in the root layout (prerendered routes stay static)", async () => {
  const tree = await layoutTree();
  // No server-resolved competition is passed down: see the comment in layout.tsx.
  expect(findAll(tree, CompetitionProvider)[0].el.props.initial).toBeUndefined();
});
