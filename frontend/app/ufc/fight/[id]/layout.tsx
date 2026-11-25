import { notFound } from "next/navigation";
import { getUfcBoutServer } from "@/lib/api";
import { isBoutId } from "@/lib/ufcDisplay";

/** Decides the 404 before loading.tsx streams: a layout renders outside the
 *  segment's loading boundary, so a missing fight is a real HTTP 404. A thrown
 *  fetch lets the page render its own "unavailable" state. */
export default async function FightLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isBoutId(id)) notFound();
  let missing = false;
  try {
    missing = (await getUfcBoutServer(id)) === null;
  } catch {
    missing = false;
  }
  if (missing) notFound();
  return children;
}
