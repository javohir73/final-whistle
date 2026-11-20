import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNrlMatchesServer } from "@/lib/api";
import { canRevealModelPublicly } from "@/lib/reveal";
import { MatchesClient } from "./MatchesClient";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "NRL fixtures — FinalWhistle",
  description:
    "Every NRL fixture and result, with the model's call on each finished match.",
};

export default async function NrlMatchesPage() {
  const fixtures = await getNrlMatchesServer().catch(() => null);
  if (!fixtures) notFound();
  // The reveal rule: an open match's prediction never reaches the HTML (the
  // client island would serialise it). Finished / kicked-off ones keep theirs.
  const now = new Date();
  const safe = {
    ...fixtures,
    rounds: fixtures.rounds.map((r) => ({
      ...r,
      matches: r.matches.map((m) =>
        canRevealModelPublicly("nrl", m.status, m.kickoff_utc, now) ? m : { ...m, prediction: null },
      ),
    })),
  };
  return <MatchesClient initial={safe} />;
}
