/** Competition pages must describe their OWN competition.
 *
 *  The bug: /football/epl/standings was titled "Premier League standings" but
 *  carried a La Liga description. The standings page set only a title, so the
 *  description fell through to the root layout's — which was built from
 *  getTournament(), i.e. whichever competition the pipeline happened to be
 *  pointed at. Every page without its own description described that one.
 */
import { generateMetadata as compHomeMeta } from "./page";
import { generateMetadata as fixturesMeta } from "./fixtures/page";
import { generateMetadata as standingsMeta } from "./standings/page";

const LEAGUES = [
  ["epl", "Premier League"],
  ["laliga", "La Liga"],
  ["bundesliga", "Bundesliga"],
] as const;

/** Every other competition's label — nothing about one competition's page may
 *  mention any of them. */
const OTHERS: Record<string, string[]> = {
  epl: ["La Liga", "Bundesliga", "World Cup", "Champions League"],
  laliga: ["Premier League", "Bundesliga", "World Cup", "Champions League"],
  bundesliga: ["Premier League", "La Liga", "World Cup", "Champions League"],
};

const text = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));

describe.each(LEAGUES)("/football/%s", (comp, label) => {
  it("titles and describes its own competition on standings", async () => {
    const meta = await standingsMeta({ params: Promise.resolve({ comp }) });
    expect(text(meta.title)).toContain(label);
    // THE regression: the description must exist and must be this competition.
    expect(meta.description).toBeTruthy();
    expect(text(meta.description)).toContain(label);
    for (const other of OTHERS[comp]) {
      expect(text(meta.description)).not.toContain(other);
      expect(text(meta.title)).not.toContain(other);
    }
  });

  it("sets a self-referencing canonical on standings", async () => {
    const meta = await standingsMeta({ params: Promise.resolve({ comp }) });
    expect(meta.alternates?.canonical).toBe(`/football/${comp}/standings`);
  });

  it("titles and describes its own competition on the home and fixtures pages", async () => {
    for (const gen of [compHomeMeta, fixturesMeta]) {
      const meta = await gen({ params: Promise.resolve({ comp }) });
      expect(text(meta.title)).toContain(label);
      expect(text(meta.description)).toContain(label);
      for (const other of OTHERS[comp]) {
        expect(text(meta.description)).not.toContain(other);
      }
    }
  });

  it("canonicalizes the competition home and fixtures pages", async () => {
    expect(
      (await compHomeMeta({ params: Promise.resolve({ comp }) })).alternates?.canonical,
    ).toBe(`/football/${comp}`);
    expect(
      (await fixturesMeta({ params: Promise.resolve({ comp }) })).alternates?.canonical,
    ).toBe(`/football/${comp}/fixtures`);
  });
});

describe("UCL", () => {
  it("uses its own standings term rather than the generic one", async () => {
    // COMPETITIONS.ucl.terms.standings is "League phase" — the nav says so, and
    // the page title should agree with the nav that got you there.
    const meta = await standingsMeta({ params: Promise.resolve({ comp: "ucl" }) });
    expect(text(meta.title).toLowerCase()).toContain("league phase");
    expect(text(meta.description)).toContain("UEFA Champions League");
  });
});
