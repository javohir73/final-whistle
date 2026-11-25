/** Sitemap coverage and correctness.
 *
 *  Two bugs are pinned here.
 *
 *  Floodlight P1: the static /matches, /groups, /brackets entries and the
 *  dynamic /match/{id}, /groups/{id}, /team/{id} entries were all now-301'd
 *  legacy paths (next.config.mjs), so Googlebot never saw a live URL.
 *
 *  Pre-season: the sitemap was almost exclusively WC26. It fetched
 *  /api/matches/upcoming and /api/teams with NO competition filter and emitted
 *  every id under /football/wc26/... — so once the league pipeline went live it
 *  advertised Premier League fixtures and clubs at World Cup URLs. Those are
 *  invalid routes, not merely mislabelled ones: the [comp] pages verify the
 *  match belongs to the competition in the path and 404. EPL, La Liga,
 *  Bundesliga, UCL and NRL had no presence at all.
 */
import sitemap from "./sitemap";

const SITE = "https://fifa-wc26-prediction.vercel.app";

/** Answer every /api/... call with ids derived from the competition in the
 *  query string, so a leak across competitions is detectable. */
function mockApi(byComp: Record<string, { matches: number[]; teams: number[] }>) {
  return jest.fn((url: string) => {
    const comp = new URL(url, "http://x").searchParams.get("competition") ?? "";
    const entry = byComp[comp] ?? { matches: [], teams: [] };
    const rows = url.includes("/api/teams")
      ? entry.teams.map((id) => ({ id }))
      : entry.matches.map((match_id) => ({ match_id }));
    return Promise.resolve({ ok: true, json: async () => rows } as Response);
  });
}

const EMPTY = { matches: [], teams: [] };

describe("sitemap", () => {
  afterEach(() => jest.restoreAllMocks());

  it("covers every enabled football competition plus NRL", async () => {
    global.fetch = mockApi({}) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);

    for (const comp of ["epl", "laliga", "bundesliga", "ucl", "wc26"]) {
      expect(urls).toContain(`${SITE}/football/${comp}`);
      expect(urls).toContain(`${SITE}/football/${comp}/fixtures`);
    }
    expect(urls).toContain(`${SITE}/nrl`);
    expect(urls).toContain(`${SITE}/nrl/ladder`);
  });

  it("scopes match and team ids to their own competition", async () => {
    // THE regression: an EPL match id must never appear under /football/wc26/.
    global.fetch = mockApi({
      epl: { matches: [101], teams: [201] },
      wc26: { matches: [1], teams: [10] },
    }) as unknown as typeof fetch;

    const urls = (await sitemap()).map((e) => e.url);

    expect(urls).toContain(`${SITE}/football/epl/match/101`);
    expect(urls).toContain(`${SITE}/football/epl/team/201`);
    expect(urls).toContain(`${SITE}/football/wc26/match/1`);
    expect(urls).not.toContain(`${SITE}/football/wc26/match/101`);
    expect(urls).not.toContain(`${SITE}/football/wc26/team/201`);
    expect(urls).not.toContain(`${SITE}/football/epl/match/1`);
  });

  it("always passes a competition filter to the API", async () => {
    // An unfiltered call is what produced the cross-competition leak, so the
    // absence of the parameter is itself the bug.
    const fetchMock = mockApi({});
    global.fetch = fetchMock as unknown as typeof fetch;
    await sitemap();

    expect(fetchMock).toHaveBeenCalled();
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toMatch(/[?&]competition=/);
    }
  });

  it("emits standings for league competitions and groups/bracket only for WC26", async () => {
    global.fetch = mockApi({}) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);

    // League format: a table at /standings. /groups and /bracket 404 there.
    for (const comp of ["epl", "laliga", "bundesliga", "ucl"]) {
      expect(urls).toContain(`${SITE}/football/${comp}/standings`);
      expect(urls).not.toContain(`${SITE}/football/${comp}/groups`);
      expect(urls).not.toContain(`${SITE}/football/${comp}/bracket`);
    }
    // WC26 is the only competition with group tables and a bracket.
    expect(urls).toContain(`${SITE}/football/wc26/groups`);
    expect(urls).toContain(`${SITE}/football/wc26/bracket`);
    expect(urls).not.toContain(`${SITE}/football/wc26/standings`);
  });

  it("lists the cross-competition surfaces", async () => {
    global.fetch = mockApi({}) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);
    for (const p of ["", "/leaderboard", "/play", "/about", "/methodology"]) {
      expect(urls).toContain(`${SITE}${p}`);
    }
  });

  it("does not list /premium: the page is retired and redirects home", async () => {
    global.fetch = mockApi({}) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).not.toContain(`${SITE}/premium`);
  });

  it("lists the /football hub (it used to 404)", async () => {
    global.fetch = mockApi({}) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${SITE}/football`);
  });

  it("never lists a redirect: /tips now 307s to /play", async () => {
    global.fetch = mockApi({}) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).not.toContain(`${SITE}/tips`);
    expect(urls.some((u) => /\/(?:match|team)\/\d+$/.test(u) && !u.includes("/football/"))).toBe(
      false,
    );
  });

  it("never lists a redirecting legacy path", async () => {
    global.fetch = mockApi({
      wc26: { matches: [1], teams: [10] },
    }) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);

    // Exact strings: the live /football/wc26/... URLs legitimately end in
    // "/groups" etc. too, so a substring check would not distinguish them.
    for (const legacy of ["/matches", "/groups", "/brackets", "/match/1", "/groups/3", "/team/10"]) {
      expect(urls).not.toContain(`${SITE}${legacy}`);
    }
  });

  it("still builds when the backend is unreachable", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);

    // Static surfaces survive; only the id-driven entries drop out.
    expect(urls).toContain(SITE);
    expect(urls).toContain(`${SITE}/football/epl/fixtures`);
    expect(urls.some((u) => /\/match\/\d+$/.test(u))).toBe(false);
  });

  it("emits no duplicate URLs", async () => {
    global.fetch = mockApi({ epl: EMPTY }) as unknown as typeof fetch;
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.length).toBe(new Set(urls).size);
  });
});
