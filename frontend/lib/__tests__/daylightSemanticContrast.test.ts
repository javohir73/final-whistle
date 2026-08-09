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

function withGroupOpacity(pixel: Rgba, opacity: number): Rgba {
  return [pixel[0], pixel[1], pixel[2], pixel[3] * opacity];
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
    "components/ProbabilityBar.tsx": ["text-draw-ink", "text-loss-ink"],
    "components/MatchCard.tsx": ["text-loss-wash-ink", "text-muted-solid"],
    "components/FormStrip.tsx": ["text-loss-wash-ink", "text-gold-wash-ink"],
    "components/StandingsTable.tsx": ["text-gold-ink"],
    "components/OfficialBracket.tsx": ["text-pitch-accent-ink", "text-pitch-foreground-ink", "text-pitch-muted-ink"],
    "components/MoversPanel.tsx": ["text-pitch-subtle-ink", 'surface="pitch"'],
    "components/leagueTips/LeagueTipsPicker.tsx": ["disabled:opacity-disabled-40"],
    "components/nrl/RunHomePredictor.tsx": ["disabled:opacity-disabled-40", "disabled:opacity-disabled"],
  };

  for (const [relativePath, classes] of Object.entries(sources)) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    for (const className of classes) expect(source).toContain(className);
  }
});

it("keeps both disabled FeatureHero labels AA-safe on every Daylight glass stop", () => {
  const darkOpacity = Number(token(floodlight, "disabled-opacity"));
  const daylightOpacity = Number(token(daylight, "disabled-opacity"));
  const actionInk = hsl(token(daylight, "action-ink"));
  const foreground = hsl(token(daylight, "foreground"));
  const win = hsl(token(daylight, "win"));
  const glassStops = [
    hsl(token(daylight, "surface")),
    hsl(token(daylight, "surface-grad-end")),
  ];

  expect(darkOpacity).toBe(0.6);
  expect(daylightOpacity).toBe(1);
  for (const stop of glassStops) {
    const primaryForeground = composite(withGroupOpacity(composite(actionInk, win), daylightOpacity), stop);
    const primaryBackground = composite(withGroupOpacity(win, daylightOpacity), stop);
    const secondaryForeground = composite(withGroupOpacity(foreground, daylightOpacity), stop);

    expect(ratio(primaryForeground, primaryBackground)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(secondaryForeground, stop)).toBeGreaterThanOrEqual(4.5);
  }
});

it("keeps measured Daylight state inks safe on every surface stop", () => {
  const glassStops = [
    hsl(token(daylight, "surface")),
    hsl(token(daylight, "surface-grad-end")),
  ];
  const lossWashStops = glassStops.map((stop) =>
    composite([...hsl(token(daylight, "loss")).slice(0, 3), 0.15] as Rgba, stop),
  );
  const nestedLossWashStops = glassStops.map((stop) => {
    const inset = composite(
      [...hsl(token(daylight, "surface-2")).slice(0, 3), 0.7] as Rgba,
      stop,
    );
    return composite([...hsl(token(daylight, "loss")).slice(0, 3), 0.15] as Rgba, inset);
  });
  const goldWashStops = glassStops.map((stop) =>
    composite([...hsl(token(daylight, "gold")).slice(0, 3), 0.15] as Rgba, stop),
  );
  const nrlWashStops = glassStops.map((stop) =>
    composite([...hsl(token(floodlight, "accent-nrl")).slice(0, 3), 0.12] as Rgba, stop),
  );

  for (const stop of glassStops) {
    expect(ratio(hsl(token(daylight, "gold-ink")), stop)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hsl(token(daylight, "muted-solid")), stop)).toBeGreaterThanOrEqual(4.5);
  }
  for (const stop of [...lossWashStops, ...nestedLossWashStops]) {
    expect(ratio(hsl(token(daylight, "loss-wash-ink")), stop)).toBeGreaterThanOrEqual(4.5);
  }
  for (const stop of goldWashStops) {
    expect(ratio(hsl(token(daylight, "gold-wash-ink")), stop)).toBeGreaterThanOrEqual(4.5);
  }
  for (const stop of nrlWashStops) {
    expect(ratio(hsl(token(daylight, "accent-nrl-ink")), stop)).toBeGreaterThanOrEqual(4.5);
  }
});

it("keeps invariant pitch-panel inks safe on every solid gradient stop", () => {
  const pitchStops = [hsl("147 44% 13%"), hsl(token(daylight, "pitch")), hsl("147 45% 7%")];
  const pitchChip = hsl(token(daylight, "pitch-chip"));

  for (const stop of pitchStops) {
    expect(ratio(hsl(token(daylight, "pitch-accent-ink")), stop)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hsl(token(daylight, "pitch-loss-ink")), stop)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hsl(token(daylight, "pitch-foreground-ink")), stop)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hsl(token(daylight, "pitch-muted-ink")), stop)).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(composite(hsl(token(daylight, "pitch-subtle-ink")), stop), stop),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratio(hsl(token(daylight, "pitch-muted-ink")), composite(pitchChip, stop)),
    ).toBeGreaterThanOrEqual(4.5);
  }
});

it("preserves every new state ink's exact Floodlight literal", () => {
  expect(token(floodlight, "disabled-opacity-40")).toBe("0.4");
  expect(token(floodlight, "gold-ink")).toBe("42 62% 48%");
  expect(token(floodlight, "muted-solid")).toBe("129 10% 62% / 0.7");
  expect(token(floodlight, "loss-wash-ink")).toBe("351 90% 64%");
  expect(token(floodlight, "gold-wash-ink")).toBe("38 94% 58%");
  expect(token(floodlight, "accent-nrl-ink")).toBe("174 60% 40%");
  expect(token(floodlight, "pitch-accent-ink")).toBe("84 78% 55%");
  expect(token(floodlight, "pitch-loss-ink")).toBe("351 90% 64%");
  expect(token(floodlight, "pitch-foreground-ink")).toBe("120 14% 96%");
  expect(token(floodlight, "pitch-muted-ink")).toBe("129 10% 62%");
  expect(token(floodlight, "pitch-subtle-ink")).toBe("0 0% 100% / 0.45");
  expect(token(floodlight, "pitch-chip")).toBe("144 19% 10% / 0.7");
});
