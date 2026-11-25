import {
  COMPETITIONS,
  DEFAULT_COMPETITION,
  asFootballCompetition,
  competitionFromPathname,
  competitionInPathname,
  competitionLinks,
  competitionsForSport,
  footballMatchHrefOrLookup,
  isCompetitionId,
  isNavTabActive,
  isWiredCompetition,
  isWiredFootballCompetition,
  navTabsFor,
  normalizePathname,
  tableTabLabel,
  type CompetitionId,
} from "@/lib/sports";

const ALL = Object.keys(COMPETITIONS) as CompetitionId[];

describe("normalizePathname", () => {
  it("collapses the root route's internal aliases to the public pathname", () => {
    // During ISR revalidation on Vercel the root route renders under its
    // filesystem name — usePathname() reports "/index", the client computes
    // "/", and every pathname-derived nav branch mismatches (React #418).
    expect(normalizePathname("/index")).toBe("/");
    expect(normalizePathname("")).toBe("/");
    expect(normalizePathname(null)).toBe("/");
  });

  it("leaves every real route untouched", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/nrl")).toBe("/nrl");
    expect(normalizePathname("/football/epl")).toBe("/football/epl");
    expect(normalizePathname("/leaderboard")).toBe("/leaderboard");
    // A genuine page named index under a real prefix is not the alias.
    expect(normalizePathname("/docs/index")).toBe("/docs/index");
  });
});

describe("competition registry", () => {
  it("resolves the active competition from the pathname, longest basePath wins", () => {
    expect(competitionFromPathname("/football/epl/fixtures")).toBe("epl");
    expect(competitionFromPathname("/football/ucl/match/42")).toBe("ucl");
    expect(competitionFromPathname("/football/wc26")).toBe("wc26");
    expect(competitionFromPathname("/football/wc26/match/42")).toBe("wc26");
    expect(competitionFromPathname("/nrl/ladder")).toBe("nrl");
  });

  it("falls back to the EPL (never WC26) for un-namespaced/global routes", () => {
    expect(DEFAULT_COMPETITION).toBe("epl");
    expect(competitionFromPathname("/")).toBe("epl");
    expect(competitionFromPathname("/leaderboard")).toBe("epl");
    expect(competitionFromPathname("/tips")).toBe("epl");
  });

  it.each(["/", "/play", "/leaderboard", "/methodology", "/football", "/football/bogus", "/nrlx"])(
    "reports no URL competition on unscoped route %s",
    (pathname) => {
      expect(competitionInPathname(pathname)).toBeNull();
    },
  );

  it.each([
    ["/football/epl", "epl"],
    ["/football/wc26/fixtures", "wc26"],
    ["/nrl", "nrl"],
    ["/nrl/ladder", "nrl"],
  ] as const)("reads the URL competition from %s", (pathname, comp) => {
    expect(competitionInPathname(pathname)).toBe(comp);
  });

  it("never reads /football/nrl as NRL -- NRL keeps its own namespace", () => {
    expect(competitionInPathname("/football/nrl")).toBeNull();
  });

  it("wires every shipped competition and gates unknown ones", () => {
    expect(isWiredCompetition("wc26")).toBe(true);
    expect(isWiredCompetition("nrl")).toBe(true);
    expect(isWiredCompetition("epl")).toBe(true);
    expect(isWiredCompetition("laliga")).toBe(true);
    expect(isWiredCompetition("bundesliga")).toBe(true);
    expect(isWiredCompetition("ucl")).toBe(true);
    expect(isWiredCompetition("bogus")).toBe(false);
  });

  // Regression: the /football/[comp]/... route wrappers must reject nrl --
  // it's a wired competition (isWiredCompetition("nrl") === true above) but
  // its basePath is /nrl, not /football/nrl, so isWiredCompetition alone let
  // /football/nrl and its subroutes 200 with WC26 content instead of 404ing.
  it("scopes isWiredFootballCompetition to the football namespace, rejecting nrl", () => {
    expect(isWiredFootballCompetition("wc26")).toBe(true);
    expect(isWiredFootballCompetition("nrl")).toBe(false);
    expect(isWiredFootballCompetition("epl")).toBe(true);
    expect(isWiredFootballCompetition("ucl")).toBe(true);
    expect(isWiredFootballCompetition("bogus")).toBe(false);
  });

  it("gives wc26 its knockout shape (bracket + groups)", () => {
    expect(COMPETITIONS.wc26.hasBracket).toBe(true);
    expect(COMPETITIONS.wc26.hasGroups).toBe(true);
    expect(COMPETITIONS.epl.format).toBe("league");
    expect(COMPETITIONS.epl.hasBracket).toBe(false);
  });

  it("exposes the Champions League league phase without inventing a bracket", () => {
    expect(COMPETITIONS.ucl.format).toBe("league");
    expect(COMPETITIONS.ucl.hasBracket).toBe(false);
    expect(COMPETITIONS.ucl.hasGroups).toBe(false);
    expect(COMPETITIONS.ucl.hasTips).toBe(false);
    expect(COMPETITIONS.ucl.terms.standings).toBe("League phase");
  });

  it("gives each sport its own terminology (Fixtures/Standings vs Matches/Ladder)", () => {
    expect(COMPETITIONS.nrl.terms).toEqual({ fixtures: "Matches", standings: "Ladder" });
    expect(COMPETITIONS.epl.terms.fixtures).toBe("Fixtures");
  });

  it("lists competitions per sport in stable display order", () => {
    expect(competitionsForSport("football").map((c) => c.id)).toEqual([
      "epl",
      "laliga",
      "bundesliga",
      "ucl",
      "wc26",
    ]);
    expect(competitionsForSport("nrl").map((c) => c.id)).toEqual(["nrl"]);
  });

  it("gives every competition its own accent token", () => {
    expect(COMPETITIONS.epl.accentVar).toBe("--accent-epl");
    expect(COMPETITIONS.ucl.accentVar).toBe("--accent-ucl");
  });

  it("files WC26 as the one archived (past) tournament", () => {
    expect(ALL.filter((id) => COMPETITIONS[id].archived)).toEqual(["wc26"]);
  });
  // Untrusted strings (fw_comp cookie, ?competition=, backend fields) are
  // validated before use as a CompetitionId.
  it("validates a string against the competition registry via isCompetitionId", () => {
    expect(isCompetitionId("wc26")).toBe(true);
    expect(isCompetitionId("nope")).toBe(false);
  });

  it("rejects prototype keys (`in` used to accept ?competition=toString)", () => {
    for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(isCompetitionId(key)).toBe(false);
      expect(isWiredCompetition(key)).toBe(false);
      expect(isWiredFootballCompetition(key)).toBe(false);
    }
  });
});

describe("the shell tab template (navTabsFor), direction G", () => {
  it("gives football Matches, Table, My picks, Leaderboard and NRL Matches, Ladder, My tips, Leaderboard", () => {
    for (const id of ["epl", "laliga", "bundesliga", "ucl"] as const) {
      expect(navTabsFor(id).map((t) => t.id)).toEqual(["matches", "table", "mypicks", "leaderboard"]);
      expect(navTabsFor(id).map((t) => t.label)).toEqual(["Matches", "Table", "My picks", "Leaderboard"]);
    }
    expect(navTabsFor("nrl").map((t) => t.label)).toEqual(["Matches", "Ladder", "My tips", "Leaderboard"]);
  });

  it("gives UFC its own namespace", () => {
    expect(competitionInPathname("/ufc")).toBe("ufc");
    expect(competitionInPathname("/ufc/fight/12")).toBe("ufc");
    expect(competitionInPathname("/ufcx")).toBeNull();
    expect(isWiredCompetition("ufc")).toBe(true);
    expect(isWiredFootballCompetition("ufc")).toBe(false);
    expect(competitionsForSport("ufc").map((c) => c.id)).toEqual(["ufc"]);
    expect(COMPETITIONS.ufc).toMatchObject({
      format: "cards",
      hasTips: true,
      logoSrc: null,
      archived: false,
      recordPath: null,
      terms: { fixtures: "Fights", standings: "Rankings" },
    });
  });

  it("gives UFC four tabs: Card, Events, My picks and Leaderboard", () => {
    expect(navTabsFor("ufc").map((t) => [t.id, t.label, t.href])).toEqual([
      ["matches", "Card", "/ufc"],
      ["table", "Events", "/ufc/events"],
      ["mypicks", "My picks", "/ufc/picks"],
      ["leaderboard", "Leaderboard", "/ufc/leaderboard"],
    ]);
    const [card, events, picks, board] = navTabsFor("ufc");
    expect(isNavTabActive(picks, "/ufc/picks")).toBe(true);
    expect(isNavTabActive(board, "/ufc/leaderboard")).toBe(true);
    expect(isNavTabActive(card, "/ufc/picks")).toBe(false);
    for (const p of ["/ufc", "/ufc/event/x-2026-12-05", "/ufc/fight/1", "/ufc/fighter/jiri-prochazka"]) {
      expect(isNavTabActive(card, p)).toBe(true);
    }
    expect(isNavTabActive(card, "/ufc/events")).toBe(false);
    expect(isNavTabActive(events, "/ufc/events")).toBe(true);
    expect(tableTabLabel("ufc")).toBe("Events");
    expect(competitionLinks("ufc")).toEqual({
      home: "/ufc",
      fixtures: "/ufc/events",
      table: "/ufc/events",
      tableLabel: "Events",
      picks: "/ufc/picks",
      picksLabel: "My picks",
      leaderboard: "/ufc/leaderboard",
      bracket: null,
    });
  });

  it("keeps the World Cup's groups and bracket reachable", () => {
    expect(navTabsFor("wc26").map((t) => t.id)).toEqual(["matches", "table", "bracket", "mypicks", "leaderboard"]);
    expect(navTabsFor("wc26").map((t) => t.label)).toEqual(["Matches", "Groups", "Bracket", "My picks", "Leaderboard"]);
  });

  it("words the Table slot per competition: Ladder (NRL), Groups (WC26), Table (rest)", () => {
    expect(tableTabLabel("nrl")).toBe("Ladder");
    expect(tableTabLabel("wc26")).toBe("Groups");
    for (const id of ["epl", "laliga", "bundesliga", "ucl"] as const) {
      expect(tableTabLabel(id)).toBe("Table");
    }
  });

  it.each([
    ["epl", ["/football/epl", "/football/epl/standings", "/play?competition=epl", "/leaderboard?competition=epl"]],
    ["ucl", ["/football/ucl", "/football/ucl/standings", "/play?competition=ucl", "/leaderboard?competition=ucl"]],
    ["wc26", ["/football/wc26", "/football/wc26/groups", "/football/wc26/bracket", "/play?competition=wc26", "/leaderboard?competition=wc26"]],
    ["nrl", ["/nrl", "/nrl/ladder", "/nrl/tips", "/nrl/leaderboard"]],
  ] as const)("routes %s's tabs to its own destinations", (id, hrefs) => {
    expect(navTabsFor(id).map((t) => t.href)).toEqual(hrefs);
  });

  it("links every table tab to a route that exists for that competition", () => {
    // The groups route 404s without hasGroups; standings 404s with it.
    for (const id of ALL) {
      const table = navTabsFor(id).find((t) => t.id === "table")!.href;
      const c = COMPETITIONS[id];
      if (c.sport === "nrl") expect(table).toBe("/nrl/ladder");
      else if (c.sport === "ufc") expect(table).toBe("/ufc/events");
      else expect(table.endsWith(c.hasGroups ? "/groups" : "/standings")).toBe(true);
      expect(competitionLinks(id).table).toBe(table);
    }
  });

  it("lights Matches on the competition home, fixtures and match pages, segment-aware", () => {
    const [matches, table] = navTabsFor("epl");
    expect(isNavTabActive(matches, "/football/epl")).toBe(true);
    expect(isNavTabActive(matches, "/football/epl/fixtures")).toBe(true);
    expect(isNavTabActive(matches, "/football/epl/match/1")).toBe(true);
    expect(isNavTabActive(matches, "/football/epl/matchday")).toBe(false);
    expect(isNavTabActive(matches, "/football/epl/standings")).toBe(false);
    expect(isNavTabActive(table, "/football/epl/standings")).toBe(true);
    expect(isNavTabActive(table, "/football/epl/team/42")).toBe(true);
  });

  it("lights the NRL tabs on their own pages", () => {
    const [matches, ladder, tips, board] = navTabsFor("nrl");
    for (const p of ["/nrl", "/nrl/matches", "/nrl/round/3", "/nrl/record", "/nrl/origin"]) {
      expect(isNavTabActive(matches, p)).toBe(true);
    }
    expect(isNavTabActive(ladder, "/nrl/team/7")).toBe(true);
    expect(isNavTabActive(tips, "/nrl/tips")).toBe(true);
    expect(isNavTabActive(board, "/nrl/leaderboard")).toBe(true);
    expect(isNavTabActive(board, "/nrl/tips")).toBe(false);
  });

  it("lights My picks on /play and Leaderboard on /leaderboard, and nothing on reading pages", () => {
    const tabs = navTabsFor("epl");
    const lit = (p: string) => tabs.filter((t) => isNavTabActive(t, p)).map((t) => t.id);
    expect(lit("/play")).toEqual(["mypicks"]);
    expect(lit("/leaderboard")).toEqual(["leaderboard"]);
    expect(lit("/about")).toEqual([]);
    expect(lit("/")).toEqual([]);
  });

  it("returns stable tab arrays (no per-render allocation)", () => {
    expect(navTabsFor("epl")).toBe(navTabsFor("epl"));
  });
});

describe("competition-aware match hrefs", () => {
  it("reads only wired football competitions from untrusted values", () => {
    expect(asFootballCompetition("laliga")).toBe("laliga");
    expect(asFootballCompetition("nrl")).toBeNull(); // not a /football/ space
    expect(asFootballCompetition("seriea")).toBeNull();
    expect(asFootballCompetition(undefined)).toBeNull();
    expect(asFootballCompetition(7)).toBeNull();
  });

  it("scopes the href when the competition is known, else uses the lookup route", () => {
    expect(footballMatchHrefOrLookup(198, "epl")).toBe("/football/epl/match/198");
    expect(footballMatchHrefOrLookup(198, undefined)).toBe("/match/198");
    expect(footballMatchHrefOrLookup(198, "bogus")).toBe("/match/198");
    // Never guesses WC26.
    expect(footballMatchHrefOrLookup(198, null)).not.toContain("wc26");
  });
});

// The next.config.mjs legacy redirects (/matches, /groups, /brackets,
// /my-bracket) and the /match/:id + /team/:id lookup fallback hard-code
// "/football/wc26/..." as their destination. These assertions guard that
// string against drift -- if COMPETITIONS.wc26.basePath ever changes, this
// fails loudly instead of the redirects quietly 404ing.
describe("wc26 route wiring (guards the redirect destinations)", () => {
  it("wires wc26 as an enabled competition at the expected basePath", () => {
    expect(isWiredCompetition("wc26")).toBe(true);
    expect(COMPETITIONS.wc26.basePath).toBe("/football/wc26");
  });

  it.each([
    "/football/wc26/fixtures",
    "/football/wc26/match/9",
    "/football/wc26/groups",
    "/football/wc26/bracket",
    "/football/wc26/team/3",
  ])("resolves %s to the wc26 competition", (pathname) => {
    expect(competitionFromPathname(pathname)).toBe("wc26");
  });
});
