/** AA quick wins from the design-system audit (2026-11-03, §5 and §9.3 step 2),
 *  re-checked against direction G, the site's only theme.
 *
 *  Ratios are computed from the token values in globals.css, so a token edit
 *  that drops one of these pairs back under 4.5:1 fails here instead of in an
 *  audit. */
import fs from "fs";
import path from "path";
import { color, composite, css, ratio, token, wash, type Rgba } from "./gTokens.test.helpers";

const root = path.resolve(__dirname, "../..");

describe("direction G surfaces", () => {
  const stops: Rgba[] = ["surface", "surface-grad-end", "background"].map((n) => color(n));

  it("gives the LIVE pill ink (loss-wash-ink on loss/15) at least 4.5:1 on every surface", () => {
    const ink = color("loss-wash-ink");
    const insets = stops.map((s) => composite(color("surface-2"), s));
    for (const stop of [...stops, ...insets]) {
      expect(ratio(ink, wash("loss", 0.15, stop))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps pitch-subtle copy at least 4.5:1 on the (now light) pitch panel", () => {
    const panel = color("pitch");
    expect(ratio(composite(color("pitch-subtle-ink"), panel), panel)).toBeGreaterThanOrEqual(4.5);
  });

  it("paints Low confidence in muted on surface-2 (the ring's tier colour), above 4.5:1", () => {
    expect(token("confidence-low")).toBe("var(--muted)");
    const chip = composite(color("surface-2"), color("surface"));
    expect(ratio(color("muted"), chip)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["loss-ink", "gold-ink", "lime-deep", "win", "loss", "gold", "draw"])(
    "%s text clears 4.5:1 on every surface",
    (ink) => {
      for (const stop of stops) expect(ratio(color(ink), stop)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("call sites", () => {
  // Bare text-loss / text-gold / text-win measured 3.5 / 2.6 / 1.8:1 on white
  // in the old Daylight theme. They are AA in direction G, but these files
  // keep using the ink tokens so the intent stays explicit.
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
    expect(token("tabbar-clearance")).toBe("4.5rem");
  });
});
