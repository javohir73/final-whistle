/** AA quick wins from the design-system audit (2026-11-03, §5 and §9.3 step 2).
 *
 *  Ratios are computed from the token HSL in globals.css, the same way
 *  daylightSemanticContrast.test.ts does, so a token edit that drops one of
 *  these pairs back under 4.5:1 fails here instead of in an audit. */
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
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const wash = (scope: string, name: string, alpha: number, over: Rgba): Rgba =>
  composite([...hsl(token(scope, name)).slice(0, 3), alpha] as Rgba, over);

describe("Floodlight (default theme)", () => {
  const stops = ["surface", "surface-grad-end", "background"].map((n) => hsl(token(floodlight, n)));

  it("gives the LIVE pill ink (loss-wash-ink on loss/15) at least 4.5:1 on every surface", () => {
    const ink = hsl(token(floodlight, "loss-wash-ink"));
    const insets = stops.map((s) => wash(floodlight, "surface-2", 0.7, s));
    for (const stop of [...stops, ...insets]) {
      expect(ratio(ink, wash(floodlight, "loss", 0.15, stop))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps pitch-subtle copy at least 4.5:1 on every pitch-panel gradient stop", () => {
    const pitchStops = [hsl("147 44% 13%"), hsl(token(floodlight, "pitch")), hsl("147 45% 7%")];
    for (const stop of pitchStops) {
      const ink = composite(hsl(token(floodlight, "pitch-subtle-ink")), stop);
      expect(ratio(ink, stop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("paints Low confidence in muted on surface-2 (the ring's tier colour), above 4.5:1", () => {
    expect(token(floodlight, "confidence-low")).toBe("var(--muted)");
    const chip = composite(hsl(token(floodlight, "surface-2")), hsl(token(floodlight, "surface")));
    expect(ratio(hsl(token(floodlight, "muted")), chip)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Daylight (opt-in theme)", () => {
  const stops = ["surface", "surface-grad-end", "background"].map((n) => hsl(token(daylight, n)));

  // The fills (win/gold/loss) stay as they are: darkening them enough for text
  // would turn the lime CTA fill olive, the Europa stripe brown, and drop the
  // loss ink on the invariant pitch panels under 3:1. Text uses the inks.
  it.each(["loss-ink", "gold-ink", "lime-deep"])("%s text clears 4.5:1 on every Daylight stop", (ink) => {
    for (const stop of stops) {
      expect(ratio(hsl(token(daylight, ink)), stop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps text on a loss/15 wash (the delete-account button) readable via loss-wash-ink", () => {
    for (const stop of stops) {
      const fill = wash(daylight, "loss", 0.15, stop);
      expect(ratio(hsl(token(daylight, "loss-wash-ink")), fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("paints Low confidence in muted on surface-2 above 4.5:1", () => {
    expect(ratio(hsl(token(daylight, "muted")), hsl(token(daylight, "surface-2")))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("call sites", () => {
  // Bare text-loss / text-gold / text-win measured 3.5 / 2.6 / 1.8:1 on white
  // in Daylight. These files sit on theme surfaces (never the invariant dark
  // pitch panel), so they must use the ink tokens.
  const FILES = [
    "components/AuthModal.tsx",
    "components/DeleteAccountModal.tsx",
    "components/ConfidenceBadge.tsx",
    "app/reset-password/ResetPasswordClient.tsx",
    "app/verify-email/VerifyEmailClient.tsx",
    "app/error.tsx",
  ];
  it.each(FILES)("%s uses ink tokens, not the Daylight-failing text utilities", (file) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    expect(source).not.toMatch(/(^|[^-\w])text-(loss|gold|win)(?![-\w])/m);
  });

  it("parks fixed toasts above the mobile tab bar and the home indicator", () => {
    expect(css).toMatch(
      /\.bottom-above-tabbar\s*\{\s*bottom:\s*calc\(var\(--tabbar-clearance\)\s*\+\s*env\(safe-area-inset-bottom\)\);/,
    );
    expect(token(floodlight, "tabbar-clearance")).toBe("4.5rem");
  });
});
