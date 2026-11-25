/** Sitemap shape report — the acceptance-gate "validate sitemap counts" check,
 *  expressed as an assertion instead of a one-off script so it keeps holding.
 *
 *  Before: the sitemap was 4 static WC26 surfaces plus every match/team id in
 *  the database, all emitted under /football/wc26/... EPL, La Liga, Bundesliga,
 *  UCL and NRL had zero URLs between them.
 */
import sitemap from "./sitemap";

const SITE = "https://fifa-wc26-prediction.vercel.app";

const api = (byComp: Record<string, { matches: number[]; teams: number[] }>) =>
  jest.fn((url: string) => {
    const comp = new URL(url, "http://x").searchParams.get("competition") ?? "";
    const e = byComp[comp] ?? { matches: [], teams: [] };
    const rows = url.includes("/api/teams")
      ? e.teams.map((id) => ({ id }))
      : e.matches.map((match_id) => ({ match_id }));
    return Promise.resolve({ ok: true, json: async () => rows } as Response);
  });

afterEach(() => jest.restoreAllMocks());

it("gives every competition a non-zero share of the sitemap", async () => {
  global.fetch = api({}) as unknown as typeof fetch;
  const urls = (await sitemap()).map((e) => e.url);

  const counts = Object.fromEntries(
    ["epl", "laliga", "bundesliga", "ucl", "wc26"].map((c) => [
      c,
      urls.filter((u) => u.startsWith(`${SITE}/football/${c}`)).length,
    ]),
  );
  const nrl = urls.filter((u) => u.startsWith(`${SITE}/nrl`)).length;

  // Each football competition: home + fixtures + (standings | groups[+bracket]).
  for (const [comp, n] of Object.entries(counts)) {
    expect([comp, n >= 3]).toEqual([comp, true]);
  }
  expect(nrl).toBeGreaterThanOrEqual(5);
  expect(urls.filter((u) => u.startsWith(`${SITE}/ufc`)).length).toBeGreaterThanOrEqual(2);

  // WC26 no longer dominates: it is one competition among five.
  const football = Object.values(counts).reduce((a, b) => a + b, 0);
  expect(counts.wc26 / football).toBeLessThan(0.5);
});

it("routes every dynamic id under the competition it belongs to", async () => {
  global.fetch = api({
    epl: { matches: [1, 2, 3], teams: [10, 11] },
    laliga: { matches: [4], teams: [12] },
    wc26: { matches: [90], teams: [99] },
  }) as unknown as typeof fetch;
  const urls = (await sitemap()).map((e) => e.url);

  expect(urls.filter((u) => /\/football\/epl\/match\/\d+$/.test(u))).toHaveLength(3);
  expect(urls.filter((u) => /\/football\/epl\/team\/\d+$/.test(u))).toHaveLength(2);
  expect(urls.filter((u) => /\/football\/laliga\/match\/\d+$/.test(u))).toHaveLength(1);
  expect(urls.filter((u) => /\/football\/wc26\/match\/\d+$/.test(u))).toHaveLength(1);
  // The old bug in one line: 5 match ids existed, only wc26's belongs to wc26.
  expect(urls).not.toContain(`${SITE}/football/wc26/match/1`);
});
