import { ClubBadge } from "@/components/ClubBadge";
import { Card, CardHead, ClubCell, Note, Table, Td, TextLink, Th } from "@/components/ui";
import type { LadderRow } from "@/lib/types";

/** The rail's ladder card (prototype `ladderCard`): the top `count` clubs with
 *  crest, W–L and points, a link to the full ladder. Used on the NRL home,
 *  the model's record and club pages. `title`/`note` switch between the
 *  in-season ("Ladder") and the final ("Final ladder") wording. */
export function LadderCard({
  rows,
  count = 8,
  title = "Final ladder",
  note = "The top eight played finals.",
  highlightTeamId,
}: {
  rows: LadderRow[];
  count?: number;
  title?: string;
  note?: string | null;
  /** The club whose page this is: its row is marked (aria-current + soft fill). */
  highlightTeamId?: number | null;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, count);
  return (
    <Card pad aria-labelledby="nrl-ladder-card">
      <CardHead
        id="nrl-ladder-card"
        title={title}
        action={<TextLink href="/nrl/ladder">All {rows.length} clubs</TextLink>}
      />
      <Table className="mt-2">
        <thead>
          <tr>
            <Th align="left">
              <span className="sr-only">Position</span>
            </Th>
            <Th align="left">Club</Th>
            <Th>W–L</Th>
            <Th>Pts</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr
              key={r.team_id}
              aria-current={r.team_id === highlightTeamId ? "true" : undefined}
              className={r.team_id === highlightTeamId ? "bg-soft" : undefined}
            >
              <Td pos>{r.rank}</Td>
              <Td align="left" className="whitespace-normal">
                <ClubCell
                  href={`/nrl/team/${r.team_id}`}
                  crest={<ClubBadge name={r.name} size={26} decorative />}
                  name={r.name}
                />
              </Td>
              <Td>
                {r.wins}–{r.losses}
              </Td>
              <Td pts>{r.points}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {note ? <Note className="mt-3">{note}</Note> : null}
    </Card>
  );
}
