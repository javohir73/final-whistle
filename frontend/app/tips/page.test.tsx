/** /tips -> /play (307). It duplicated /play's league picker and wore World
 *  Cup chrome; ?league= maps onto /play's ?competition=. */
import { redirect } from "next/navigation";
import TipsRedirect from "./page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 307 ${url}`);
  }),
}));

afterEach(() => jest.clearAllMocks());

const go = (query: Record<string, string | string[]> = {}) =>
  TipsRedirect({ searchParams: Promise.resolve(query) });

it("sends /tips to /play", async () => {
  await expect(go()).rejects.toThrow("NEXT_REDIRECT 307 /play");
  expect(redirect).toHaveBeenCalledWith("/play");
});

it.each(["epl", "laliga", "bundesliga"])("maps ?league=%s to ?competition=", async (league) => {
  await expect(go({ league })).rejects.toThrow(`NEXT_REDIRECT 307 /play?competition=${league}`);
});

it("drops an unknown league rather than passing junk on", async () => {
  await expect(go({ league: "toString" })).rejects.toThrow("NEXT_REDIRECT 307 /play");
  expect(redirect).toHaveBeenCalledWith("/play");
});

it("keeps other params such as utm_source", async () => {
  await expect(go({ league: "laliga", utm_source: "newsletter" })).rejects.toThrow(
    "NEXT_REDIRECT 307 /play?competition=laliga&utm_source=newsletter",
  );
});

it("prefers an explicit ?competition= over ?league=", async () => {
  await expect(go({ competition: "nrl", league: "epl" })).rejects.toThrow(
    "NEXT_REDIRECT 307 /play?competition=nrl",
  );
});
