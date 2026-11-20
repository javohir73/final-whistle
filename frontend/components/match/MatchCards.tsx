import { TeamBadge } from "@/components/TeamBadge";
import { Button, Card, CardHead, ClubCell, LockedList, Note, Table, TableScroll, Td, TextLink, Th } from "@/components/ui";
import { signedNumber } from "@/lib/standingsRows";
import type { Standing, StandingLine } from "@/components/match/matchPageData";

/** "Why the model thinks so": the API's own reasons, as bullets. */
export function WhyCard({ reasons, id = "why" }: { reasons: string[]; id?: string }) {
  return (
    <Card pad id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
      <h2 id={`${id}-heading`} className="text-h2 font-semibold text-ink">
        Why the model thinks so
      </h2>
      <ul className="mt-3.5 list-disc pl-5 text-ink">
        {reasons.map((r) => (
          <li key={r} className="py-1">
            {r}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The hidden state of an open, unpicked fixture: what locking unlocks,
 *  listing only what this page will really show. No numbers anywhere. */
export function LockedCard({ items }: { items: string[] }) {
  return (
    <Card pad aria-labelledby="unlock-heading">
      <h2 id="unlock-heading" className="text-h2 font-semibold text-ink">
        Unlocked when you lock your pick
      </h2>
      <Note className="mt-1.5">The model has already made its call. You see it the moment yours is in.</Note>
      <LockedList items={items} />
    </Card>
  );
}

/** The model's call is being read (after a lock, or at kickoff). Same box,
 *  no numbers. */
export function CallLoading({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card pad aria-labelledby="call-wait-heading" id="forecast" className="scroll-mt-28">
      <h2 id="call-wait-heading" className="text-h2 font-semibold text-ink">
        The model’s call
      </h2>
      {onRetry ? (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Note>The model’s call couldn’t load.</Note>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <div role="status" aria-label="Loading the model’s call…">
          <div className="mt-3 h-3 w-48 rounded-md bg-line-soft" />
          <div className="mt-[18px] h-3 w-full rounded-md bg-line-soft" />
        </div>
      )}
    </Card>
  );
}

/** A just-drawn tie whose prediction is not generated yet. */
export function PendingCard() {
  return (
    <Card pad aria-labelledby="pending-heading">
      <h2 id="pending-heading" className="text-h2 font-semibold text-ink">
        The model’s call is on the way
      </h2>
      <Note className="mt-1.5">
        The model makes its call shortly after both teams are confirmed. Check back soon.
      </Note>
    </Card>
  );
}

/** "Where they stand": the two clubs' rows from the real table. */
export function WhereTheyStand({
  standing,
  teamHref,
  tableHref,
  tableLabel,
}: {
  standing: Standing;
  teamHref: (row: StandingLine) => string | undefined;
  tableHref: string;
  tableLabel: string;
}) {
  const rows = [standing.home, standing.away].filter((r): r is StandingLine => r != null).sort((a, b) => a.pos - b.pos);
  if (rows.length === 0) return null;
  return (
    <Card pad aria-labelledby="stand-heading">
      <CardHead id="stand-heading" title="Where they stand" />
      <Note className="mt-1.5">{standing.note}</Note>
      <TableScroll className="mt-2.5">
        <Table>
          <thead>
            <tr>
              <Th align="left">
                <span className="sr-only">Position</span>
              </Th>
              <Th align="left">Club</Th>
              <Th>
                <abbr title="Won" className="no-underline">W</abbr>
              </Th>
              <Th>
                <abbr title="Drawn" className="no-underline">D</abbr>
              </Th>
              <Th>
                <abbr title="Lost" className="no-underline">L</abbr>
              </Th>
              <Th>
                <abbr title="Goal difference" className="no-underline">GD</abbr>
              </Th>
              <Th>
                <abbr title="Points" className="no-underline">Pts</abbr>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId}>
                <Td pos>{r.pos}</Td>
                <Td align="left">
                  <ClubCell href={teamHref(r)} crest={<TeamBadge team={r.team} size={20} decorative />} name={r.team} />
                </Td>
                <Td>{r.won}</Td>
                <Td>{r.drawn}</Td>
                <Td>{r.lost}</Td>
                <Td>{signedNumber(r.gd)}</Td>
                <Td pts>{r.points}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <p className="mt-4">
        <TextLink href={tableHref}>{tableLabel}</TextLink>
      </p>
    </Card>
  );
}
