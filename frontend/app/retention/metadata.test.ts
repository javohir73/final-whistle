/** /retention is an internal dashboard (0% D1 on display): never indexed. */
import { metadata } from "./page";

jest.mock("@/lib/api", () => ({ getRetentionServer: jest.fn() }));

it("is kept out of search results", () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
});
