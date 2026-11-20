"use client";

import type { ReactNode } from "react";
import { useModelReveal, type ModelReveal, type RevealFixture, type RevealOptions } from "@/lib/useModelReveal";

/** Renders `children` only when the reveal rule (lib/reveal.ts) lets this
 *  viewer see the model's call for `fixture`; otherwise `fallback` (the
 *  locked/hidden state). Lets a SERVER component keep rendering the model's
 *  section and gate it with one client wrapper: the server HTML and the first
 *  client pass are the fallback for an open fixture, so nothing flashes.
 *
 *  `children` may be a function of the answer, for sections that also want
 *  the viewer's pick ("You 2–1 · Model 1–1"). Unstyled on purpose. */
export function ModelGate({
  fixture,
  fallback = null,
  options,
  children,
}: {
  fixture: RevealFixture;
  fallback?: ReactNode | ((reveal: ModelReveal) => ReactNode);
  options?: RevealOptions;
  children: ReactNode | ((reveal: ModelReveal) => ReactNode);
}) {
  const reveal = useModelReveal(fixture, options);
  if (!reveal.revealed) return <>{typeof fallback === "function" ? fallback(reveal) : fallback}</>;
  return <>{typeof children === "function" ? children(reveal) : children}</>;
}
