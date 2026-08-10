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
  isUnstyledSample,
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
  const boldBoundaryPx = 14 * (96 / 72);
  const normalBoundaryPx = 18 * (96 / 72);

  expect(wcagThreshold(18, 700)).toBe(4.5);
  expect(wcagThreshold(boldBoundaryPx - 0.001, 700)).toBe(4.5);
  expect(wcagThreshold(boldBoundaryPx, 700)).toBe(3);
  expect(wcagThreshold(normalBoundaryPx - 0.001, 400)).toBe(4.5);
  expect(wcagThreshold(normalBoundaryPx, 400)).toBe(3);
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

it("retains resolved opaque stops while deferring interpolation between them", () => {
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

  expect(rendered.manualReview).toBe(
    "continuous gradient interpolation between safe declared stops requires rendered-pixel evidence on section",
  );
  expect((rendered.declaredPairs as RenderedPair[]).map((pair) => pair.background)).toEqual([
    [255, 255, 255, 1],
    [246, 248, 243, 1],
  ]);
});

it("does not pass a continuous gradient when safe endpoints can interpolate through unsafe contrast", () => {
  const foreground: Rgba = [117, 117, 117, 1];
  const black: Rgba = [0, 0, 0, 1];
  const white: Rgba = [255, 255, 255, 1];
  const computedBackground = "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))";

  expect(contrastRatio(foreground, black)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(foreground, white)).toBeGreaterThanOrEqual(4.5);
  const rendered = renderedContrastColours(foreground, [{
    tag: "section",
    backgroundColor: "rgb(0, 0, 0)",
    backgroundImage: computedBackground,
    opacity: 1,
  }]);
  expect(rendered).toMatchObject({
    manualReview:
      "continuous gradient interpolation between safe declared stops requires rendered-pixel evidence on section",
    computedBackground,
  });
  expect((rendered.declaredPairs as RenderedPair[]).map((pair) => pair.background)).toEqual([
    black,
    white,
  ]);
});

it("does not apply an sRGB endpoint-channel bound to default coloured interpolation", () => {
  const foreground: Rgba = [255, 255, 255, 1];
  const red: Rgba = [255, 0, 0, 1];
  const blue: Rgba = [0, 0, 255, 1];
  // The CSS Images 4 default Oklab midpoint for red→blue is approximately this
  // colour: its green channel lies outside both endpoints' sRGB channel envelope.
  const oklabMidpoint: Rgba = [140, 83, 162, 1];
  const computedBackground = "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))";

  expect(oklabMidpoint[1]).toBeGreaterThan(Math.max(red[1], blue[1]));
  expect(contrastRatio(foreground, red)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(foreground, blue)).toBeGreaterThanOrEqual(3);
  expect(renderedContrastColours(foreground, [{
    tag: "section",
    backgroundColor: "rgb(0, 0, 0)",
    backgroundImage: computedBackground,
    opacity: 1,
  }], 3)).toMatchObject({
    manualReview:
      "continuous gradient interpolation between safe declared stops requires rendered-pixel evidence on section",
    computedBackground,
  });
});

it("retains composited transparent radial stops while deferring interpolation", () => {
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

  expect(rendered.manualReview).toBe(
    "continuous gradient interpolation between safe declared stops requires rendered-pixel evidence on div",
  );
  const backgrounds = (rendered.declaredPairs as RenderedPair[])
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

// --- Instrument faults vs contrast results ----------------------------------
// A run once reported 310 "pre-existing Floodlight contrast failures". Every one
// carried an rgb(0,0,0) foreground or rgb(255,255,255) background — the browser's
// unstyled defaults. Live measurement of the same pages found ZERO elements with
// either, and the footer that was reported as failing measured 7.41:1. Acting on
// that report would have meant rewriting ~310 colour declarations in a theme
// independently measured as AAA-grade. These pin the distinction.

describe("isUnstyledSample", () => {
  const FLOODLIGHT_CANVAS = [10, 20, 16, 1];

  it("flags the unstyled black ink that produced the phantom failures", () => {
    expect(
      isUnstyledSample([0, 0, 0, 1], [16, 30, 23, 1], FLOODLIGHT_CANVAS),
    ).toMatch(/unstyled default ink/);
  });

  it("flags an unstyled white canvas under a dark theme", () => {
    expect(
      isUnstyledSample([148, 168, 151, 1], [255, 255, 255, 1], FLOODLIGHT_CANVAS),
    ).toMatch(/unstyled default canvas/);
  });

  it("passes the REAL footer pair that was wrongly reported as failing", () => {
    // rgb(148,168,151) on rgb(10,20,16) measures 7.41:1 in the browser.
    expect(
      isUnstyledSample([148, 168, 151, 1], [10, 20, 16, 1], FLOODLIGHT_CANVAS),
    ).toBeNull();
  });

  it("does NOT mask a real white surface when the theme genuinely paints white", () => {
    // Daylight cards are #ffffff. A dark-on-white pair there is a real result,
    // so the guard must not swallow it — otherwise it hides genuine findings.
    const DAYLIGHT_CARD = [255, 255, 255, 1];
    expect(
      isUnstyledSample([200, 200, 200, 1], [255, 255, 255, 1], DAYLIGHT_CARD),
    ).toBeNull();
  });

  it("still flags black ink even on a legitimately white canvas", () => {
    // Nothing in either theme paints pure black text; it is always the default.
    expect(
      isUnstyledSample([0, 0, 0, 1], [255, 255, 255, 1], [255, 255, 255, 1]),
    ).toMatch(/unstyled default ink/);
  });
});
