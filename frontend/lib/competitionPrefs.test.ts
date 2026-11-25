import {
  COMPETITION_CHANGE_EVENT,
  COMPETITION_COOKIE,
  clearCompetitionCookie,
  competitionForCountry,
  canRemember,
  competitionToRemember,
  migratePinnedCompetition,
  parseCompetition,
  readCompetitionCookie,
  resolveCompetition,
  subscribeCompetitionCookie,
  writeCompetitionCookie,
} from "@/lib/competitionPrefs";

const LEGACY_PIN = "fw_pinned_comp";

/** jsdom keeps cookies across tests; expire ours explicitly. */
function resetCookie() {
  document.cookie = `${COMPETITION_COOKIE}=; Max-Age=0; Path=/`;
}

beforeEach(() => {
  resetCookie();
  window.localStorage.clear();
});

describe("parseCompetition", () => {
  it("accepts registry ids only", () => {
    expect(parseCompetition("nrl")).toBe("nrl");
    expect(parseCompetition("epl")).toBe("epl");
    expect(parseCompetition("bogus")).toBeNull();
    expect(parseCompetition("")).toBeNull();
    expect(parseCompetition(null)).toBeNull();
    expect(parseCompetition(undefined)).toBeNull();
  });

  it("rejects prototype keys a tampered cookie or query could carry", () => {
    // `"toString" in COMPETITIONS` is true -- the old `in` check let it through.
    expect(parseCompetition("toString")).toBeNull();
    expect(parseCompetition("__proto__")).toBeNull();
    expect(parseCompetition("constructor")).toBeNull();
  });
});

describe("resolveCompetition: cookie -> country -> EPL, never WC26", () => {
  it("prefers a valid cookie over the country", () => {
    expect(resolveCompetition({ cookie: "laliga", country: "AU" })).toBe("laliga");
  });

  it.each([
    ["AU", "nrl"],
    ["NZ", "nrl"],
    ["nz", "nrl"],
    ["GB", "epl"],
    ["US", "epl"],
    [null, "epl"],
    [undefined, "epl"],
  ])("maps country %s to %s", (country, expected) => {
    expect(competitionForCountry(country)).toBe(expected);
    expect(resolveCompetition({ cookie: null, country })).toBe(expected);
  });

  it("ignores an invalid cookie and falls through to geo", () => {
    expect(resolveCompetition({ cookie: "bogus", country: "AU" })).toBe("nrl");
  });

  it("never invents WC26 as a default", () => {
    for (const country of ["AU", "GB", "US", "QA", "", null]) {
      expect(resolveCompetition({ cookie: null, country })).not.toBe("wc26");
    }
  });

  it("still honours WC26 when the visitor chose it (cookie)", () => {
    expect(resolveCompetition({ cookie: "wc26", country: "GB" })).toBe("wc26");
  });
});

describe("competitionToRemember: what a URL makes the remembered competition", () => {
  it("remembers a live competition named by the path, over any query", () => {
    expect(competitionToRemember("laliga", null)).toBe("laliga");
    expect(competitionToRemember("nrl", "epl")).toBe("nrl");
  });

  it("never remembers an archived competition reached by its path", () => {
    expect(competitionToRemember("wc26", null)).toBeNull();
    // The path scopes the page, so its query is not a choice either.
    expect(competitionToRemember("wc26", "laliga")).toBeNull();
  });

  it("remembers an explicit ?competition= on an unscoped route, archive included", () => {
    expect(competitionToRemember(null, "wc26")).toBe("wc26");
    expect(competitionToRemember(null, "ucl")).toBe("ucl");
  });

  it("changes nothing on an unscoped route without a query", () => {
    expect(competitionToRemember(null, null)).toBeNull();
  });
});

describe("fw_comp cookie (client)", () => {
  it("returns null when unset", () => {
    expect(readCompetitionCookie()).toBeNull();
  });

  it("round-trips a competition", () => {
    writeCompetitionCookie("nrl");
    expect(readCompetitionCookie()).toBe("nrl");
    expect(document.cookie).toContain(`${COMPETITION_COOKIE}=nrl`);
  });

  it("finds the cookie among others", () => {
    document.cookie = "fw_other=1; Path=/";
    writeCompetitionCookie("ucl");
    document.cookie = "fw_theme=light; Path=/";
    expect(readCompetitionCookie()).toBe("ucl");
    document.cookie = "fw_other=; Max-Age=0; Path=/";
    document.cookie = "fw_theme=; Max-Age=0; Path=/";
  });

  it("treats a tampered value as unset", () => {
    document.cookie = `${COMPETITION_COOKIE}=toString; Path=/`;
    expect(readCompetitionCookie()).toBeNull();
  });

  it("clears", () => {
    writeCompetitionCookie("epl");
    clearCompetitionCookie();
    expect(readCompetitionCookie()).toBeNull();
  });

  it("notifies subscribers on write and clear, and unsubscribes", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCompetitionCookie(listener);
    writeCompetitionCookie("bundesliga");
    clearCompetitionCookie();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    window.dispatchEvent(new Event(COMPETITION_CHANGE_EVENT));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("migratePinnedCompetition (old localStorage star -> cookie)", () => {
  it("moves a valid pin into the cookie on an unscoped route and deletes the key", () => {
    writeCompetitionCookie("epl"); // e.g. middleware's geo default on first load
    window.localStorage.setItem(LEGACY_PIN, "nrl");
    migratePinnedCompetition(null);
    expect(readCompetitionCookie()).toBe("nrl");
    expect(window.localStorage.getItem(LEGACY_PIN)).toBeNull();
  });

  it("lets the URL win on a competition route but still retires the key", () => {
    writeCompetitionCookie("laliga"); // middleware already followed the URL
    window.localStorage.setItem(LEGACY_PIN, "nrl");
    migratePinnedCompetition("laliga");
    expect(readCompetitionCookie()).toBe("laliga");
    expect(window.localStorage.getItem(LEGACY_PIN)).toBeNull();
  });

  it("drops an invalid pin without touching the cookie", () => {
    writeCompetitionCookie("epl");
    window.localStorage.setItem(LEGACY_PIN, "bogus");
    migratePinnedCompetition(null);
    expect(readCompetitionCookie()).toBe("epl");
    expect(window.localStorage.getItem(LEGACY_PIN)).toBeNull();
  });

  it("is a no-op when there is nothing to migrate", () => {
    migratePinnedCompetition(null);
    expect(readCompetitionCookie()).toBeNull();
  });

  it("survives storage that throws (Safari private mode)", () => {
    const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => migratePinnedCompetition(null)).not.toThrow();
    spy.mockRestore();
  });
});

describe("canRemember: UFC has no picks game, so it is never the remembered competition", () => {
  it("refuses UFC and allows every other competition", () => {
    expect(canRemember("ufc")).toBe(false);
    expect(canRemember("nrl")).toBe(true);
    expect(canRemember("epl")).toBe(true);
  });

  it("makes a UFC URL or ?competition=ufc remember nothing", () => {
    expect(competitionToRemember("ufc", null)).toBeNull();
    expect(competitionToRemember(null, "ufc")).toBeNull();
    expect(competitionToRemember("ufc", "epl")).toBeNull();
  });
});
