import fs from "fs";
import path from "path";

type Rgb = [number, number, number];

const rootPath = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(rootPath, "app/globals.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing ${selector}`);
  return css
    .slice(start, css.indexOf("}", start))
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
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

function hsl(value: string): Rgb {
  const match = value.match(/^(\d+)\s+(\d+)%\s+(\d+)%$/);
  if (!match) throw new Error(`Unsupported HSL token: ${value}`);
  const [, rawHue, rawSaturation, rawLightness] = match;
  const hue = Number(rawHue);
  const saturation = Number(rawSaturation) / 100;
  const lightness = Number(rawLightness) / 100;
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
  expect(css).toContain("@media (hover: hover) and (pointer: fine)");
  expect(css).toContain(".competition-card:hover");
  expect(css).toContain(".competition-card:focus-visible");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toMatch(/\.competition-card:hover,[\s\S]*?transform:\s*none/);
});

it("keeps invariant competition card copy AA-safe", () => {
  const base = hsl(token(root, "competition-card-base"));

  expect(ratio(hsl(token(root, "competition-card-ink")), base)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(hsl(token(root, "competition-card-copy")), base)).toBeGreaterThanOrEqual(4.5);
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
