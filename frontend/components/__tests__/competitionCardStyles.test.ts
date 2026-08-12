import fs from "fs";
import path from "path";

type Hsl = [number, number, number];
type Rgb = [number, number, number];

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

function mixHsl(accent: Hsl, base: Hsl, accentWeight: number): Hsl {
  const hueDelta = ((accent[0] - base[0] + 540) % 360) - 180;
  return [
    (base[0] + hueDelta * accentWeight + 360) % 360,
    base[1] + (accent[1] - base[1]) * accentWeight,
    base[2] + (accent[2] - base[2]) * accentWeight,
  ];
}

function composite(foreground: Rgb, background: Rgb, opacity: number): Rgb {
  return foreground.map(
    (channel, index) => channel * opacity + background[index] * (1 - opacity),
  ) as Rgb;
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
const competitionAccents = ["epl", "laliga", "bundesliga", "ucl", "wc26", "nrl"];

it("defines the Graphic split card source contract", () => {
  expect(root).toMatch(/--accent-wc26:\s*42 72% 52%/);
  expect(root).toMatch(/--competition-card-base:\s*150 34% 8%/);
  expect(root).toMatch(/--competition-card-ink:\s*120 14% 96%/);
  expect(root).toMatch(/--competition-card-copy:\s*126 14% 82%/);
  expect(daylight).not.toMatch(/--competition-card-(?:base|ink|copy):/);

  expect(rule(".competition-card {")).toContain(
    "color-mix(in hsl, hsl(var(--competition-card-accent)) 18%, hsl(var(--competition-card-base)))",
  );
  expect(rule(".competition-card::before {")).toContain(
    "background: hsl(var(--competition-card-accent))",
  );
  expect(rule(".competition-card--wide::before {")).toContain("clip-path");
  expect(rule(".competition-card__copy {")).toContain(
    "color: hsl(var(--competition-card-copy))",
  );
  expect(css).toContain(".competition-card:focus-visible");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});

it("keeps all positive hover motion inside the precise-pointer query", () => {
  const precisePointer = block(css, "@media (hover: hover) and (pointer: fine) {");
  const transforms = new Map([
    [".competition-card:hover {", "transform: translateY(-6px)"],
    [".competition-card:hover::before {", "transform: scale(1.055) rotate(-1.5deg)"],
    [
      ".competition-card:hover [data-competition-logo] {",
      "transform: translateY(-3px) scale(1.055)",
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

it("keeps the wide accent field within the logo at every card padding", () => {
  const wideRule = rule(".competition-card--wide::before {");
  const xCoordinates = Array.from(wideRule.matchAll(/(\d+)px/g), (match) => Number(match[1]));
  const inset = Number(rule(".competition-card::before {").match(/inset:\s*(-?\d+)px/)?.[1]);
  const paintedEdge = Math.max(...xCoordinates) + inset;
  const logoSize = 64;

  expect(xCoordinates).not.toHaveLength(0);
  for (const padding of [20, 28]) {
    const logoEdge = padding + logoSize;
    const copyStart = logoEdge + 16;
    expect(paintedEdge).toBeLessThanOrEqual(logoEdge);
    expect(paintedEdge).toBeLessThan(copyStart);
  }
});

it("keeps effective card copy and arrow ink AA-safe across every accent surface", () => {
  const baseHsl = hslChannels(token(root, "competition-card-base"));
  const base = hslToRgb(baseHsl);
  const ink = hsl(token(root, "competition-card-ink"));
  const copy = hsl(token(root, "competition-card-copy"));

  expect(rule(".competition-card__arrow {")).toContain(
    "background: hsl(var(--competition-card-base) / 0.58)",
  );
  expect(
    rule(
      ".competition-card:hover .competition-card__arrow {",
      block(css, "@media (hover: hover) and (pointer: fine) {"),
    ),
  ).toContain("background: hsl(var(--competition-card-base) / 0.74)");

  for (const accentName of competitionAccents) {
    const accentHsl = hslChannels(token(root, `accent-${accentName}`));
    const accent = hslToRgb(accentHsl);
    const mixedSurface = hslToRgb(mixHsl(accentHsl, baseHsl, 0.18));

    expect(ratio(ink, mixedSurface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(copy, mixedSurface)).toBeGreaterThanOrEqual(4.5);
    for (const arrowOpacity of [0.58, 0.74]) {
      expect(ratio(ink, composite(base, accent, arrowOpacity))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(ink, composite(base, mixedSurface, arrowOpacity))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
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
