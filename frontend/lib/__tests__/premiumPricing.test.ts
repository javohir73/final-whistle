/** The annual saving must be arithmetic, not a slogan.
 *
 *  The pricing page claimed "2 months free". Twelve months at $4.99 is $59.88;
 *  the annual plan is $39.99. The saving is $19.89 — 33%, or very nearly FOUR
 *  months. The hardcoded claim understated the discount and was still factually
 *  wrong, which is the worst of both outcomes for a paid tier.
 */
import { PREMIUM_PRICING, annualSaving, annualSavingLabel } from "@/lib/premium";

it("computes the saving from the listed prices", () => {
  const { twelveMonths, saved, percent } = annualSaving();
  expect(twelveMonths).toBe(59.88);
  expect(saved).toBe(19.89);
  expect(percent).toBe(33);
});

it("does not claim two months free", () => {
  // Two months free would be $49.90. It is not what these prices say.
  const twoMonthsFreePrice = PREMIUM_PRICING.monthly * 10;
  expect(PREMIUM_PRICING.annual).not.toBeCloseTo(twoMonthsFreePrice, 2);
  expect(annualSavingLabel().toLowerCase()).not.toContain("month");
});

it("states the saving in both percent and dollars", () => {
  expect(annualSavingLabel()).toBe("Save 33% · $19.89 a year");
});

it("stays correct if the prices change", () => {
  // The point of deriving it: the claim tracks the numbers. Recomputed here
  // the same way a reader would, against the constants rather than literals.
  const { saved, percent } = annualSaving();
  expect(saved).toBeCloseTo(PREMIUM_PRICING.monthly * 12 - PREMIUM_PRICING.annual, 2);
  expect(percent).toBe(
    Math.round((saved / (PREMIUM_PRICING.monthly * 12)) * 100),
  );
});
