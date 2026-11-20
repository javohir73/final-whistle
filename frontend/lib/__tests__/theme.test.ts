/** Direction G is the site's ONLY theme.
 *
 *  Replaces the old two-theme tests (Floodlight default + opt-in Daylight
 *  via a `.theme-daylight` class, a `fw_theme` preference and a boot script):
 *  that system is gone, so this file now proves it stays gone and that the
 *  one light palette is the brief's palette and meets WCAG AA. */
import fs from "fs";
import path from "path";
import { color, css, frontendRoot, hexOf, parseColor, ratio, rootScope, token } from "./gTokens.test.helpers";

const G = {
  ground: "#ffffff",
  ink: "#14181f",
  muted: "#5b6470",
  line: "#e4e7e3",
  "line-soft": "#eef0ec",
  soft: "#f6f7f5",
  brand: "#0f4d3a",
  "brand-soft": "#e7f0ec",
  miss: "#8a3324",
  "miss-soft": "#f6ebe8",
};

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

describe("one theme", () => {
  it("has no second theme in the stylesheet", () => {
    expect(css).not.toContain("theme-daylight");
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(rootScope).toContain("color-scheme: light");
  });

  it("has no theme preference, toggle or boot script anywhere in the app", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((d) => sources(path.join(frontendRoot, d)))
      .filter((file) => /fw_theme|theme-daylight|ThemeToggle|LIGHT_CLASS/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(frontendRoot, file));
    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(frontendRoot, "lib/theme.ts"))).toBe(false);
    expect(fs.existsSync(path.join(frontendRoot, "components/ThemeToggle.tsx"))).toBe(false);
  });

  it("does not use Tailwind's dark mode", () => {
    const config = fs.readFileSync(path.join(frontendRoot, "tailwind.config.ts"), "utf8");
    expect(config).not.toMatch(/darkMode/);
  });

  it("paints the browser chrome white", () => {
    const layout = fs.readFileSync(path.join(frontendRoot, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/themeColor:\s*"#ffffff"/);
    expect(layout).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("the direction G palette", () => {
  it.each(Object.entries(G))("--fw-%s is %s", (name, hex) => {
    expect(token(`fw-${name}`).toLowerCase()).toBe(hex);
  });

  it("exposes the same values to Tailwind under the same names", () => {
    const config = fs.readFileSync(path.join(frontendRoot, "tailwind.config.ts"), "utf8");
    for (const [name, hex] of Object.entries(G)) {
      const key = name.includes("-") ? `"${name}"` : name;
      expect(config).toMatch(new RegExp(`${key}:\\s*"${hex}"`));
    }
  });

  it.each([
    ["background", "ground"],
    ["surface", "ground"],
    ["surface-2", "soft"],
    ["foreground", "ink"],
    ["muted", "muted"],
    ["border", "line"],
    ["win", "brand"],
    ["accent", "brand"],
    ["lime-deep", "brand"],
    ["loss", "miss"],
  ] as const)("re-points the legacy --%s token at %s", (legacy, g) => {
    expect(hexOf(color(legacy))).toBe(G[g]);
  });

  it("has no lime, amber or gold left in the legacy tokens", () => {
    for (const name of ["win", "draw", "gold", "accent", "lime-deep", "amber-ink", "gold-ink", "gold-wash-ink"]) {
      const [r, g, b] = color(name);
      // Lime/amber/gold are bright and saturated toward yellow-green or orange:
      // every one of them has a high red+green sum. G's tones are all dark.
      expect(r + g).toBeLessThan(260);
      expect(b).toBeLessThan(200);
    }
  });
});

describe("WCAG AA for the G text pairs", () => {
  const hex = (h: string) => parseColor(h);
  const white = hex("#ffffff");
  it.each([
    ["ink on ground", G.ink, G.ground],
    ["ink on soft", G.ink, G.soft],
    ["muted on ground", G.muted, G.ground],
    ["muted on soft", G.muted, G.soft],
    ["muted on the chip neutral", G.muted, "#f2f4f1"],
    ["brand on ground", G.brand, G.ground],
    ["brand on brand-soft (right result chip)", G.brand, G["brand-soft"]],
    ["white on brand (buttons, exact-score chip)", "#ffffff", G.brand],
    ["white on brand hover", "#ffffff", "#0b3d2e"],
    ["white on ink (score box)", "#ffffff", G.ink],
    ["miss on miss-soft (missed chip)", G.miss, G["miss-soft"]],
    ["miss on ground", G.miss, G.ground],
  ])("%s clears 4.5:1", (_label, fg, bg) => {
    expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the brand focus ring at 3:1 or more against the page", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid hsl\(var\(--lime-deep\)\);/);
    expect(ratio(color("lime-deep"), white)).toBeGreaterThanOrEqual(3);
  });
});
