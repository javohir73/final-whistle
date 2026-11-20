import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGroupServer, getUpcomingMatchesServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import { APP_NAME } from "@/lib/constants";
import { GroupTable, groupDecided } from "@/components/GroupTable";
import { GroupFixtureList } from "@/components/GroupFixtureList";
import { ShareButton } from "@/components/ShareButton";
import { Card, CardHead, Legend, Note, PageHead, TextLink } from "@/components/ui";
import { COMPETITIONS } from "@/lib/sports";

/** Served at /football/wc26/groups/[id]; every exit links its final URL
 *  (the legacy /groups, /brackets and /matches paths are redirect hops). */
const WC26_BASE = COMPETITIONS.wc26.basePath;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [group, tournament] = await Promise.all([
    getGroupServer(id, "wc26"),
    getCompetitionTournament("wc26"),
  ]);
  if (!group) return { title: `Group — ${APP_NAME}` };
  const teams = group.standings.map((s) => s.team).join(", ");
  const title = `${group.name} — standings and results | ${APP_NAME}`;
  const description = `${group.name} at ${tournament.name}: the table and results for ${teams}.`;
  return {
    title, description,
    alternates: { canonical: `/groups/${id}` },
    openGraph: { title, description },
  };
}

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [group, allMatches, tournament] = await Promise.all([
    getGroupServer(id, "wc26"),
    getUpcomingMatchesServer("wc26"),
    getCompetitionTournament("wc26"),
  ]);
  if (!group) notFound();

  const fixtures = (allMatches ?? [])
    .filter((m) => m.group === group.name)
    .sort((a, b) => {
      if (!a.kickoff_utc) return 1;
      if (!b.kickoff_utc) return -1;
      return a.kickoff_utc < b.kickoff_utc ? -1 : 1;
    });
  const decided = groupDecided(group.standings);

  return (
    <div>
      <PageHead
        back={{ href: `${WC26_BASE}/groups`, label: "All groups" }}
        eyebrow={tournament.name}
        title={group.name}
        sub={
          decided
            ? "The final table and every result."
            : "The table so far, with each team's chance of finishing in the top two."
        }
        actions={<ShareButton title={`${group.name} — ${tournament.name} standings`} />}
      />

      <div className="flex max-w-[980px] flex-col gap-6">
        <Card pad aria-labelledby="group-table">
          <CardHead id="group-table" title="Table" />
          <div className="mt-2">
            <GroupTable standings={group.standings} />
          </div>
          {decided ? (
            <Legend items={[{ zone: "a", label: "Top two, through to the Round of 32" }]} />
          ) : (
            <Note className="mt-4 max-w-prose">
              Points and goal difference come from real results. Top 2 is the model&apos;s chance of
              each team finishing in the top two; the eight best third-placed teams also reach the
              Round of 32.
            </Note>
          )}
        </Card>

        <Card flush aria-labelledby="group-matches">
          <h2 id="group-matches" className="px-4 pb-2 pt-5 text-h2 font-semibold text-ink min-[900px]:px-7 min-[900px]:pt-6">
            Matches
          </h2>
          <GroupFixtureList matches={fixtures} />
        </Card>

        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <TextLink href={`${WC26_BASE}/bracket`}>The knockout bracket</TextLink>
          <TextLink href={`${WC26_BASE}/fixtures`}>All matches</TextLink>
        </p>
      </div>
    </div>
  );
}
