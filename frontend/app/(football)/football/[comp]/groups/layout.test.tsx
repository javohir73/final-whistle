/** Group tables exist only for WC26. The guard sits in the segment LAYOUT so
 *  the 404 lands before groups/loading.tsx starts streaming: a page-level
 *  notFound() behind that Suspense boundary was a soft 404 (HTTP 200 +
 *  noindex + not-found body, live on /football/epl/groups). */
import { notFound } from "next/navigation";
import CompGroupsLayout from "./layout";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

afterEach(() => jest.clearAllMocks());

const layout = (comp: string) =>
  CompGroupsLayout({ children: "group tables", params: Promise.resolve({ comp }) });

it.each(["epl", "laliga", "bundesliga", "ucl", "nrl", "bogus"])(
  "404s /football/%s/groups and everything under it",
  async (comp) => {
    await expect(layout(comp)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  },
);

it("renders the World Cup's group pages", async () => {
  await expect(layout("wc26")).resolves.toBe("group tables");
  expect(notFound).not.toHaveBeenCalled();
});
