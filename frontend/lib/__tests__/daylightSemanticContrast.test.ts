/** Semantic ink tokens, re-checked for direction G.
 *
 *  This file used to prove each Daylight ink cleared AA while the Floodlight
 *  value stayed byte-identical. There is one theme now, so the same inks are
 *  checked once, on every surface they sit on in G (ground, soft, the chip
 *  neutral and their own washes). The file name is kept for history. */
import fs from "fs";
import path from "path";
import { COMPETITIONS, accentInkVar } from "@/lib/sports";
import { color, composite, parseColor, ratio, token, wash, type Rgba } from "./gTokens.test.helpers";

const root = path.resolve(__dirname, "../..");
const surfaces: Rgba[] = [color("background"), color("surface"), color("surface-2"), parseColor("#f2f4f1")];

it("gives action, outcome and Origin copy semantic inks above 4.5:1", () => {
  expect(ratio(color("action-ink"), color("win"))).toBeGreaterThanOrEqual(4.5);
  expect(ratio(color("lime-deep-ink"), color("lime-deep"))).toBeGreaterThanOrEqual(4.5);
  for (const stop of surfaces) {
    for (const ink of ["draw-ink", "loss-ink", "origin-disclaimer", "amber-ink", "gold-ink", "muted-solid", "hint-ink"]) {
      expect(ratio(color(ink), stop)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("turns the old dark-text-on-lime fills into white text on brand", () => {
  // Every `bg-win text-action-ink` / `bg-lime-deep text-lime-deep-ink` call
  // site now renders white on the brand green.
  expect(color("action-ink").slice(0, 3)).toEqual([255, 255, 255]);
  expect(color("lime-deep-ink").slice(0, 3)).toEqual([255, 255, 255]);
});

it("keeps text on 15% washes of the outcome fills readable", () => {
  for (const stop of surfaces.slice(0, 2)) {
    expect(ratio(color("loss-wash-ink"), wash("loss", 0.15, stop))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color("gold-wash-ink"), wash("gold", 0.15, stop))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color("amber-ink"), wash("gold", 0.15, stop))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color("lime-deep"), wash("win", 0.1, stop))).toBeGreaterThanOrEqual(4.5);
  }
});

it("keeps disabled controls fully opaque (their state is shown by colour, not by fading)", () => {
  expect(token("disabled-opacity")).toBe("1");
  expect(token("disabled-opacity-40")).toBe("1");
});

const REGISTERED_COMPETITIONS = Object.values(COMPETITIONS);
const cssTokenName = (variable: string) => variable.replace(/^--/, "");

it("derives every competition's chip ink from its registry accent", () => {
  for (const competition of REGISTERED_COMPETITIONS) {
    expect(accentInkVar(competition.id)).toBe(`${competition.accentVar}-ink`);
  }
});

it("gives every competition an accent and an ink token", () => {
  for (const competition of REGISTERED_COMPETITIONS) {
    expect(() => token(cssTokenName(competition.accentVar))).not.toThrow();
    expect(() => token(cssTokenName(accentInkVar(competition.id)))).not.toThrow();
  }
});

it.each(REGISTERED_COMPETITIONS)("keeps the $id chip label AA-safe on its own wash", (competition) => {
  // The chip paints its ink as small bold text on a 0.12 wash of its accent.
  const ink = color(cssTokenName(accentInkVar(competition.id)));
  for (const stop of surfaces.slice(0, 2)) {
    const chip = composite([...color(cssTokenName(competition.accentVar)).slice(0, 3), 0.12] as Rgba, stop);
    expect(ratio(ink, chip)).toBeGreaterThanOrEqual(4.5);
  }
});

it("paints the eyebrow chip in ink on the neutral chip fill (one accent; the logo identifies the competition)", () => {
  const source = fs.readFileSync(path.join(root, "components/Eyebrow.tsx"), "utf8");
  expect(source).toMatch(/bg-chip[^"]*text-ink/);
  // ink on chip clears AA by a wide margin.
  expect(ratio(color("fw-ink"), color("fw-chip"))).toBeGreaterThanOrEqual(4.5);
});
