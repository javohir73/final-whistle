/** Junk competition segments under /football/ are real 404s, decided above
 *  every competition page's loading boundary (so ISR never caches a soft 404
 *  per junk path). */
import { notFound } from "next/navigation";
import CompetitionSegmentLayout from "./layout";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

afterEach(() => jest.clearAllMocks());

const layout = (comp: string) =>
  CompetitionSegmentLayout({ children: "competition page", params: Promise.resolve({ comp }) });

it.each(["epl", "laliga", "bundesliga", "ucl", "wc26"])("renders /football/%s/...", async (comp) => {
  await expect(layout(comp)).resolves.toBe("competition page");
  expect(notFound).not.toHaveBeenCalled();
});

it.each(["nrl", "seriea", "bogus", "toString", "EPL"])("404s /football/%s/...", async (comp) => {
  await expect(layout(comp)).rejects.toThrow("NEXT_NOT_FOUND");
});
