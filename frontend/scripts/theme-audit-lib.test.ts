const {
  parseCssColor,
  composite,
  contrastRatio,
  wcagThreshold,
  diffDarkStyles,
} = require("./theme-audit-lib.cjs");

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
