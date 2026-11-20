"use client";

import { useMemo } from "react";
import { getGroups } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { COMPETITIONS, footballMatchHref, type CompetitionId } from "@/lib/sports";
import { dedupeStandings, seasonLabel } from "@/lib/standingsRows";
import { FULL_LEAGUE_COLUMNS, StandingsTable, type StandingsNext } from "@/components/StandingsTable";
import { Card, EmptyState, GhostButton, PageHead } from "@/components/ui";
import type { ActiveTournament, Group } from "@/lib/types";

export type NextByClub = Record<string, { matchId: number; opponent: string; home: boolean }>;

/** Canonical standings surface for league-format football competitions,
 *  including the Champions League's single-table league phase (prototype
 *  `pageTable`). WC26 keeps its multi-group /groups grid and 404s here (see
 *  page.tsx). When the single-league shape isn't present we degrade to an
 *  honest empty state rather than invent an endpoint. */
export function StandingsClient({
  comp,
  initialGroups,
  tournament,
  nextByClub,
  played = null,
}: {
  comp: CompetitionId;
  initialGroups?: Group[];
  tournament: ActiveTournament;
  /** Each club's next fixture, by club name (from one fixtures request). */
  nextByClub?: NextByClub;
  /** Matchweeks (UCL: matchdays) played so far. */
  played?: number | null;
}) {
  const state = useFetch(() => getGroups(comp), [comp], 30_000, initialGroups);
  const competition = COMPETITIONS[comp];
  const leagueMode =
    tournament.format === "league" && state.status === "success" && state.data.length === 1;
  const rows = useMemo(
    () => (leagueMode && state.status === "success" ? dedupeStandings(state.data[0].standings) : []),
    [leagueMode, state],
  );
  // A cross-border competition's table group exists before its draw is made
  // (UCL ships with an empty league-phase group all summer). Zero rows must
  // read as "no draw yet", not as a broken table.
  const hasRows = rows.length > 0;
  const isUnplayed =
    hasRows &&
    rows.every(
      (row) =>
        (row.played ?? 0) === 0 &&
        (row.won ?? 0) === 0 &&
        (row.drawn ?? 0) === 0 &&
        (row.lost ?? 0) === 0 &&
        row.projected_points === 0 &&
        row.projected_goals_for === 0 &&
        row.projected_goal_diff === 0,
    );

  const next = useMemo(() => {
    if (!nextByClub || !hasRows) return undefined;
    const out: Record<number, StandingsNext | undefined> = {};
    let any = false;
    for (const row of rows) {
      const nx = nextByClub[row.team];
      if (!nx) continue;
      any = true;
      out[row.team_id] = {
        label: `v ${nx.opponent} (${nx.home ? "H" : "A"})`,
        href: footballMatchHref(comp, nx.matchId),
        ariaLabel: `${row.team} next: ${nx.opponent}, ${nx.home ? "at home" : "away"}`,
      };
    }
    return any ? out : undefined;
  }, [nextByClub, hasRows, rows, comp]);

  const season = seasonLabel(tournament.year);
  const eyebrow = season ? `${competition.label} · ${season}` : competition.label;
  const unit = comp === "ucl" ? "matchday" : "matchweek";
  const title = comp === "ucl" ? competition.terms.standings : "Table";
  const choose = "Choose a club for its results and next matches.";
  let sub: string;
  if (state.status === "success" && !hasRows) {
    sub = "The table appears here once the draw is made and fixtures load.";
  } else if (isUnplayed) {
    sub = "Season not started. Clubs are listed in no particular order until the first result.";
  } else if (played) {
    sub = `After ${played} ${unit}${played === 1 ? "" : "s"}. ${choose}`;
  } else {
    sub = choose;
  }

  return (
    <div>
      <PageHead eyebrow={eyebrow} title={title} sub={sub} />

      {state.status === "loading" && (
        <Card pad className="max-w-[1080px]" aria-busy="true" aria-label="Loading the table">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex h-[47px] items-center gap-4 border-t border-line-soft first:border-t-0">
              <span className="h-3.5 w-4 rounded-sm bg-line-soft" />
              <span className="h-[22px] w-[22px] rounded-sm bg-line-soft" />
              <span className="h-3.5 w-40 rounded-sm bg-line-soft" />
            </div>
          ))}
        </Card>
      )}
      {state.status === "error" && (
        <EmptyState
          className="max-w-[1080px]"
          title="The table didn’t load"
          actions={<GhostButton onClick={state.retry}>Try again</GhostButton>}
        >
          The connection to the server dropped. Try again in a moment.
        </EmptyState>
      )}
      {state.status === "success" &&
        (hasRows ? (
          <Card pad className="max-w-[1080px]">
            <StandingsTable
              standings={rows}
              zones={isUnplayed ? [] : competition.zones}
              badge="club"
              teamBasePath={`${competition.basePath}/team`}
              teamHeader="Club"
              columns={FULL_LEAGUE_COLUMNS}
              next={isUnplayed ? undefined : next}
              caption={`${competition.label} ${title.toLowerCase()}`}
            />
          </Card>
        ) : (
          <EmptyState className="max-w-[1080px]" title="No table yet">
            {leagueMode
              ? `It fills in once the ${competition.label} draw is made.`
              : `${competition.label} standings are not available yet.`}
          </EmptyState>
        ))}
    </div>
  );
}
