import fs from "fs";
import path from "path";

type Rgba = [number, number, number, number];

const root = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const floodlight = css.slice(css.indexOf(":root {"), css.indexOf(".theme-daylight {"));
const daylight = css.slice(css.indexOf(".theme-daylight {"), css.indexOf("@media (min-width"));

function token(scope: string, name: string): string {
  const match = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing --${name}`);
  return match[1].trim();
}

function hsl(value: string): Rgba {
  const match = value.match(/^(\d+)\s+(\d+)%\s+(\d+)%(?:\s*\/\s*([\d.]+))?$/);
  if (!match) throw new Error(`Unsupported HSL token: ${value}`);
  const [, rawH, rawS, rawL, rawA] = match;
  const h = Number(rawH);
  const s = Number(rawS) / 100;
  const l = Number(rawL) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] * 255 + m * 255, rgb[1] * 255 + m * 255, rgb[2] * 255 + m * 255, rawA ? Number(rawA) : 1];
}

function composite([r, g, b, a]: Rgba, [br, bg, bb, ba]: Rgba): Rgba {
  const outA = a + ba * (1 - a);
  return [
    (r * a + br * ba * (1 - a)) / outA,
    (g * a + bg * ba * (1 - a)) / outA,
    (b * a + bb * ba * (1 - a)) / outA,
    outA,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const linear = [r, g, b].map((raw) => {
    const value = raw / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

it("gives Daylight action, outcome, host, and Origin copy semantic inks above 4.5:1", () => {
  const canvas = hsl(token(daylight, "background"));
  const surface = hsl(token(daylight, "surface"));
  const win = hsl(token(daylight, "win"));
  const goldWash = composite([...hsl(token(daylight, "gold")).slice(0, 3), 0.15] as Rgba, surface);
  const limeDeep = hsl(token(daylight, "lime-deep"));

  expect(ratio(hsl(token(daylight, "action-ink")), win)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(hsl(token(daylight, "amber-ink")), goldWash)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(hsl(token(daylight, "draw-ink")), canvas)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(hsl(token(daylight, "loss-ink")), canvas)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(hsl(token(daylight, "lime-deep-ink")), limeDeep)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(hsl(token(daylight, "origin-disclaimer")), canvas)).toBeGreaterThanOrEqual(4.5);
});

it("preserves the exact Floodlight values replaced by semantic ink tokens", () => {
  expect(token(floodlight, "action-ink")).toBe("156 33% 6%");
  expect(token(floodlight, "draw-ink")).toBe("38 94% 58%");
  expect(token(floodlight, "loss-ink")).toBe("351 90% 64%");
  expect(token(floodlight, "lime-deep-ink")).toBe("0 0% 0%");
  expect(token(floodlight, "origin-disclaimer")).toBe("0 0% 100% / 0.4");
});

it("routes every measured failing consumer through its semantic ink", () => {
  const sources: Record<string, string[]> = {
    "components/PlatformHome.tsx": ["text-action-ink"],
    "components/FeatureHero.tsx": ["text-action-ink"],
    "components/DisclaimerBanner.tsx": ["text-draw-ink"],
    "components/Scorebug.tsx": ["text-draw-ink", "text-loss-ink"],
    "app/nrl/origin/page.tsx": ["text-lime-deep-ink", "text-origin-disclaimer"],
  };

  for (const [relativePath, classes] of Object.entries(sources)) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    for (const className of classes) expect(source).toContain(className);
  }
});
