import fs from "fs";
import path from "path";

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

it("keeps the vertical accent field on the logo and clear of copy at rest and hover", () => {
  const clipPath = rule(".competition-card::before {").match(
    /clip-path:\s*polygon\(0 0,\s*100% 0,\s*62% (\d+)px,\s*0 (\d+)px\)/,
  );

  expect(clipPath).not.toBeNull();
  if (!clipPath) return;

  const [, rawDiagonalY, rawLeadingY] = clipPath;
  const diagonalY = Number(rawDiagonalY);
  const leadingY = Number(rawLeadingY);
  const inset = Number(rule(".competition-card::before {").match(/inset:\s*(-?\d+)px/)?.[1]);
  const hoverRule = rule(
    ".competition-card:hover::before {",
    block(css, "@media (hover: hover) and (pointer: fine) {")
  );
  const scale = Number(hoverRule.match(/scale\(([\d.]+)\)/)?.[1]);
  const angle = Number(hoverRule.match(/rotate\((-?[\d.]+)deg\)/)?.[1]);
  const radians = (angle * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  // PlatformHome's p-5, 50px logo and mt-8 establish these content bounds.
  // The widths cover the narrowest five-column card and the phone/tablet cards.
  const logoRight = 20 + 50;
  const logoBottom = 20 + 50;
  const copyLeft = 20;
  const copyTop = 20 + 50 + 32;

  for (const cardWidth of [210, 288, 358]) {
    const diagonalX = cardWidth * 0.62;
    const slope = (diagonalY - leadingY) / diagonalX;
    const boundaryAt = (x: number) => leadingY + slope * x;
    const transformedBoundaryAt = (x: number) => {
      const sourceX = (x / scale + sine * leadingY) / (cosine - sine * slope);
      const sourceY = boundaryAt(sourceX);
      return inset + scale * (sine * sourceX + cosine * sourceY);
    };

    expect(inset + boundaryAt(logoRight)).toBeGreaterThanOrEqual(logoBottom);
    expect(inset + boundaryAt(copyLeft)).toBeLessThan(copyTop);
    expect(transformedBoundaryAt(logoRight)).toBeGreaterThanOrEqual(logoBottom);
    expect(transformedBoundaryAt(copyLeft)).toBeLessThan(copyTop);
  }
});

it("keeps effective card copy and arrow ink AA-safe across every accent surface", () => {
  const baseHsl = hslChannels(token(root, "competition-card-base"));
  const base = hslToRgb(baseHsl);
  const cardInkToken = winningColorToken(".competition-card");
  const copyToken = winningColorToken(".competition-card__copy");
  const arrowInkToken = winningColorToken(".competition-card__arrow");
  const cardInk = hsl(token(root, cardInkToken));
  const copy = hsl(token(root, copyToken));
  const arrowInk = hsl(token(root, arrowInkToken));

  expect(cardInkToken).toBe("competition-card-ink");
  expect(copyToken).toBe("competition-card-copy");
  expect(arrowInkToken).toBe("competition-card-ink");

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

    expect(ratio(cardInk, mixedSurface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(copy, mixedSurface)).toBeGreaterThanOrEqual(4.5);
    for (const arrowOpacity of [0.58, 0.74]) {
      expect(ratio(arrowInk, composite(base, accent, arrowOpacity))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        ratio(arrowInk, composite(base, mixedSurface, arrowOpacity)),
      ).toBeGreaterThanOrEqual(4.5);
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
  for (const declaration of ["transform: translateY(-6px)", "border-color:", "box-shadow:"]) {
    expect(hover).toContain(declaration);
    expect(focus).toContain(declaration);
  }
  expect(rule(".competition-card:focus-visible::before {")).toEqual(
    rule(".competition-card:hover::before {").replace(":hover", ":focus-visible"),
  );
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
