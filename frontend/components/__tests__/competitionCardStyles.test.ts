/** Competition cards on the platform home, direction G.
 *
 *  These used to be dark, two-tone "Graphic split" slabs with stripes, a
 *  masked World Cup logo and a lift on hover. In G they are plain light
 *  cards: white, a line border, the real competition logo, ink text, a
 *  border change on hover/focus and no motion. This file replaces the old
 *  Graphic-split contract with the G one. */
import { color, css, parseColor, ratio, token } from "@/lib/__tests__/gTokens.test.helpers";

function rule(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1).replace(/\s+/g, " ");
}

it("paints the card light with ink text and a line border, no shadow", () => {
  const card = rule(".competition-card {");
  expect(card).toContain("color: hsl(var(--competition-card-ink))");
  expect(card).toContain("background: hsl(var(--competition-card-base))");
  expect(card).toContain("border: 1px solid var(--fw-line)");
  expect(card).toContain("box-shadow: none");
  expect(color("competition-card-base").slice(0, 3)).toEqual([255, 255, 255]);
});

it("keeps the card title and its small copy AA-safe", () => {
  const base = color("competition-card-base");
  expect(ratio(color("competition-card-ink"), base)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(color("competition-card-copy"), base)).toBeGreaterThanOrEqual(4.5);
  expect(rule(".competition-card__copy {")).toContain("color: hsl(var(--competition-card-copy))");
});

it("has no per-competition colour slabs, stripes, masks or logo filters", () => {
  expect(css).not.toMatch(/\.competition-card\[data-competition-card=/);
  expect(css).not.toMatch(/\.competition-card::(before|after)/);
  expect(css).not.toMatch(/mask-image/);
  expect(css).not.toMatch(/invert\(1\)/);
});

it("shows hover and keyboard focus the same way: a stronger border, no lift", () => {
  const states = rule(".competition-card:hover,");
  expect(states).toContain(".competition-card:focus-visible");
  expect(states).toContain("border-color: var(--fw-line-strong)");
  expect(css).not.toMatch(/\.competition-card[^{]*\{[^}]*transform:\s*translate/);
});

it("keeps the focus ring visible against the page", () => {
  expect(ratio(color("lime-deep"), parseColor(token("fw-ground")))).toBeGreaterThanOrEqual(3);
});

it("drops card transitions under reduced motion", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(reduced).toMatch(/\.card-hover,\s*\.competition-card\s*\{\s*transition: none;/);
});
