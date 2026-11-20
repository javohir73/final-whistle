/** Floodlight P6 guard for the PWA manifest. The polish pass verified the
 *  manifest by hand — canvas-token chrome colours, standalone/portrait, and an
 *  icons array that must never reference an asset missing from public/. These
 *  assertions lock that in so a future icon rename can't silently ship a
 *  dangling manifest reference (Android/Chrome drop the whole icon set). */
import { existsSync } from "fs";
import { join } from "path";
import manifest from "./manifest";
import { getTournament } from "@/lib/tournament";

// Whatever tournament the pipeline happens to point at (the Champions League,
// on 2026-11-03) must never leak into the install name or description again.
jest.mock("@/lib/tournament", () => ({
  getTournament: jest.fn(async () => ({
    id: 0,
    name: "UEFA Champions League 2026-27",
    year: 2026,
    format: "league",
    has_brackets: false,
  })),
}));

const PUBLIC_DIR = join(__dirname, "..", "public");

describe("PWA manifest", () => {
  it("uses the direction G white ground for both chrome colours", async () => {
    const m = await manifest();
    // Matches globals.css --fw-ground and viewport.themeColor in app/layout.tsx.
    expect(m.background_color).toBe("#ffffff");
    expect(m.theme_color).toBe("#ffffff");
  });

  it("declares a standalone, portrait, root-scoped installable app", async () => {
    const m = await manifest();
    expect(m.id).toBe("/");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBe("portrait");
    expect(m.lang).toBe("en");
  });

  it("references only icons that exist on disk in public/", async () => {
    const m = await manifest();
    expect(m.icons?.length).toBeGreaterThan(0);
    for (const icon of m.icons ?? []) {
      expect(existsSync(join(PUBLIC_DIR, icon.src))).toBe(true);
    }
  });

  it("names the platform, not whichever tournament is active", async () => {
    const m = await manifest();
    expect(m.name).toBe("FinalWhistle — Beat the model at the Premier League, La Liga, Bundesliga and NRL");
    expect(m.short_name).toBe("FinalWhistle");
    for (const copy of [m.name, m.description]) {
      expect(copy).not.toMatch(/Champions League|World Cup|bracket|knockout/i);
    }
    expect(m.description).toMatch(/Premier League, La Liga, Bundesliga and the NRL/);
    expect(m.description).toMatch(/entertainment only/);
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("ships distinct any + maskable icon purposes", async () => {
    const m = await manifest();
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });
});
