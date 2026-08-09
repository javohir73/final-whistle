import fs from "fs";
import path from "path";

const FIXED_PALETTE_PATHS: Record<string, string> = {
  "app/global-error.tsx": "self-contained root crash boundary; global CSS is unavailable",
  "app/embed/[matchId]/page.tsx": "partner embed has an explicit fixed palette",
  "app/layout.tsx": "browser chrome and pre-paint boot values must be literal",
  "app/manifest.ts": "PWA manifest colour is static by specification",
  "components/AICalculationReveal.tsx": "CSS mask colour is alpha-only, not visible ink",
  "components/AccountMenu.tsx": "initials sit on invariant dark bg-pitch",
  "components/ClubBadge.tsx": "club and competition brand colours",
  "components/EmbedPredictionCard.tsx": "share card has an explicit fixed palette",
  "lib/og.tsx": "Open Graph renderer has an explicit fixed palette",
  "lib/theme.ts": "browser theme-color meta requires literal values",
};

function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(fullPath);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.[^.]+$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

it("allows raw hex colours only in documented fixed-palette files", () => {
  const frontendRoot = path.resolve(__dirname, "../..");
  const violations = ["app", "components", "lib"].flatMap((directory) =>
    productionFiles(path.join(frontendRoot, directory)).flatMap((file) => {
      const relativePath = path.relative(frontendRoot, file).split(path.sep).join("/");
      if (FIXED_PALETTE_PATHS[relativePath]) return [];

      const source = stripComments(fs.readFileSync(file, "utf8"));
      return Array.from(source.matchAll(/#[\da-fA-F]{3,8}\b/g), (match) => {
        const line = source.slice(0, match.index).split("\n").length;
        return `${relativePath}:${line} ${match[0]}`;
      });
    }),
  );

  expect(violations).toEqual([]);
});
