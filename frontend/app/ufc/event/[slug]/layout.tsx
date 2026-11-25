import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getUfcEventServer } from "@/lib/api";
import { isEventSlug } from "@/lib/ufcDisplay";

/** Decides the 404 before loading.tsx streams, so an unknown card answers
 *  with a real 404. The page's identical fetch is memoised. A thrown fetch
 *  lets the page render its own "unavailable" state. */
export default async function UfcEventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isEventSlug(slug)) notFound();
  let event;
  try {
    event = await getUfcEventServer(slug);
  } catch {
    return children;
  }
  if (event === null) notFound();
  return children;
}
