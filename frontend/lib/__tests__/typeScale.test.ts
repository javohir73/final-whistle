/** The type scale's two structural rules.
 *
 *  1. cn() must treat a scale step as a SIZE, not a colour. tailwind-merge only
 *     knows Tailwind's own font-size names; without the extension in lib/utils,
 *     cn("text-label", "text-lime-deep") drops the size entirely and the element
 *     renders with no font-size class at all. That failure is invisible in
 *     review — it looks like a working class list — so it gets a test.
 *  2. Every step declared to tailwind-merge must exist in tailwind.config, and
 *     vice versa: a step in one but not the other is either a dropped size or a
 *     class that never generates.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { cn } from "@/lib/utils";

const SCALE = [
  "micro", "mini", "note", "label", "meta", "body", "lead", "sub",
  "numeral", "headline", "score-sm", "score",
];

describe("cn() keeps type-scale sizes alongside colours", () => {
  it.each(SCALE)("keeps text-%s when a colour follows", (step) => {
    expect(cn(`text-${step}`, "text-lime-deep")).toBe(`text-${step} text-lime-deep`);
  });

  it("still lets a later size override an earlier one", () => {
    expect(cn("text-label", "text-body")).toBe("text-body");
    expect(cn("text-label", "text-[13px]")).toBe("text-[13px]");
  });

  it("still lets a later colour override an earlier one", () => {
    expect(cn("text-muted", "text-lime-deep")).toBe("text-lime-deep");
  });
});

describe("scale definitions stay in sync", () => {
  const config = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
  const utils = readFileSync(join(process.cwd(), "lib/utils.ts"), "utf8");

  it.each(SCALE)("tailwind.config defines %s", (step) => {
    const key = step.includes("-") ? `"${step}"` : step;
    expect(config).toMatch(new RegExp(`${key}:\\s*"\\d`));
  });

  it.each(SCALE)("lib/utils declares %s to tailwind-merge", (step) => {
    expect(utils).toContain(`"${step}"`);
  });
});

describe("direction G type floor", () => {
  it("defines no named size below 13px (nothing real is smaller than the 13px label)", () => {
    // Direction G: the smallest real text is the 13px label. The old scale had
    // 8-12px steps; they are raised to the floor, so every named size must be
    // 13px or larger.
    const config = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
    const fontSize = config.slice(config.indexOf("fontSize:"), config.indexOf("borderRadius:"));
    const sizes = Array.from(fontSize.matchAll(/"(\d+)px"/g), (m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(13);
  });

  it("declares the direction G steps to tailwind-merge so they are kept as sizes", () => {
    for (const step of ["h1", "h1-sm", "h2", "notes", "table", "stat"]) {
      expect(cn(`text-${step}`, "text-ink")).toBe(`text-${step} text-ink`);
    }
  });
});
