/** /premium is retired: it permanently redirects to the home page. */
const mockPermanentRedirect = jest.fn();
jest.mock("next/navigation", () => ({
  permanentRedirect: (...a: unknown[]) => mockPermanentRedirect(...a),
}));

import PremiumPage from "./page";

it("permanently redirects to /", () => {
  PremiumPage();
  expect(mockPermanentRedirect).toHaveBeenCalledTimes(1);
  expect(mockPermanentRedirect).toHaveBeenCalledWith("/");
});
