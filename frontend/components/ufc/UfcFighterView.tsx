"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardHead,
  Chip,
  DayBand,
  Main,
  Note,
  PageHead,
  PageLayout,
  Stat,
  StatGrid,
  Table,
  TableScroll,
  Td,
  TextLink,
  Th,
} from "@/components/ui";
import { kickoffDate } from "@/lib/datetime";
import {
  eventHref,
  fighterHref,
  heightText,
  isTba,
  methodRoundText,
  reachText,
  recordText,
} from "@/lib/ufcDisplay";
import type { UfcFighterBout, UfcFighterDetail } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { FighterMark } from "./FighterMark";

const EVENT_COLUMN = "hidden min-[900px]:table-cell";

/** "1992-10-14" -> "14 October 1992"; null for anything that is not a date. */
function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** A fight's day: its kickoff in the viewer's zone, or, with no kickoff time,
 *  the event's calendar date as is (shifting a bare date by zone would move it
 *  to the day before for viewers west of UTC). */
function fightDate(b: UfcFighterBout, tz: string): string {
  try {
    if (b.scheduled_utc) return kickoffDate(b.scheduled_utc, tz);
    if (b.event.date) return kickoffDate(`${b.event.date.slice(0, 10)}T00:00:00Z`, "UTC");
  } catch {
    /* fall through */
  }
  return "TBC";
}

function resultChip(b: UfcFighterBout): ReactNode {
  switch (b.status) {
    case "scheduled": return <Chip>Upcoming</Chip>;
    case "live": return <Chip tone="ok">Live</Chip>;
    case "cancelled": return <Chip>Cancelled</Chip>;
    default:
      switch (b.outcome) {
        case "win": return <Chip tone="good">Win</Chip>;
        case "loss": return <Chip tone="miss">Loss</Chip>;
        case "draw": return <Chip>Draw</Chip>;
        case "no_contest": return <Chip>No contest</Chip>;
        default: return <Chip>Result to be confirmed</Chip>;
      }
  }
}

/** The method line repeats a draw or no contest chip, so it only adds to a win or loss. */
function methodLine(b: UfcFighterBout): string | null {
  if (b.status !== "finished" || b.method === "draw" || b.method === "no_contest") return null;
  return methodRoundText(b.method, b.end_round);
}

/** One fighter: head, known facts, and every fight we hold (upcoming first,
 *  as the API orders them). */
export function UfcFighterView({ fighter }: { fighter: UfcFighterDetail }) {
  const { tz } = useTimezone();
  const record = recordText(fighter.record);
  const sub = [fighter.country, record ? `UFC record ${record}` : "No UFC fights on record yet"]
    .filter(Boolean)
    .join(" · ");

  const facts: { label: string; value: string }[] = [
    { label: "Age", value: fighter.age != null ? String(fighter.age) : "" },
    { label: "Born", value: longDate(fighter.date_of_birth) ?? "" },
    { label: "Height", value: heightText(fighter.height_in) ?? "" },
    { label: "Reach", value: reachText(fighter.reach_in) ?? "" },
    { label: "Stance", value: fighter.stance?.trim() ?? "" },
  ].filter((f) => f.value);

  return (
    <>
      <PageHead
        leading={<FighterMark name={fighter.name} size={48} decorative />}
        eyebrow="UFC fighter"
        title={fighter.name}
        sub={sub}
      />
      <PageLayout>
        <Main>
          <Card pad aria-labelledby="fighter-facts">
            <CardHead id="fighter-facts" title="Fighter facts" />
            {facts.length > 0 ? (
              <StatGrid>
                {facts.map((f) => (
                  <Stat key={f.label} value={f.value} label={f.label} />
                ))}
              </StatGrid>
            ) : (
              <Note className="mt-1.5">Height, reach and date of birth are not available yet.</Note>
            )}
          </Card>

          <Card flush aria-label="Fights">
            <DayBand as="h2">Fights</DayBand>
            {fighter.bouts.length > 0 ? (
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <Th align="left">Date</Th>
                      <Th align="left">Opponent</Th>
                      <Th align="left">Result</Th>
                      <Th align="left" className={EVENT_COLUMN}>Event</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {fighter.bouts.map((b) => (
                      <tr key={b.id}>
                        <Td align="left">{fightDate(b, tz)}</Td>
                        <Td align="left" className="whitespace-normal break-words">
                          {isTba(b.opponent) ? (
                            b.opponent.name
                          ) : (
                            <TextLink href={fighterHref(b.opponent.slug)}>{b.opponent.name}</TextLink>
                          )}
                        </Td>
                        <Td align="left">
                          {resultChip(b)}
                          {methodLine(b) ? <div className="mt-1 text-notes text-muted">{methodLine(b)}</div> : null}
                        </Td>
                        <Td align="left" className={`${EVENT_COLUMN} whitespace-normal`}>
                          <TextLink href={eventHref(b.event.slug)}>{b.event.name}</TextLink>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            ) : (
              <Note className="px-4 py-5 min-[900px]:px-7">No fights on record yet.</Note>
            )}
          </Card>
        </Main>
      </PageLayout>
    </>
  );
}
