import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_NAME, BILLING_ENABLED } from "@/lib/constants";
import { PremiumClient } from "./PremiumClient";

export const metadata: Metadata = {
  title: `Premium — ${APP_NAME}`,
  description:
    "The analyst tier: full scoreline grids, totals, BTTS and Asian handicap probabilities for every match, from the same audited model.",
};

/** useSearchParams() requires a Suspense boundary in the App Router.
 *  Billing off (BILLING_ENABLED=false) -> 404: the pricing surface must not
 *  exist while billing isn't live. */
export default function PremiumPage() {
  if (!BILLING_ENABLED) notFound();
  return (
    <Suspense fallback={null}>
      <PremiumClient />
    </Suspense>
  );
}
