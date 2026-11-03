/** @jest-environment node */
/** next.config.mjs custom routes, run through Next's own matcher
 *  (unstable_getResponseFromNextConfig): every legacy redirect is ONE hop to
 *  a final URL, /match/:id and /team/:id are no longer static WC26 redirects
 *  (app/match/[id] and app/team/[id] look the competition up), and the embed
 *  keeps its own iframe-able header rule. */
import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";

const ORIGIN = "https://fifa-wc26-prediction.vercel.app";

/** The real config's custom routes. next.config.mjs is native ESM
 *  (import.meta.url), which Jest's CommonJS transform cannot load, so a child
 *  node process imports it and hands back the resolved arrays. */
const routes = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const { default: c } = await import('./next.config.mjs');" +
        "console.log(JSON.stringify({ redirects: await c.redirects(), headers: await c.headers() }));",
    ],
    { cwd: __dirname, encoding: "utf8" },
  ),
);
const nextConfig: NextConfig = {
  redirects: async () => routes.redirects,
  headers: async () => routes.headers,
};

async function route(path: string) {
  return unstable_getResponseFromNextConfig({ url: `${ORIGIN}${path}`, nextConfig });
}

/** Paths that are page routes (not redirects) in this app. */
async function isFinal(path: string) {
  const res = await route(path);
  return getRedirectUrl(res) === null;
}

it.each([
  ["/matches", "/football/wc26/fixtures", 308],
  ["/groups", "/football/wc26/groups", 308],
  ["/groups/3", "/football/wc26/groups/3", 308],
  ["/brackets", "/football/wc26/bracket", 308],
  ["/my-bracket", "/football/wc26/bracket", 307],
  ["/how-it-works", "/about", 308],
])("redirects %s to %s in one hop", async (from, to, status) => {
  const res = await route(from);
  expect(res.status).toBe(status);
  expect(getRedirectUrl(res)).toBe(`${ORIGIN}${to}`);
  // The destination is final: no chain.
  await expect(isFinal(to)).resolves.toBe(true);
});

it.each(["/match/198", "/team/7", "/match/198?utm_source=embed"])(
  "leaves %s to the competition lookup route (no static WC26 redirect)",
  async (path) => {
    await expect(isFinal(path)).resolves.toBe(true);
  },
);

it.each(["/tips", "/football", "/football/epl/bracket", "/nrl/leaderboard"])(
  "has no config-level redirect for %s (handled by its page)",
  async (path) => {
    await expect(isFinal(path)).resolves.toBe(true);
  },
);

it("keeps the embed iframe-able and everything else DENY", async () => {
  const embed = await route("/embed/198");
  expect(embed.headers.get("x-frame-options")).toBeNull();
  const page = await route("/football/epl/match/198");
  expect(page.headers.get("x-frame-options")).toBe("DENY");
  const lookup = await route("/match/198");
  expect(lookup.headers.get("x-frame-options")).toBe("DENY");
});
