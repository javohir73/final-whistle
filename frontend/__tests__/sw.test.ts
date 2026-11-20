/**
 * @jest-environment node
 *
 * public/sw.js: routing, cache naming/pruning, the 4 s navigation budget with
 * cache/offline fallbacks, navigation preload, LRU caps, and
 * stale-while-revalidate. The worker exports its helpers only under CommonJS,
 * so this loads it as a plain module against an in-memory CacheStorage.
 */
import { readFileSync } from "fs";
import { join } from "path";

// public/sw.js is a classic worker script that exports its helpers only under
// CommonJS, so it is required rather than imported.
const sw = require("../public/sw.js");

class FakeCache {
  entries = new Map<string, Response>();
  key = (req: Request | string) => (typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
  async match(req: Request | string) {
    return this.entries.get(this.key(req))?.clone();
  }
  async put(req: Request | string, res: Response) {
    const k = this.key(req);
    this.entries.delete(k); // Cache API: a re-put moves the key to the end
    this.entries.set(k, res);
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(req: Request | string) {
    return this.entries.delete(this.key(req));
  }
  async addAll(urls: string[]) {
    for (const u of urls) await this.put(u, new Response(`precached ${u}`));
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async match(req: Request | string, opts?: { cacheName?: string }) {
    const names = opts?.cacheName ? [opts.cacheName] : [...this.stores.keys()];
    for (const n of names) {
      const hit = await this.stores.get(n)?.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

const ORIGIN = "https://fifa-wc26-prediction.vercel.app";
const NAMES = sw.cacheNames("4-abc123");
let storage: FakeCacheStorage;
let fetchMock: jest.Mock;

/** A FetchEvent stand-in that records waitUntil promises. */
function fakeEvent(url: string, preload?: Promise<Response | undefined>) {
  const pending: Promise<unknown>[] = [];
  return {
    request: new Request(url),
    preloadResponse: preload ?? Promise.resolve(undefined),
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    settled: () => Promise.all(pending),
  };
}

const html = (body: string, init?: ResponseInit) =>
  new Response(body, { headers: { "content-type": "text/html" }, ...init });
const never = () => new Promise<Response>(() => {});
const later = (res: Response, ms: number) =>
  new Promise<Response>((resolve) => setTimeout(() => resolve(res), ms));

beforeEach(() => {
  storage = new FakeCacheStorage();
  fetchMock = jest.fn();
  Object.assign(globalThis, { caches: storage, fetch: fetchMock });
});

describe("versioning and cache names", () => {
  it("reads the deploy version from the registration URL, defaulting to the schema", () => {
    expect(sw.versionFrom(`${ORIGIN}/sw.js?v=4-abc123`)).toBe("4-abc123");
    expect(sw.versionFrom(`${ORIGIN}/sw.js`)).toBe(sw.SCHEMA);
  });

  it("scopes shell/pages to the deploy and static/assets to the schema", () => {
    expect(NAMES).toEqual({
      shell: "fw-shell-4-abc123",
      pages: "fw-pages-4-abc123",
      static: `fw-static-s${sw.SCHEMA}`,
      assets: `fw-assets-s${sw.SCHEMA}`,
    });
  });

  it("prunes every fw-* cache the current worker doesn't use, and nothing else", () => {
    const existing = [
      "fw-v3", // the pre-rebuild single cache
      "fw-pages-4-olddeploy",
      "fw-shell-4-olddeploy",
      NAMES.shell,
      NAMES.pages,
      NAMES.static,
      NAMES.assets,
      "someone-elses-cache",
    ];
    expect(sw.staleCacheKeys(existing, NAMES)).toEqual([
      "fw-v3",
      "fw-pages-4-olddeploy",
      "fw-shell-4-olddeploy",
    ]);
  });
});

describe("routeFor", () => {
  const route = (path: string, mode = "cors", origin = ORIGIN) =>
    sw.routeFor(new URL(path, origin), mode, ORIGIN);

  it.each([
    ["/football/epl/standings", "navigate", "navigate"],
    ["/_next/static/chunks/1583-abc.js", "cors", "static"],
    ["/_next/static/media/font.woff2", "cors", "static"],
    ["/clubs/arsenal.png", "no-cors", "asset"],
    ["/competitions/epl.svg", "no-cors", "asset"],
    ["/icon-192.png", "no-cors", "asset"],
    ["/backend-api/api/auth/me", "cors", "bypass"],
    ["/backend-api/api/matches/7", "navigate", "bypass"],
    ["/football/epl?_rsc=1x2y", "cors", "bypass"],
    ["/_next/image?url=%2Ficon-192.png&w=96&q=75", "no-cors", "bypass"],
    ["/manifest.webmanifest", "cors", "bypass"],
  ])("%s (%s) -> %s", (path, mode, expected) => {
    expect(route(path, mode)).toBe(expected);
  });

  it("never touches other origins", () => {
    expect(route("/x.png", "no-cors", "https://flagcdn.com")).toBe("bypass");
  });
});

describe("navigate", () => {
  const url = `${ORIGIN}/football/epl/fixtures`;

  it("returns a fast network response and stores it in the pages cache", async () => {
    fetchMock.mockResolvedValue(html("fresh"));
    const event = fakeEvent(url);
    const res = await sw.navigate(event, NAMES, 50);
    expect(await res.text()).toBe("fresh");
    await event.settled();
    expect(await (await storage.match(url, { cacheName: NAMES.pages }))?.text()).toBe("fresh");
  });

  it("uses the navigation-preload response instead of a second request", async () => {
    const event = fakeEvent(url, Promise.resolve(html("preloaded")));
    const res = await sw.navigate(event, NAMES, 50);
    expect(await res.text()).toBe("preloaded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves the cached page when the network blows the time budget, then refreshes it", async () => {
    await (await storage.open(NAMES.pages)).put(url, html("cached"));
    fetchMock.mockReturnValue(later(html("late but fresh"), 60));
    const event = fakeEvent(url);
    const res = await sw.navigate(event, NAMES, 20);
    expect(await res.text()).toBe("cached");
    await event.settled(); // the worker stays alive for the late answer
    expect(await (await storage.match(url, { cacheName: NAMES.pages }))?.text()).toBe("late but fresh");
  });

  it("keeps waiting for a slow network when there is no cached copy", async () => {
    fetchMock.mockReturnValue(later(html("slow"), 40));
    const res = await sw.navigate(fakeEvent(url), NAMES, 10);
    expect(await res.text()).toBe("slow");
  });

  it("falls back to the cached page, then the offline page, when the network fails", async () => {
    await (await storage.open(NAMES.shell)).addAll([sw.OFFLINE_URL]);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const offline = await sw.navigate(fakeEvent(url), NAMES, 50);
    expect(await offline.text()).toBe(`precached ${sw.OFFLINE_URL}`);

    await (await storage.open(NAMES.pages)).put(url, html("last good copy"));
    const cached = await sw.navigate(fakeEvent(url), NAMES, 50);
    expect(await cached.text()).toBe("last good copy");
  });

  it("never caches an error page", async () => {
    fetchMock.mockResolvedValue(html("oops", { status: 500 }));
    const event = fakeEvent(url);
    const res = await sw.navigate(event, NAMES, 50);
    expect(res.status).toBe(500);
    await event.settled();
    expect(await storage.match(url, { cacheName: NAMES.pages })).toBeUndefined();
  });

  it("caps the pages cache at MAX_PAGES, dropping the least recently stored", async () => {
    for (let i = 0; i < sw.MAX_PAGES + 5; i++) {
      fetchMock.mockResolvedValueOnce(html(`page ${i}`));
      const event = fakeEvent(`${ORIGIN}/football/epl/match/${i}`);
      await sw.navigate(event, NAMES, 50);
      await event.settled();
    }
    const keys = await (await storage.open(NAMES.pages)).keys();
    expect(keys).toHaveLength(sw.MAX_PAGES);
    expect(keys[0].url).toBe(`${ORIGIN}/football/epl/match/5`);
  });
});

describe("static and asset strategies", () => {
  it("serves hashed chunks cache-first", async () => {
    const chunk = `${ORIGIN}/_next/static/chunks/main-abc.js`;
    fetchMock.mockResolvedValue(new Response("js"));
    const first = fakeEvent(chunk);
    await sw.cacheFirst(first, NAMES);
    await first.settled();
    const res = await sw.cacheFirst(fakeEvent(chunk), NAMES);
    expect(await res.text()).toBe("js");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers images from cache and refreshes them in the background", async () => {
    const badge = `${ORIGIN}/clubs/arsenal.png`;
    await (await storage.open(NAMES.assets)).put(badge, new Response("old badge"));
    fetchMock.mockResolvedValue(new Response("new badge"));
    const event = fakeEvent(badge);
    const res = await sw.staleWhileRevalidate(event, NAMES);
    expect(await res.text()).toBe("old badge");
    await event.settled();
    expect(await (await storage.match(badge, { cacheName: NAMES.assets }))?.text()).toBe("new badge");
  });

  it("goes to the network for an image it hasn't seen", async () => {
    fetchMock.mockResolvedValue(new Response("first fetch"));
    const res = await sw.staleWhileRevalidate(fakeEvent(`${ORIGIN}/icon-512.png`), NAMES);
    expect(await res.text()).toBe("first fetch");
  });
});

describe("offline.html (precached fallback)", () => {
  const page: string = readFileSync(join(__dirname, "../public/offline.html"), "utf8");

  it("uses the one direction G canvas (white, ink, brand) with no theme boot script", () => {
    expect(page).toMatch(/:root\s*{[^}]*--bg:\s*#ffffff/);
    expect(page).toMatch(/:root\s*{[^}]*--fg:\s*#14181f/);
    expect(page).toMatch(/:root\s*{[^}]*--brand:\s*#0f4d3a/);
    expect(page).toMatch(/<meta name="theme-color" content="#ffffff"/);
    expect(page).not.toContain("fw_theme");
    expect(page).not.toContain("theme-daylight");
    expect(page).not.toMatch(/<script/i);
  });

  it("is sport-neutral (no World Cup bracket copy) and precaches what it shows", () => {
    expect(page).not.toMatch(/bracket/i);
    expect(page).toContain('src="/icon-192.png"');
  });
});
