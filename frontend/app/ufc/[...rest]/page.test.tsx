import { notFound } from "next/navigation";
import CatchAll from "./page";

jest.mock("next/navigation", () => ({ notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

it("hands any unmatched /ufc path to the UFC not-found page", () => {
  expect(() => CatchAll()).toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalled();
});
