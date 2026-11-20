/** Direction G surface rules for the legacy component classes in globals.css.
 *
 *  These classes (`.glass` on ~90 files, `.panel-pitch`, the feature chart
 *  ink) used to carry the dark Floodlight gradient and a Daylight override.
 *  In G there is one theme: a card is flat white with a line border and no
 *  shadow, and the old dark "pitch" panel is a soft, light panel. */
import { color, css, parseColor, ratio, token } from "@/lib/__tests__/gTokens.test.helpers";

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
}

it("paints .glass as a flat G card: white, line border, no gradient, no shadow", () => {
  const glass = block(".glass {");
  expect(glass).toContain("background: hsl(var(--surface))");
  expect(glass).toContain("border: 1px solid hsl(var(--border))");
  expect(glass).toContain("box-shadow: none");
  expect(glass).not.toContain("gradient");
});

it("keeps the old gradient foot token white, so nothing fades to a dark band", () => {
  expect(color("surface-grad-end")).toEqual(color("surface"));
});

it("makes .panel-pitch a soft light panel with ink text", () => {
  const panel = block(".panel-pitch {");
  expect(panel).toContain("background: var(--fw-soft)");
  expect(panel).toContain("color: var(--fw-ink)");
  expect(panel).not.toContain("gradient");
  // Components still written for the dark panel (text-white …) are mapped
  // back to ink and muted inside it.
  expect(css).toMatch(/\.panel-pitch \.text-white\s*\{\s*color: var\(--fw-ink\);/);
  expect(css).toMatch(/\.panel-pitch \[class\*="text-white\/"\]\s*\{\s*color: var\(--fw-muted\);/);
});

it("keeps every pitch-panel ink AA-safe on the panel", () => {
  const panel = parseColor(token("fw-soft"));
  for (const ink of ["pitch-foreground-ink", "pitch-muted-ink", "pitch-subtle-ink", "pitch-accent-ink", "pitch-loss-ink"]) {
    expect(ratio(color(ink), panel)).toBeGreaterThanOrEqual(4.5);
  }
  expect(ratio(parseColor(token("pitch-copy")), panel)).toBeGreaterThanOrEqual(4.5);
});

it("keeps the chart axis ink AA-safe on ground and soft", () => {
  const ink = parseColor(token("feature-chart-ink"));
  expect(ratio(ink, parseColor("#ffffff"))).toBeGreaterThanOrEqual(4.5);
  expect(ratio(ink, parseColor(token("fw-soft")))).toBeGreaterThanOrEqual(4.5);
});

it("has no Floodlight glows left", () => {
  expect(block(".floodlight-glow,")).toBeDefined();
  expect(css).toMatch(/\.floodlight-glow-left\s*\{\s*background-image:\s*none;/);
  expect(css).not.toMatch(/radial-gradient/);
});
