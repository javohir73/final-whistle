import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getUfcFighterServer } from "@/lib/api";
import { isFighterSlug } from "@/lib/ufcDisplay";

/** Real 404s for /ufc/fighter/{slug}. The page's own notFound() runs inside
 *  this segment's loading.tsx Suspense boundary, where it would stream as HTTP
 *  200 (a soft 404); a layout renders before that boundary, so the guard
 *  decides here. A malformed slug is rejected without an API call, an unknown
 *  one on the backend's 404, and a slug the API refuses with a 4xx the same
 *  way. Any other failure lets the page render its own unavailable state. The
 *  page's identical fetch is memoised. */
export default async function FighterLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isFighterSlug(slug)) notFound();
  let fighter;
  try {
    fighter = await getUfcFighterServer(slug);
  } catch (err) {
    // getServer throws "API <path> failed: <status>"; 429 and 408 are not "no such fighter".
    if (/failed: 4(?!08|29)\d\d\b/.test(err instanceof Error ? err.message : "")) notFound();
    return children;
  }
  if (!fighter) notFound();
  return children;
}
