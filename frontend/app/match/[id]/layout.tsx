import { redirectLegacyMatch } from "@/lib/competitionServer";

/** Runs the /match/:id lookup before any streamed output (see page.tsx): a
 *  segment's layout renders outside that segment's loading.tsx boundary, so
 *  the 308 and the 404 are real HTTP statuses, not a meta refresh or a soft
 *  404. Never renders its children. */
export default async function LegacyMatchLookupLayout({
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return redirectLegacyMatch(id);
}
