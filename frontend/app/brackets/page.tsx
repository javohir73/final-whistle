import type { Metadata } from "next";
import { APP_NAME } from "@/lib/constants";
import {
  getKnockoutOddsServer,
  getGroupsServer,
  getOfficialBracketServer,
} from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import { Empty } from "@/components/States";
import { Button } from "@/components/ui";
import { BracketsClient } from "./BracketsClient";

export async function generateMetadata(): Promise<Metadata> {
  const tournament = await getCompetitionTournament("wc26");
  if (!tournament.has_brackets) {
    return {
      title: `Bracket — ${APP_NAME}`,
      description: `${tournament.name} is a league — there's no knockout bracket to project.`,
    };
  }
  return {
    title: `Bracket — ${APP_NAME}`,
    description: `The ${tournament.name} knockout bracket: every result from the Round of 32 to the final, beside the model's projected path.`,
  };
}

/** Server-rendered: title odds + projected bracket are in the first HTML. Tabs
 *  and team links hydrate client-side; data refreshes in the background.
 *  C6: a tournament with no knockout stage (has_brackets: false) gets a
 *  friendly empty state instead — see docs/LEAGUE-PIVOT-PLAN.md D6. */
export default async function BracketsPage() {
  const tournament = await getCompetitionTournament("wc26");
  if (!tournament.has_brackets) {
    return (
      <Empty
        label={`${tournament.name} doesn't have a knockout bracket — it's decided on the table.`}
        action={
          <Button href="/football/wc26/fixtures">See fixtures</Button>
        }
      />
    );
  }

  const [initialOdds, initialGroups, initialBracket] = await Promise.all([
    getKnockoutOddsServer().catch(() => null),
    getGroupsServer("wc26").catch(() => null),
    getOfficialBracketServer().catch(() => null),
  ]);
  return (
    <BracketsClient
      initialOdds={initialOdds ?? undefined}
      initialGroups={initialGroups ?? undefined}
      initialBracket={initialBracket ?? undefined}
    />
  );
}
