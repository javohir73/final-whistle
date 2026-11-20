"use client";

import { useEffect, useState } from "react";
import { getGroups } from "@/lib/api";
import { COMPETITIONS, competitionLinks, footballTeamHref, isWiredFootballCompetition } from "@/lib/sports";
import { clubShortName, dedupeStandings, signedNumber } from "@/lib/standingsRows";
import type { StandingRow } from "@/lib/types";
import { ClubBadge } from "@/components/ClubBadge";
import { Card, CardHead, ClubCell, Table, Td, TextLink, Th } from "@/components/ui";

type State =
  | { status: "loading" }
  | { status: "ready"; rows: StandingRow[] }
  | { status: "none" };

/** The competition's league table, if it has one: a football competition in
 *  league format whose /api/groups answer is a single table with rows. */
function leagueRows(groups: { standings: StandingRow[] }[]): StandingRow[] {
  if (groups.length !== 1) return [];
  return dedupeStandings(groups[0].standings ?? []);
}

/** Header cell with a short visible label and a full spoken one. */
function AbbrTh({ short, full, className }: { short: string; full: string; className?: string }) {
  return (
    <Th title={full} className={className}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{full}</span>
    </Th>
  );
}

/** Rail card: the top of a competition's table (prototype `miniTable`).
 *  Fetches the standings itself; renders nothing for competitions without a
 *  league table (knockout, archive, NRL) or when the request fails. */
export function MiniTableCard({ competition, limit = 6 }: { competition: string; limit?: number }) {
  const comp = isWiredFootballCompetition(competition) ? competition : null;
  const hasTable = comp != null && COMPETITIONS[comp].format === "league" && !COMPETITIONS[comp].archived;
  const [state, setState] = useState<State>({ status: hasTable ? "loading" : "none" });

  useEffect(() => {
    if (!hasTable || !comp) {
      setState({ status: "none" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    getGroups(comp)
      .then((groups) => {
        if (!active) return;
        const rows = leagueRows(groups);
        setState(rows.length ? { status: "ready", rows } : { status: "none" });
      })
      .catch(() => active && setState({ status: "none" }));
    return () => {
      active = false;
    };
  }, [comp, hasTable]);

  if (!comp || state.status === "none") return null;
  const links = competitionLinks(comp);

  return (
    <Card pad aria-labelledby={`mini-table-${comp}`} data-mini-table={comp}>
      <CardHead id={`mini-table-${comp}`} title="Table" action={<TextLink href={links.table}>Full table</TextLink>} />
      {/* Fixed layout: the number columns get just what they need and the
          club column takes the rest, so each row stays on one line. */}
      <Table className="mt-2 table-fixed">
        <thead>
          <tr>
            <Th align="left" className="w-6 pr-1">
              <span className="sr-only">Position</span>
            </Th>
            <Th align="left" className="pl-1">Club</Th>
            <AbbrTh short="P" full="Played" className="w-[30px] px-1" />
            <AbbrTh short="GD" full="Goal difference" className="w-10 px-1" />
            <AbbrTh short="Pts" full="Points" className="w-9 pl-1" />
          </tr>
        </thead>
        <tbody aria-busy={state.status === "loading" || undefined}>
          {state.status === "loading"
            ? Array.from({ length: limit }).map((_, i) => (
                <tr key={i} aria-hidden="true">
                  <Td pos>
                    <span className="inline-block h-[18px] w-3 rounded-sm bg-line-soft align-middle" />
                  </Td>
                  <Td align="left" className="pl-1">
                    <span className="inline-flex items-center gap-3 align-middle">
                      <span className="inline-block h-[18px] w-[18px] rounded-sm bg-line-soft" />
                      <span className="inline-block h-3.5 w-20 rounded-sm bg-line-soft" />
                    </span>
                  </Td>
                  <Td>
                    <span className="inline-block h-3.5 w-4 rounded-sm bg-line-soft align-middle" />
                  </Td>
                  <Td>
                    <span className="inline-block h-3.5 w-5 rounded-sm bg-line-soft align-middle" />
                  </Td>
                  <Td>
                    <span className="inline-block h-3.5 w-5 rounded-sm bg-line-soft align-middle" />
                  </Td>
                </tr>
              ))
            : state.rows.slice(0, limit).map((row, i) => (
                <tr key={row.team_id}>
                  <Td pos className="w-6 pr-1">{i + 1}</Td>
                  <Td align="left" className="pl-1">
                    {/* Short name where the helper has one; otherwise the
                        full name, cut with an ellipsis only if it cannot fit
                        (the full name stays in the tooltip). */}
                    <ClubCell
                      href={footballTeamHref(comp, row.team_id)}
                      crest={<ClubBadge name={row.team} size={18} decorative className="shrink-0" />}
                      name={
                        <span className="block truncate" title={row.team}>
                          {clubShortName(row.team)}
                        </span>
                      }
                      className="flex max-w-full gap-2 [&>span]:min-w-0"
                    />
                  </Td>
                  <Td className="px-1 tabular-nums">{row.played ?? ""}</Td>
                  <Td className="px-1 tabular-nums">{signedNumber(row.projected_goal_diff)}</Td>
                  <Td pts className="pl-1 tabular-nums">
                    {row.projected_points}
                  </Td>
                </tr>
              ))}
        </tbody>
      </Table>
    </Card>
  );
}

export default MiniTableCard;
