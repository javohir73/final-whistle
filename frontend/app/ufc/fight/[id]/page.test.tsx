import { act, render, screen } from "@testing-library/react";
import { DECISION_BOUT, KO_BOUT, PLACEHOLDER_BOUT, SCHEDULED_BOUT } from "@/components/ufc/fixtures.testutil";
import { getUfcBoutServer } from "@/lib/api";
import FightPage, { generateMetadata, generateStaticParams, revalidate } from "./page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/api", () => ({ getUfcBoutServer: jest.fn() }));
const mockBout = getUfcBoutServer as jest.Mock;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockBout.mockReset();
});

it("has route settings", async () => {
  expect(revalidate).toBe(120);
  expect(generateStaticParams()).toEqual([]);
});

it("renders the fight", async () => {
  mockBout.mockResolvedValue(KO_BOUT);
  render(await FightPage(params("1")));
  expect(screen.getByRole("heading", { level: 1, name: "Jiří Procházka v Navajo Stirling" })).toBeInTheDocument();
  await act(async () => {}); // let the picks fetch settle inside act
});

it("404s a missing fight", async () => {
  mockBout.mockResolvedValue(null);
  await expect(FightPage(params("1"))).rejects.toThrow("NEXT_NOT_FOUND");
});

it("says the feed is down", async () => {
  mockBout.mockRejectedValue(new Error("502"));
  render(await FightPage(params("1")));
  expect(screen.getByText("This fight is unavailable right now")).toBeInTheDocument();
  expect(screen.getByText("We could not reach the fight feed. Try again in a minute.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Fight" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to the next card" })).toHaveAttribute("href", "/ufc");
});

it("describes a scheduled fight", async () => {
  mockBout.mockResolvedValue(SCHEDULED_BOUT);
  const m = await generateMetadata(params("1"));
  expect(m.title).toBe("Israel Adesanya v Shara Magomedov — UFC Fight Night: Adesanya vs Magomedov | FinalWhistle");
  expect(m.description).toBe(
    "Middleweight fight over 5 rounds. The tale of the tape now, the result and fight stats once it is over.",
  );
  expect(JSON.stringify(m)).not.toMatch(/official/i);
});

it("describes a finished fight", async () => {
  mockBout.mockResolvedValue(DECISION_BOUT);
  const m = await generateMetadata(params("1"));
  expect(m.description).toBe("Kevin Vallejos won by decision (Unanimous). Fight stats and the tale of the tape.");
  expect(JSON.stringify(m)).not.toMatch(/official/i);
});

it("falls back for an unknown or malformed fight", async () => {
  mockBout.mockResolvedValue(null);
  expect((await generateMetadata(params("1"))).title).toBe("UFC fight — FinalWhistle");
  expect((await generateMetadata(params("abc"))).title).toBe("UFC fight — FinalWhistle");
  mockBout.mockRejectedValue(new Error("502"));
  expect((await generateMetadata(params("1"))).title).toBe("UFC fight — FinalWhistle");
});

it("does not promise a result for a cancelled fight", async () => {
  mockBout.mockResolvedValue({ ...SCHEDULED_BOUT, status: "cancelled" });
  expect((await generateMetadata(params("1"))).description).toBe("This fight was cancelled.");
});

it("does not invent a weight class", async () => {
  mockBout.mockResolvedValue({ ...SCHEDULED_BOUT, weight_class: null });
  const d = (await generateMetadata(params("1"))).description as string;
  expect(d).toMatch(/^UFC fight over 5 rounds\./);
  expect(d).not.toMatch(/confirmed/);
  mockBout.mockResolvedValue({ ...SCHEDULED_BOUT, weight_class: null, scheduled_rounds: null });
  expect(((await generateMetadata(params("1"))).description as string)).toMatch(/^UFC fight\. /);
});

it("says 1 round, not 1 rounds", async () => {
  mockBout.mockResolvedValue({ ...SCHEDULED_BOUT, scheduled_rounds: 1 });
  expect(((await generateMetadata(params("1"))).description as string)).toMatch(/ over 1 round\./);
});

it("promises no tale of the tape for a fight with a placeholder fighter", async () => {
  mockBout.mockResolvedValue({ ...PLACEHOLDER_BOUT });
  const d = (await generateMetadata(params("1"))).description as string;
  expect(d).toBe("UFC fight. UFC Fight Night: Adesanya vs Magomedov.");
  expect(d).not.toMatch(/tale of the tape/i);
});
