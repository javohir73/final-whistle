/** The footer carries no Premium link. */
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import RootLayout from "./layout";

jest.mock("@/lib/tournament", () => ({
  getTournament: jest.fn(async () => ({
    id: 1, name: "Premier League 2026-27", year: 2026, format: "league", has_brackets: false,
  })),
}));
jest.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
jest.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));

type El = ReactElement<{ children?: ReactNode; href?: string }>;

function hrefs(node: ReactNode, out: string[] = []): string[] {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const el = child as El;
    if (typeof el.props.href === "string") out.push(el.props.href);
    hrefs(el.props.children, out);
  });
  return out;
}

it("links the footer pages but not /premium", async () => {
  const tree = (await RootLayout({ children: <p>page</p> })) as El;
  const links = hrefs(tree);
  expect(links).toEqual(expect.arrayContaining(["/about", "/methodology", "/privacy", "/terms"]));
  expect(links).not.toContain("/premium");
});
