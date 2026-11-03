import { expectedMarginLabel, pctTriple } from "./format";

/** expected_margin is home-minus-away; the label must read as the favoured
 *  side so nobody needs to know the sign convention. */
describe("expectedMarginLabel", () => {
  it("names the home side for a positive margin", () => {
    expect(expectedMarginLabel(4.0, "Sharks", "Rabbitohs")).toBe("Sharks by 4.0");
  });
  it("names the away side for a negative margin", () => {
    expect(expectedMarginLabel(-5.5, "Wests Tigers", "Warriors")).toBe("Warriors by 5.5");
  });
  it("calls a zero margin dead level", () => {
    expect(expectedMarginLabel(0, "A", "B")).toBe("dead level");
  });
});

/** Rounding each outcome on its own can print 52 · 27 · 22 = 101 on a bar
 *  legend. pctTriple uses largest-remainder rounding so the three whole
 *  percentages always add up to exactly 100. */
describe("pctTriple", () => {
  const sum = (t: { home: number; draw: number; away: number }) => t.home + t.draw + t.away;

  it("keeps values that already round cleanly", () => {
    expect(pctTriple({ home_win: 0.62, draw: 0.24, away_win: 0.14 })).toEqual({ home: 62, draw: 24, away: 14 });
  });

  it("never sums to 101 when every value rounds up", () => {
    // Independent rounding: 52 + 27 + 22 = 101. The two largest remainders
    // (.9 home, .6 draw) take the two spare points; away keeps its floor.
    const t = pctTriple({ home_win: 0.519, draw: 0.266, away_win: 0.215 });
    expect(sum(t)).toBe(100);
    expect(t).toEqual({ home: 52, draw: 27, away: 21 });
  });

  it("never sums to 99 when every value rounds down", () => {
    // Independent rounding: 33 + 33 + 33 = 99.
    const t = pctTriple({ home_win: 1 / 3, draw: 1 / 3, away_win: 1 / 3 });
    expect(sum(t)).toBe(100);
    expect(t).toEqual({ home: 34, draw: 33, away: 33 });
  });

  it("normalises a feed triple that does not quite sum to 1", () => {
    const t = pctTriple({ home_win: 0.5, draw: 0.3, away_win: 0.19 });
    expect(sum(t)).toBe(100);
  });

  it("sums to 100 across a sweep of awkward triples", () => {
    for (let h = 0; h <= 1000; h += 37) {
      for (let d = 0; d <= 1000 - h; d += 53) {
        const t = pctTriple({ home_win: h / 1000, draw: d / 1000, away_win: (1000 - h - d) / 1000 });
        expect(sum(t)).toBe(100);
      }
    }
  });

  it("returns zeros rather than NaN for an empty triple", () => {
    expect(pctTriple({ home_win: 0, draw: 0, away_win: 0 })).toEqual({ home: 0, draw: 0, away: 0 });
  });
});
