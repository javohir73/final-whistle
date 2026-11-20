import { notFound } from "next/navigation";
import { COMPETITIONS, isWiredFootballCompetition } from "@/lib/sports";
import LegacyBracketsPage from "@/app/brackets/page";

export { generateMetadata } from "@/app/brackets/page";

// Wraps app/brackets/page.tsx, which is the World
// Cup's bracket and takes no params. Only a competition the registry marks
// hasBracket (WC26) may serve it: /football/epl/bracket used to 200 with the
// World Cup bracket. isWiredFootballCompetition also 404s /football/nrl/...
// (NRL keeps its own space). No loading.tsx in this segment, so notFound()
// here runs before any streamed output and is a real 404.
export default async function CompBracketPage({
  params,
}: {
  params: Promise<{ comp: string }>;
}) {
  const { comp } = await params;
  if (!isWiredFootballCompetition(comp) || !COMPETITIONS[comp].hasBracket) notFound();
  return <LegacyBracketsPage />;
}
