"use client";

import type { StandingRow } from "@/lib/types";
import { COMPETITIONS } from "@/lib/sports";
import { StandingsTable } from "./StandingsTable";

/** Thin wrapper over StandingsTable so the WC26 group tables and the league
 *  standings share one styling source (Floodlight P2). Keeps its original
 *  public shape (`standings`, `highlightTeamId`, `mode`) so GroupCard and the
 *  group-detail page compile unchanged. Groups have no CL/Europa/relegation
 *  finish lines, so `zones` is always [] here -- the story is the Top-2
 *  QualificationBar column (`showQualification`); league zone stripes are
 *  injected by callers that render StandingsTable directly (GroupsClient). */
export function GroupTable({
  standings,
  highlightTeamId,
  mode = "group",
  // Group tables are a World Cup surface (hasGroups), so team links default
  // to its scoped team pages, not the /team/:id lookup's extra hop.
  teamBasePath = `${COMPETITIONS.wc26.basePath}/team`,
}: {
  standings: StandingRow[];
  highlightTeamId?: number;
  /** "group": WC-style 4-team group — Top-2 qualification column.
   *  "league": full-season table — the sim's qualification_prob still means
   *  "top two", which is not a real finish line in a 20-team league, so the
   *  column is dropped until the simulator grows league finish lines. */
  mode?: "group" | "league";
  teamBasePath?: string;
}) {
  return (
    <StandingsTable
      standings={standings}
      zones={[]}
      highlightTeamId={highlightTeamId}
      showQualification={mode === "group"}
      teamBasePath={teamBasePath}
    />
  );
}
