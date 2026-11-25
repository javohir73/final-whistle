import {
  getUfcBoutServer, getUfcEventServer, getUfcEventsServer, getUfcFighterServer, getUfcNextEventServer,
} from "@/lib/api";

const mockFetch = (status: number, body: unknown = {}) => {
  const fn = jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};

describe("UFC server fetchers", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["next", () => getUfcNextEventServer(), "/api/ufc/events/next", 120],
    ["event", () => getUfcEventServer("a b/c"), "/api/ufc/events/a%20b%2Fc", 120],
    ["events", () => getUfcEventsServer("past", 5, 10), "/api/ufc/events?when=past&limit=5&offset=10", 300],
    ["events defaults", () => getUfcEventsServer("upcoming"), "/api/ufc/events?when=upcoming&limit=20&offset=0", 300],
    ["bout", () => getUfcBoutServer(42), "/api/ufc/bouts/42", 120],
    ["fighter", () => getUfcFighterServer("x-1"), "/api/ufc/fighters/x-1", 300],
  ] as const)("%s hits the right path and revalidate", async (_n, call, path, revalidate) => {
    const f = mockFetch(200, { ok: true });
    await expect(call()).resolves.toEqual({ ok: true });
    expect(f.mock.calls[0][0]).toMatch(new RegExp(`${path.replace(/[?]/g, "\\?")}$`));
    expect(f.mock.calls[0][1]).toEqual({ next: { revalidate } });
  });

  it("returns null on 404 and throws on other failures", async () => {
    mockFetch(404, { error: { code: "not_found", message: "x" } });
    await expect(getUfcBoutServer(1)).resolves.toBeNull();
    mockFetch(500);
    await expect(getUfcBoutServer(1)).rejects.toThrow();
  });
});
