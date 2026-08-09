/** The theme system's one structural rule: every colour a surface paints with
 *  must come from a token, so swapping :root for .theme-daylight re-themes the
 *  whole UI. A literal baked into a gradient does not switch — .glass shipped
 *  with a hardcoded near-black foot, and under daylight every card faded to
 *  black with unreadable text at the bottom. These read the stylesheet as text
 *  (jsdom applies no Tailwind/PostCSS) and fail if that class of orphan
 *  returns. */
import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`${selector} not found in globals.css`);
  return css.slice(start, css.indexOf("}", start));
}

function tokenHex(selector: string, token: string): string {
  const match = block(selector).match(new RegExp(`--${token}:\\s*(#[\\da-fA-F]{6})`));
  expect(match).not.toBeNull();
  return match![1].toLowerCase();
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: number[]): number {
  const [red, green, blue] = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hsl(hue: number, saturation: number, lightness: number): number[] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  let channels: number[];
  if (hue < 60) channels = [chroma, secondary, 0];
  else if (hue < 120) channels = [secondary, chroma, 0];
  else if (hue < 180) channels = [0, chroma, secondary];
  else if (hue < 240) channels = [0, secondary, chroma];
  else if (hue < 300) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];
  const [red, green, blue] = channels;
  return [red + offset, green + offset, blue + offset].map((value) => value * 255);
}

function hslToken(selector: string, token: string): number[] {
  const match = block(selector).match(
    new RegExp(`--${token}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`),
  );
  expect(match).not.toBeNull();
  return hsl(Number(match![1]), Number(match![2]) / 100, Number(match![3]) / 100);
}

function ratioValues(foreground: number[], background: number[]): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

function ratio(foreground: string, background: string): number {
  return ratioValues(rgb(foreground), rgb(background));
}

it("paints the card gradient from tokens, never a baked literal", () => {
  const glass = block(".glass {");
  expect(glass).toContain("hsl(var(--surface))");
  expect(glass).toContain("hsl(var(--surface-grad-end))");
  // No raw hsl(<numbers>) triple anywhere in the rule.
  expect(glass).not.toMatch(/hsl\(\s*\d/);
});

it("defines the card gradient foot in BOTH themes", () => {
  expect(block(":root {")).toMatch(/--surface-grad-end:\s*148 29% 8%/);
  expect(block(".theme-daylight {")).toMatch(/--surface-grad-end:\s*\d/);
});

it("keeps the dark value byte-identical to the literal it replaced", () => {
  // The refactor must be a pure rename: dark rendering cannot shift by a hair.
  expect(block(":root {")).toContain("--surface-grad-end: 148 29% 8%");
});

it("gives daylight a LIGHT gradient foot, not an inherited dark one", () => {
  const m = block(".theme-daylight {").match(/--surface-grad-end:\s*[\d.]+ [\d.]+% ([\d.]+)%/);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBeGreaterThan(50); // lightness, not a near-black
});

it("keeps pitch-copy byte-identical across the invariant panel-pitch themes", () => {
  const darkInk = tokenHex(":root {", "pitch-copy");
  const daylightInk = tokenHex(".theme-daylight {", "pitch-copy");
  expect(darkInk).toBe("#a9c7b4");
  expect(daylightInk).toBe("#a9c7b4");
});

it("keeps pitch-copy AA-safe across every actual panel-pitch stop", () => {
  const daylightInk = tokenHex(".theme-daylight {", "pitch-copy");
  const fixedStops = Array.from(
    block(".panel-pitch {").matchAll(/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/g),
    (match) => hsl(Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100),
  );
  expect(fixedStops).toHaveLength(2);
  const actualSurfaces = [
    ...fixedStops,
    hslToken(":root {", "pitch"),
    hslToken(".theme-daylight {", "pitch"),
  ];

  for (const surface of actualSurfaces) {
    expect(ratioValues(rgb(daylightInk), surface)).toBeGreaterThanOrEqual(4.5);
  }
});

it("keeps feature-chart-ink byte-identical in dark and AA-safe on both Daylight surfaces", () => {
  expect(tokenHex(":root {", "feature-chart-ink")).toBe("#8b95a7");
  const daylightInk = tokenHex(".theme-daylight {", "feature-chart-ink");
  expect(daylightInk).toBe("#657185");
  expect(ratio(daylightInk, "#f4f7f2")).toBeGreaterThanOrEqual(4.5);
  expect(ratio(daylightInk, "#ffffff")).toBeGreaterThanOrEqual(4.5);
});
