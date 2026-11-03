import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import { redirectLegacyMatch } from "@/lib/competitionServer";

/** /match/:id is a lookup, not a page: the partner embed's backlink, every
 *  share since June and old card links land here, and it 308s to the match's
 *  own /football/{comp}/match/:id (WC26 when the backend can't say). The
 *  static next.config.mjs redirect it replaces sent every id to WC26, a soft
 *  404 for any club match.
 *
 *  The redirect is thrown from ./layout.tsx -- this segment's loading.tsx
 *  (also the scoped route's skeleton) wraps the page in Suspense, where a
 *  redirect would stream as a 200 with a meta refresh. The page repeats the
 *  call only so the route never renders content if the layout changes. */
export const metadata: Metadata = {
  title: `Match — ${APP_NAME}`,
  robots: { index: false, follow: true },
};

export default async function LegacyMatchLookupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return redirectLegacyMatch(id);
}
