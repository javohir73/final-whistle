import fs from "fs";
import path from "path";
import { COMPETITIONS } from "@/lib/sports";

type Hsl = [number, number, number];
type Rgb = [number, number, number];
type StyleRule = { selectors: string[]; declarations: string };

const rootPath = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(rootPath, "app/globals.css"), "utf8");

function block(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Missing ${marker}`);
  const openingBrace = source.indexOf("{", start);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Unclosed ${marker}`);
}

function compact(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

function rule(selector: string, source = css): string {
  return compact(block(source, selector));
}

function styleRules(source: string): StyleRule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return Array.from(withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .map((match) => ({
      selectors: match[1].split(",").map((item) => item.trim()),
      declarations: match[2],
    }));
}

function winningColorToken(selector: string): string {
  const colors = styleRules(css)
    .filter((item) => item.selectors.includes(selector))
    .flatMap((item) =>
      Array.from(
        item.declarations.matchAll(/(?:^|;)\s*color:\s*([^;]+)/g),
        (match) => ({
          value: match[1].replace(/\s*!important\s*$/, "").trim(),
          important: /\s!important\s*$/.test(match[1]),
        }),
      ),
    );
  if (colors.length === 0) throw new Error(`Missing color declaration in ${selector}`);
  if (colors.some((color) => color.important)) {
    throw new Error(`Unexpected !important color declaration in ${selector}`);
  }

  const winner = colors.at(-1)!;
  const tokenMatch = winner.value.match(/^hsl\(var\(--([\w-]+)\)\)$/);
  if (!tokenMatch) throw new Error(`Winning ${selector} color is not token-backed`);
  return tokenMatch[1];
}

function token(scope: string, name: string): string {
  const match = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing --${name}`);
  return match[1].trim();
}

function themedToken(theme: string, name: string): string {
  const override = theme.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return override ? override[1].trim() : token(root, name);
}

function hslChannels(value: string): Hsl {
  const match = value.match(/^(\d+)\s+(\d+)%\s+(\d+)%$/);
  if (!match) throw new Error(`Unsupported HSL token: ${value}`);
  const [, rawHue, rawSaturation, rawLightness] = match;
  return [Number(rawHue), Number(rawSaturation), Number(rawLightness)];
}

function hslToRgb([hue, rawSaturation, rawLightness]: Hsl): Rgb {
  const saturation = rawSaturation / 100;
  const lightness = rawLightness / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = lightness - chroma / 2;
  let channels: Rgb;
  if (hue < 60) channels = [chroma, secondary, 0];
  else if (hue < 120) channels = [secondary, chroma, 0];
  else if (hue < 180) channels = [0, chroma, secondary];
  else if (hue < 240) channels = [0, secondary, chroma];
  else if (hue < 300) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];
  return channels.map((channel) => (channel + offset) * 255) as Rgb;
}

function hsl(value: string): Rgb {
  return hslToRgb(hslChannels(value));
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((raw) => {
    const channel = raw / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const root = rule(":root {");
const daylight = rule(".theme-daylight {");
const registeredCompetitions = Object.values(COMPETITIONS);

it("defines the Graphic split card source contract", () => {
  expect(root).toMatch(/--accent-wc26:\s*42 72% 52%/);
  expect(root).toMatch(/--competition-card-base:\s*150 34% 8%/);
  expect(root).toMatch(/--competition-card-ink:\s*0 0% 100%/);
  expect(daylight).not.toMatch(/--competition-card-(?:base|ink):/);

  expect(rule(".competition-card {")).toContain(
    "background: hsl(var(--competition-card-deep))",
  );
  expect(rule(".competition-card::before {")).toContain(
    "background: hsl(var(--competition-card-accent))",
  );
  expect(rule(".competition-card__copy {")).toContain(
    "color: hsl(var(--competition-card-ink) / 0.72)",
  );
  expect(css).toContain(".competition-card:focus-visible");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});

it("matches the approved compact Graphic split palette, geometry, and texture", () => {
  const tones = {
    epl: ["283 59% 41%", "283 61% 17%"],
    laliga: ["6 100% 64%", "350 64% 33%"],
    bundesliga: ["355 87% 52%", "356 77% 28%"],
    ucl: ["226 79% 47%", "227 83% 19%"],
    wc26: ["226 65% 61%", "227 57% 34%"],
    nrl: ["174 60% 40%", "174 71% 18%"],
  } as const;

  for (const [competition, [accent, deep]] of Object.entries(tones)) {
    const toneRule = rule(
      `.competition-card[data-competition-card="${competition}"] {`,
    );
    expect(token(toneRule, "competition-card-accent")).toBe(accent);
    expect(token(toneRule, "competition-card-deep")).toBe(deep);
  }

  expect(rule(".competition-card {")).toContain(
    "background: hsl(var(--competition-card-deep))",
  );

  const accentField = rule(".competition-card::before {");
  expect(accentField).toContain("inset: -30% -20% 26% -34%");
  expect(accentField).toContain("transform: rotate(-13deg)");
  expect(accentField).not.toContain("clip-path");

  const texture = rule(".competition-card::after {");
  expect(texture).toContain("repeating-linear-gradient(135deg");
  expect(texture).toContain("hsl(var(--competition-card-ink) / 0.035)");

  const hoverAccent = rule(
    ".competition-card:hover::before {",
    block(css, "@media (hover: hover) and (pointer: fine) {")
  );
  expect(hoverAccent).toContain("transform: rotate(-9deg) scale(1.06)");
});

it.each(
  [
    { name: "Floodlight", scope: root },
    { name: "Daylight", scope: daylight },
  ].flatMap((theme) =>
    registeredCompetitions.map((competition) => ({ theme, competition })),
  ),
)(
  "keeps the $competition.id resting boundary at 3:1 in $theme.name",
  ({ theme, competition }) => {
    const toneRule = rule(
      `.competition-card[data-competition-card="${competition.id}"] {`,
    );
    const fill = hsl(token(toneRule, "competition-card-deep"));
    const renderedBorder = hsl(token(toneRule, "competition-card-boundary"));
    const canvas = hsl(themedToken(theme.scope, "background"));

    expect(ratio(renderedBorder, fill)).toBeGreaterThanOrEqual(3);
    expect(Math.max(ratio(renderedBorder, canvas), ratio(fill, canvas))).toBeGreaterThanOrEqual(3);
  },
);

it("keeps all positive hover motion inside the precise-pointer query", () => {
  const precisePointer = block(css, "@media (hover: hover) and (pointer: fine) {");
  const transforms = new Map([
    [".competition-card:hover {", "transform: translateY(-7px) scale(1.015)"],
    [".competition-card:hover::before {", "transform: rotate(-9deg) scale(1.06)"],
    [
      ".competition-card:hover [data-competition-logo] {",
      "transform: translateY(-2px) scale(1.08) rotate(-2deg)",
    ],
    [
      ".competition-card:hover .competition-card__arrow {",
      "transform: translateX(4px)",
    ],
  ]);

  for (const [selector, transform] of transforms) {
    expect(rule(selector, precisePointer)).toContain(transform);
  }
});

it("has no positive hover transforms outside the precise-pointer query", () => {
  const precisePointer = block(css, "@media (hover: hover) and (pointer: fine) {");
  const outsidePrecisePointer = css.replace(precisePointer, "");
  const violations = styleRules(outsidePrecisePointer).flatMap((item) =>
    item.selectors
      .filter((selector) => selector.includes(".competition-card:hover"))
      .flatMap((selector) =>
        Array.from(
          item.declarations.matchAll(
            /(?:^|;)\s*(transform|translate|scale|rotate):\s*([^;]+)/g,
          ),
          (match) => ({ selector, property: match[1], value: match[2].trim() }),
        ).filter(({ value }) => !/^none(?:\s*!important)?$/.test(value)),
      ),
  );

  expect(violations).toEqual([]);
});

it("neutralizes every card transition and interaction transform for reduced motion", () => {
  const reducedMotion = block(css, "@media (prefers-reduced-motion: reduce) {");
  const transitionReset = rule(".competition-card,", reducedMotion);
  const transformReset = rule(".competition-card:hover,", reducedMotion);

  for (const selector of [
    ".competition-card",
    ".competition-card::before",
    ".competition-card [data-competition-logo]",
    ".competition-card .competition-card__arrow",
  ]) {
    expect(transitionReset).toContain(selector);
  }
  expect(transitionReset).toContain("transition: none");

  for (const selector of [
    ".competition-card:hover",
    ".competition-card:focus-visible",
    ".competition-card:hover::before",
    ".competition-card:focus-visible::before",
    ".competition-card:hover [data-competition-logo]",
    ".competition-card:focus-visible [data-competition-logo]",
    ".competition-card:hover .competition-card__arrow",
    ".competition-card:focus-visible .competition-card__arrow",
  ]) {
    expect(transformReset).toContain(selector);
  }
  expect(transformReset).toContain("transform: none");
});

it("keeps the wide NRL split distinct while matching hover and focus motion", () => {
  const wide = rule(".competition-card--wide::before {");
  const hover = rule(
    ".competition-card--wide:hover::before {",
    block(css, "@media (hover: hover) and (pointer: fine) {")
  );
  const focus = rule(".competition-card--wide:focus-visible::before {");

  expect(wide).toContain("inset: -70% 58% -70% -18%");
  expect(wide).toContain("transform: rotate(-8deg)");
  expect(hover).toContain("transform: rotate(-4deg) scale(1.06)");
  expect(focus).toEqual(hover.replace(":hover", ":focus-visible"));
});

it("keeps effective card copy and arrow ink AA-safe across every accent surface", () => {
  const cardInkToken = winningColorToken(".competition-card");
  const arrowInkToken = winningColorToken(".competition-card__arrow");
  const cardInk = hsl(token(root, cardInkToken));
  const arrowInk = hsl(token(root, arrowInkToken));

  expect(cardInkToken).toBe("competition-card-ink");
  expect(arrowInkToken).toBe("competition-card-ink");

  expect(rule(".competition-card__arrow {")).toContain(
    "background: hsl(var(--competition-card-ink) / 0.12)",
  );
  expect(
    rule(
      ".competition-card:hover .competition-card__arrow {",
      block(css, "@media (hover: hover) and (pointer: fine) {"),
    ),
  ).toContain("background: hsl(var(--competition-card-ink) / 0.22)");

  for (const competition of registeredCompetitions) {
    const toneRule = rule(
      `.competition-card[data-competition-card="${competition.id}"] {`,
    );
    const accent = hsl(token(toneRule, "competition-card-accent"));
    const deep = hsl(token(toneRule, "competition-card-deep"));

    expect(ratio(cardInk, deep)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(cardInk, accent)).toBeGreaterThanOrEqual(3);
    expect(ratio(arrowInk, accent)).toBeGreaterThanOrEqual(3);
  }
});

it("keeps the offset card focus indicator visible in both themes", () => {
  const focusRule = rule(":focus-visible {");
  const bodyRule = rule("body {");
  const focusToken = focusRule.match(/outline:\s*2px solid hsl\(var\(--([\w-]+)\)\)/)?.[1];
  const backdropToken = bodyRule.match(/background-color:\s*hsl\(var\(--([\w-]+)\)\)/)?.[1];

  expect(focusRule).toContain("outline-offset: 2px");
  expect(focusToken).toBeDefined();
  expect(backdropToken).toBeDefined();
  for (const theme of [root, daylight]) {
    expect(
      ratio(hsl(themedToken(theme, focusToken!)), hsl(themedToken(theme, backdropToken!))),
    ).toBeGreaterThanOrEqual(3);
  }
});

it("gives keyboard focus the same card affordance as hover, not just an outline", () => {
  // The outline test above proves the focus RING is visible. This proves the
  // card itself reacts identically — the lift, the accent border and the wedge
  // scale. The two rule sets sit ~25 lines apart and neither references the
  // other, so a change to the hover treatment can silently leave keyboard
  // users on the old one.
  //
  // Confirmed in a browser before being pinned: after a real Tab press,
  // :focus-visible matched and the card moved to translateY(-6px), border
  // alpha 0.52 -> 0.84, wedge scale(1.055) rotate(-1.5deg) — identical to the
  // hovered card measured alongside it.
  const hover = rule(".competition-card:hover {");
  const focus = rule(".competition-card:focus-visible {");
  for (const property of ["transform", "border-color", "box-shadow", "filter"]) {
    const declaration = new RegExp(`${property}:\\s*([^;]+)`);
    const hoverValue = hover.match(declaration)?.[1];
    const focusValue = focus.match(declaration)?.[1];
    expect(hoverValue).toBeDefined();
    expect(focusValue).toBe(hoverValue);
  }
  expect(rule(".competition-card:focus-visible::before {")).toEqual(
    rule(".competition-card:hover::before {").replace(":hover", ":focus-visible"),
  );
});

it("leaves focused competition cards on their rounded-2xl shape", () => {
  // Unlayered author styles outrank normal declarations inside Tailwind's
  // component/utility layers, regardless of selector specificity. Any
  // unlayered radius that still applies to the card therefore becomes the
  // browser's effective focus radius instead of rounded-2xl.
  const unlayered = css.replace(block(css, "@layer components {"), "");
  const cardFocusRadiusOverrides = styleRules(unlayered).flatMap((item) =>
    item.selectors
      .filter(
        (selector) =>
          selector.includes(":focus-visible") &&
          !selector.includes(":not(.competition-card)"),
      )
      .flatMap((selector) =>
        Array.from(
          item.declarations.matchAll(/(?:^|;)\s*border-radius:\s*([^;]+)/g),
          (match) => ({ selector, value: match[1].trim() }),
        ),
      ),
  );

  expect(cardFocusRadiusOverrides).toEqual([]);
  expect(rule(":focus-visible:not(.competition-card) {")).toContain(
    "border-radius: 6px",
  );
});

it("gives keyboard focus the same logo transform as hover", () => {
  const hover = rule(".competition-card:hover [data-competition-logo] {");
  const focus = rule(".competition-card:focus-visible [data-competition-logo] {");
  const hoverTransform = hover.match(/transform:\s*([^;]+)/)?.[1];
  const focusTransform = focus.match(/transform:\s*([^;]+)/)?.[1];

  expect(hoverTransform).toBeDefined();
  expect(focusTransform).toBe(hoverTransform);
});

it("gives keyboard focus the same arrow transform and surface emphasis as hover", () => {
  const hover = rule(".competition-card:hover .competition-card__arrow {");
  const focus = rule(".competition-card:focus-visible .competition-card__arrow {");

  for (const property of ["transform", "background", "border-color"]) {
    const declaration = new RegExp(`${property}:\\s*([^;]+)`);
    const hoverValue = hover.match(declaration)?.[1];
    const focusValue = focus.match(declaration)?.[1];
    expect(hoverValue).toBeDefined();
    expect(focusValue).toBe(hoverValue);
  }
});

it("keeps focus-visible outside the precise-pointer query", () => {
  // Hover is guarded by (hover: hover) and (pointer: fine) so a touch tap does
  // not latch the lifted state. Focus must NOT share that guard, or a keyboard
  // user on a touchscreen laptop loses the affordance entirely.
  const hoverIndex = css.indexOf(".competition-card:hover {");
  const focusIndex = css.indexOf(".competition-card:focus-visible {");
  const guardStart = css.lastIndexOf("@media (hover: hover) and (pointer: fine)", hoverIndex);
  expect(guardStart).toBeGreaterThan(-1);
  const guardEnd = guardStart + block(css, "@media (hover: hover) and (pointer: fine)").length;
  expect(focusIndex).toBeGreaterThan(guardEnd);
});
