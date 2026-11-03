/** /football/{comp}/bracket serves the World Cup bracket, so it must be a
 *  real 404 for every competition without one -- /football/epl/bracket used
 *  to 200 with the WC26 bracket (live, 2026-11-03). */
import { notFound } from "next/navigation";
import CompBracketPage from "./page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
// The legacy page fetches; the guard must reject before it is ever rendered.
jest.mock("@/app/brackets/page", () => ({
  __esModule: true,
  default: function LegacyBracketsPage() {
    return null;
  },
  generateMetadata: jest.fn(),
}));

afterEach(() => jest.clearAllMocks());

const page = (comp: string) => CompBracketPage({ params: Promise.resolve({ comp }) });

it.each(["epl", "laliga", "bundesliga", "ucl", "nrl", "bogus"])(
  "404s /football/%s/bracket",
  async (comp) => {
    await expect(page(comp)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  },
);

it("serves the World Cup bracket at /football/wc26/bracket", async () => {
  const element = await page("wc26");
  expect(element.type.name).toBe("LegacyBracketsPage");
  expect(notFound).not.toHaveBeenCalled();
});
