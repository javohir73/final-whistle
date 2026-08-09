const {
  parseCssColor,
  composite,
  contrastRatio,
  wcagThreshold,
  diffDarkStyles,
  renderedContrastColours,
  isReadOnlyMethod,
  isAuditGuardBlock,
  deduplicateManualExemptions,
} = require("./theme-audit-lib.cjs");

type Rgba = [number, number, number, number];
type RenderedPair = { foreground: Rgba; background: Rgba };

it("parses browser rgb and rgba colours", () => {
  expect(parseCssColor("rgb(15, 33, 23)")).toEqual([15, 33, 23, 1]);
  expect(parseCssColor("rgba(255, 255, 255, 0.7)")).toEqual([255, 255, 255, 0.7]);
  expect(parseCssColor("transparent")).toEqual([0, 0, 0, 0]);
});

it("measures the known crash-page failure and corrected value", () => {
  const canvas = [246, 248, 243, 1];
  expect(contrastRatio([107, 124, 113, 1], canvas)).toBeCloseTo(4.138, 2);
  expect(contrastRatio([89, 104, 95, 1], canvas)).toBeCloseTo(5.501, 2);
});

it("composites translucent text before measuring it", () => {
  expect(composite([255, 255, 255, 0.7], [13, 36, 24, 1])).toEqual([
    182.4, 189.3, 185.7, 1,
  ]);
});

it("uses WCAG large-text thresholds only at the defined boundary", () => {
  expect(wcagThreshold(17, 400)).toBe(4.5);
  expect(wcagThreshold(18, 400)).toBe(3);
  expect(wcagThreshold(14, 700)).toBe(3);
  expect(wcagThreshold(13, 700)).toBe(4.5);
});

it("reports only changed computed dark properties", () => {
  const before = { "/": { "body:0": { color: "rgb(243, 246, 243)", backgroundColor: "rgb(10, 20, 16)" } } };
  const after = { "/": { "body:0": { color: "rgb(243, 246, 243)", backgroundColor: "rgb(11, 20, 16)" } } };
  expect(diffDarkStyles(before, after)).toEqual([{
    route: "/",
    key: "body:0",
    property: "backgroundColor",
    before: "rgb(10, 20, 16)",
    after: "rgb(11, 20, 16)",
  }]);
});

it("composites an opacity group's text and background against its parent surface", () => {
  expect(renderedContrastColours(
    [10, 20, 16, 1],
    [
      {
        tag: "button",
        backgroundColor: "rgb(158, 230, 51)",
        backgroundImage: "none",
        opacity: 0.6,
      },
      {
        tag: "div",
        backgroundColor: "rgb(16, 29, 22)",
        backgroundImage: "none",
        opacity: 1,
      },
    ],
  )).toEqual({
    foreground: [12.4, 23.6, 18.4, 1],
    background: [101.2, 149.6, 39.4, 1],
  });
});

it("resolves every opaque stop in a computed glass gradient", () => {
  const rendered = renderedContrastColours(
    [14, 32, 23, 1],
    [
      {
        tag: "span",
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "none",
        opacity: 1,
      },
      {
        tag: "section",
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "linear-gradient(rgb(255, 255, 255), rgb(246, 248, 243))",
        opacity: 1,
      },
      {
        tag: "body",
        backgroundColor: "rgb(244, 247, 242)",
        backgroundImage: "none",
        opacity: 1,
      },
    ],
  );

  expect(rendered.manualReview).toBeUndefined();
  expect((rendered.pairs as RenderedPair[]).map((pair) => pair.background)).toEqual([
    [255, 255, 255, 1],
    [246, 248, 243, 1],
  ]);
});

it("composites transparent radial stops over every lower gradient stop", () => {
  const rendered = renderedContrastColours(
    [14, 32, 23, 1],
    [
      {
        tag: "div",
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage:
          "radial-gradient(circle, rgba(149, 213, 52, 0.18), rgba(0, 0, 0, 0) 65%), " +
          "linear-gradient(rgb(255, 255, 255), rgb(246, 248, 243))",
        opacity: 1,
      },
      {
        tag: "body",
        backgroundColor: "rgb(244, 247, 242)",
        backgroundImage: "none",
        opacity: 1,
      },
    ],
  );

  expect(rendered.manualReview).toBeUndefined();
  const backgrounds = (rendered.pairs as RenderedPair[])
    .map((pair) => pair.background.map((channel) => Number(channel.toFixed(2))))
    .sort((left, right) => left.join(",").localeCompare(right.join(",")));
  expect(backgrounds).toEqual([
    [228.54, 241.7, 208.62, 1],
    [235.92, 247.44, 218.46, 1],
    [246, 248, 243, 1],
    [255, 255, 255, 1],
  ]);
});

it("keeps an unresolvable URL layer as an explicit computed-background exemption", () => {
  const computedBackground = 'url("/hero.webp"), linear-gradient(rgb(255, 255, 255), rgb(246, 248, 243))';
  expect(renderedContrastColours(
    [14, 32, 23, 1],
    [{
      tag: "section",
      backgroundColor: "rgb(255, 255, 255)",
      backgroundImage: computedBackground,
      opacity: 1,
    }],
  )).toEqual({
    manualReview: "unresolvable URL image layer on section",
    computedBackground,
  });
});

it("deduplicates exemptions by target route, viewport, selector, and computed background", () => {
  const manual = {
    target: "/football/wc26/bracket",
    viewport: "375x844",
    selector: "nav a",
    text: "Home",
    reason: "pixel colours vary",
    computedBackground: "source=/flags/us.png",
    evidence: "manual/bracket.png",
  };
  const routes = ["/brackets", "/football/[comp]/bracket"].map((pattern) => ({
    tier: "P1",
    pattern,
    viewports: { mobile: { manualReview: [{ ...manual, route: pattern }] } },
  }));

  expect(deduplicateManualExemptions(routes)).toEqual([{
    ...manual,
    route: "/football/wc26/bracket",
    tier: "P1",
    patterns: ["/brackets", "/football/[comp]/bracket"],
  }]);
});

it("allows only read-only browser request methods during an audit", () => {
  expect(isReadOnlyMethod("GET")).toBe(true);
  expect(isReadOnlyMethod("HEAD")).toBe(true);
  expect(isReadOnlyMethod("POST")).toBe(false);
});

it("recognises browser-specific suffixes on intentionally blocked requests", () => {
  expect(isAuditGuardBlock("net::ERR_BLOCKED_BY_CLIENT")).toBe(true);
  expect(isAuditGuardBlock("net::ERR_BLOCKED_BY_CLIENT.Inspector")).toBe(true);
  expect(isAuditGuardBlock("net::ERR_NAME_NOT_RESOLVED")).toBe(false);
});
