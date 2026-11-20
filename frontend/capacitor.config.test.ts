/** The native shell paints its WebView background before the page arrives
 *  (launch, overscroll, behind the safe areas). It must be the canvas the
 *  web app paints (direction G: white), or a dark seam shows on every launch. */
import fs from "fs";
import path from "path";
import config from "./capacitor.config";

/** globals.css `:root --background` (HSL channels) as a #rrggbb string. */
function cssCanvasHex(): string {
  const css = fs.readFileSync(path.join(__dirname, "app/globals.css"), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const [h, s, l] = root
    .match(/--background:\s*(\d+)\s+(\d+)%\s+(\d+)%;/)!
    .slice(1)
    .map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

it("paints the direction G white canvas behind the WebView on both platforms", () => {
  expect(config.ios?.backgroundColor).toBe("#ffffff");
  expect(config.android?.backgroundColor).toBe("#ffffff");
});

it("matches the web canvas token (globals.css :root --background)", () => {
  expect(config.ios?.backgroundColor).toBe(cssCanvasHex());
});
