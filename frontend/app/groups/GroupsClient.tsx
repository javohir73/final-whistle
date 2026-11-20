"use client";

import { usePathname } from "next/navigation";
import { getGroups, getUpcomingMatches } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { GroupCard } from "@/components/GroupCard";
import { groupDecided } from "@/components/GroupTable";
import { StandingsTable } from "@/components/StandingsTable";
import { ErrorState, Empty } from "@/components/States";
import { Card, Legend, PageHead } from "@/components/ui";
import {
  COMPETITIONS,
  competitionFromPathname,
  type CompetitionId,
} from "@/lib/sports";
import type { ActiveTournament, Group } from "@/lib/types";

export function GroupsClient({
  initialGroups,
  tournament,
  competition,
}: {
  initialGroups?: Group[];
  tournament: ActiveTournament;
  competition?: CompetitionId;
}) {
  const pathname = usePathname() ?? "";
  const activeCompetition = competition ?? competitionFromPathname(pathname);
  const state = useFetch(
    () => getGroups(activeCompetition),
    [activeCompetition],
    30_000,
    initialGroups,
  );
  // Match feed drives the per-group Live chip. Polled alongside groups; if it
  // fails or is still loading, matches stays empty and no chip shows.
  const matchesState = useFetch(
    () => getUpcomingMatches(activeCompetition),
    [activeCompetition],
    30_000,
  );
  const matches = matchesState.status === "success" ? matchesState.data : undefined;
  // D1: a league is one Tournament + a single Group holding every team — show
  // it as one full-width table instead of the World Cup multi-group grid.
  const leagueMode =
    tournament.format === "league" && state.status === "success" && state.data.length === 1;
  // The World Cup archive: every group settled, so the page reads as final.
  const allDecided =
    state.status === "success" && state.data.length > 0 && state.data.every((g) => groupDecided(g.standings));

  return (
    <div>
      <PageHead
        eyebrow={leagueMode ? undefined : tournament.name}
        title={leagueMode ? tournament.name : "Group tables"}
        sub={
          leagueMode
            ? "Standings, updated as results come in."
            : allDecided
              ? "The final group tables. The top two in each group went through to the Round of 32, with the eight best third-placed teams."
              : "Standings with each team's chance of finishing in the top two."
        }
      />

      {state.status === "loading" && (
        <div className="grid gap-6 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3" aria-busy="true" aria-label="Loading groups">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card pad key={i}>
              <div className="h-5 w-24 rounded-full bg-line-soft" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="mt-4 h-4 w-full rounded-full bg-line-soft" />
              ))}
            </Card>
          ))}
        </div>
      )}
      {state.status === "error" && <ErrorState message={state.message} onRetry={state.retry} />}
      {state.status === "success" &&
        (state.data.length === 0 ? (
          <Empty />
        ) : leagueMode ? (
          <Card pad>
            <StandingsTable
              standings={state.data[0].standings}
              zones={COMPETITIONS[activeCompetition].zones}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-6 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3">
              {state.data.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  matches={matches}
                  groupBasePath={`${COMPETITIONS[activeCompetition].basePath}/groups`}
                  teamBasePath={`${COMPETITIONS[activeCompetition].basePath}/team`}
                />
              ))}
            </div>
            {allDecided && <Legend items={[{ zone: "a", label: "Top two, through to the Round of 32" }]} />}
          </>
        ))}
    </div>
  );
}
