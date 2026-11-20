/** Shared helpers for the direction G token tests: read a token from
 *  globals.css `:root`, turn it into RGBA (HSL channels with decimals and an
 *  optional alpha, or a #hex), composite washes, and compute WCAG ratios. */
import fs from "fs";
import path from "path";

export type Rgba = [number, number, number, number];

export const frontendRoot = path.resolve(__dirname, "../..");
export const css = fs.readFileSync(path.join(frontendRoot, "app/globals.css"), "utf8");

/** The `:root { … }` block. */
export const rootScope = (() => {
  const start = css.indexOf(":root {");
  return css.slice(start, css.indexOf("\n}", start) + 2);
})();

export function token(name: string, scope = rootScope): string {
  const match = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing --${name}`);
  return match[1].trim();
}

export function parseColor(value: string): Rgba {
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const n = hex[1];
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const match = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+))?$/);
  if (!match) throw new Error(`Unsupported colour token: ${value}`);
  const [, rawH, rawS, rawL, rawA] = match;
  const h = Number(rawH);
  const s = Number(rawS) / 100;
  const l = Number(rawL) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255, rawA ? Number(rawA) : 1];
}

/** A token's colour; follows one level of `var(--x)` indirection. */
export function color(name: string): Rgba {
  const value = token(name);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return parseColor(ref ? token(ref[1]) : value);
}

export function hexOf([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function composite([r, g, b, a]: Rgba, [br, bg, bb, ba]: Rgba): Rgba {
  const outA = a + ba * (1 - a);
  return [
    (r * a + br * ba * (1 - a)) / outA,
    (g * a + bg * ba * (1 - a)) / outA,
    (b * a + bb * ba * (1 - a)) / outA,
    outA,
  ];
}

export function luminance([r, g, b]: Rgba): number {
  const linear = [r, g, b].map((raw) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function ratio(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** `name` at `alpha` painted over `over` (e.g. `bg-loss/15` on a card). */
export const wash = (name: string, alpha: number, over: Rgba): Rgba =>
  composite([...color(name).slice(0, 3), alpha] as Rgba, over);
