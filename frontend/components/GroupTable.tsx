import type { StandingRow } from "@/lib/types";
import { COMPETITIONS } from "@/lib/sports";
import { pct } from "@/lib/format";
import { Flag } from "@/components/Flag";
import { ClubCell, Table, TableScroll, Td, Th } from "@/components/ui";

/** True once every team's top-two chance has settled at 0 or 1 — the group is
 *  decided (the World Cup archive: every group is). A decided group drops the
 *  "Top 2" chance column (100% / 0% says nothing) and marks the top two with
 *  the brand zone marker instead. */
export function groupDecided(standings: StandingRow[]): boolean {
  return (
    standings.length > 0 &&
    standings.every((s) => s.qualification_prob == null || s.qualification_prob === 0 || s.qualification_prob === 1)
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** A World Cup group table on the shared table parts: position (brand marker on
 *  the top two once the group is decided), the nation with its flag, then
 *  P / W / D / L / GD / Pts (`compact` keeps P / GD / Pts for the group cards),
 *  and the model's "Top 2" chance while the group is still open.
 *
 *  `mode="league"` (a one-group league table) never shows the Top-2 column:
 *  "top two" is not a finish line in a 20-team league. */
export function GroupTable({
  standings,
  highlightTeamId,
  mode = "group",
  compact = false,
  // Group tables are a World Cup surface (hasGroups), so team links default
  // to its scoped team pages, not the /team/:id lookup's extra hop.
  teamBasePath = `${COMPETITIONS.wc26.basePath}/team`,
}: {
  standings: StandingRow[];
  highlightTeamId?: number;
  mode?: "group" | "league";
  /** P / GD / Pts only (the group cards on the groups page). */
  compact?: boolean;
  teamBasePath?: string;
}) {
  const decided = groupDecided(standings);
  const showTop2 = mode === "group" && !decided;
  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th align="left">
              <span className="sr-only">Position</span>
            </Th>
            <Th align="left">Team</Th>
            <Th>
              <abbr title="Played" className="no-underline">P</abbr>
            </Th>
            {!compact && (
              <>
                <Th>
                  <abbr title="Won" className="no-underline">W</abbr>
                </Th>
                <Th>
                  <abbr title="Drawn" className="no-underline">D</abbr>
                </Th>
                <Th>
                  <abbr title="Lost" className="no-underline">L</abbr>
                </Th>
              </>
            )}
            <Th>
              <abbr title="Goal difference" className="no-underline">GD</abbr>
            </Th>
            <Th>Pts</Th>
            {showTop2 && <Th>Top 2</Th>}
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => {
            const pos = i + 1;
            const highlight = s.team_id === highlightTeamId;
            return (
              <tr key={s.team_id} aria-current={highlight ? "true" : undefined} className={highlight ? "bg-soft" : undefined}>
                <Td pos zone={decided && mode === "group" && pos <= 2 ? "a" : undefined}>
                  {pos}
                </Td>
                <Td align="left" className="w-full whitespace-normal">
                  <ClubCell
                    href={`${teamBasePath}/${s.team_id}`}
                    crest={<Flag team={s.team} size={22} decorative />}
                    name={s.team}
                  />
                </Td>
                <Td>{s.played ?? "–"}</Td>
                {!compact && (
                  <>
                    <Td>{s.won ?? "–"}</Td>
                    <Td>{s.drawn ?? "–"}</Td>
                    <Td>{s.lost ?? "–"}</Td>
                  </>
                )}
                <Td>{signed(s.projected_goal_diff)}</Td>
                <Td pts>{s.projected_points}</Td>
                {showTop2 && <Td>{s.qualification_prob != null ? pct(s.qualification_prob) : "–"}</Td>}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}
