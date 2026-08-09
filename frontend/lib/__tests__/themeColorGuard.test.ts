import fs from "fs";
import path from "path";
import ts from "typescript";

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
  const characters = source.split("");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.JSX,
    source,
  );
  const templateBraceDepths: number[] = [];

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      for (let index = scanner.getTokenPos(); index < scanner.getTextPos(); index += 1) {
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
      }
    } else if (token === ts.SyntaxKind.TemplateHead) {
      templateBraceDepths.push(0);
    } else if (templateBraceDepths.length && token === ts.SyntaxKind.OpenBraceToken) {
      templateBraceDepths[templateBraceDepths.length - 1] += 1;
    } else if (templateBraceDepths.length && token === ts.SyntaxKind.CloseBraceToken) {
      const currentTemplate = templateBraceDepths.length - 1;
      if (templateBraceDepths[currentTemplate] > 0) {
        templateBraceDepths[currentTemplate] -= 1;
      } else if (scanner.reScanTemplateToken(false) === ts.SyntaxKind.TemplateTail) {
        templateBraceDepths.pop();
      }
    }
  }

  return characters.join("");
}

function rawHexViolations(relativePath: string, source: string): string[] {
  const uncommented = stripComments(source);
  return Array.from(uncommented.matchAll(/#[\da-fA-F]{3,8}\b/g), (match) => {
    const line = uncommented.slice(0, match.index).split("\n").length;
    return `${relativePath}:${line} ${match[0]}`;
  });
}

it("does not mistake comment markers inside strings for real comments", () => {
  const source =
    'const icon = \'<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff"/></svg>\';';

  expect(rawHexViolations("components/Icon.tsx", source)).toEqual([
    "components/Icon.tsx:1 #fff",
  ]);
});

it("allows raw hex colours only in documented fixed-palette files", () => {
  const frontendRoot = path.resolve(__dirname, "../..");
  const violations = ["app", "components", "lib"].flatMap((directory) =>
    productionFiles(path.join(frontendRoot, directory)).flatMap((file) => {
      const relativePath = path.relative(frontendRoot, file).split(path.sep).join("/");
      if (FIXED_PALETTE_PATHS[relativePath]) return [];

      return rawHexViolations(relativePath, fs.readFileSync(file, "utf8"));
    }),
  );

  expect(violations).toEqual([]);
});
