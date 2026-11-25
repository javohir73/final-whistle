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
  Table,
  TableScroll,
  Td,
  TextLink,
  Th,
} from "@/components/ui";
import {
  boutHref,
  dateWithYear,
  eventHref,
  fighterHref,
  heightText,
  isTba,
  methodRoundText,
  reachText,
  recordText,
  stanceText,
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

function fightDate(b: UfcFighterBout, tz: string): string {
  const iso = b.scheduled_utc ?? b.event.date;
  if (!iso) return "TBC";
  try {
    return dateWithYear(iso, tz);
  } catch {
    return "TBC";
  }
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

function methodLine(b: UfcFighterBout): string | null {
  return b.status === "finished" ? methodRoundText(b.method, b.end_round) : null;
}

/** One fighter: head, known facts, and every fight we hold (upcoming first,
 *  as the API orders them). */
export function UfcFighterView({ fighter }: { fighter: UfcFighterDetail }) {
  const { tz } = useTimezone();
  const record = recordText(fighter.record);
  // A null record means "not loaded", never "no fights": say only what we know.
  const sub = [fighter.country, record ? `UFC record ${record}` : null].filter(Boolean).join(" · ");

  const facts: { label: string; value: string }[] = [
    { label: "Age", value: fighter.age != null && fighter.age > 0 ? String(fighter.age) : "" },
    { label: "Born", value: longDate(fighter.date_of_birth) ?? "" },
    { label: "Height", value: heightText(fighter.height_in) ?? "" },
    { label: "Reach", value: reachText(fighter.reach_in) ?? "" },
    { label: "Stance", value: stanceText(fighter.stance) ?? "" },
  ].filter((f) => f.value);

  return (
    <>
      <PageHead
        leading={<FighterMark name={fighter.name} size={48} decorative />}
        eyebrow="UFC fighter"
        title={fighter.name}
        sub={sub || undefined}
      />
      <PageLayout>
        <Main>
          <Card pad aria-labelledby="fighter-facts">
            <CardHead id="fighter-facts" title="Fighter facts" />
            {facts.length > 0 ? (
              <dl className="mt-2 max-w-[550px]">
                {facts.map((f) => (
                  <div
                    key={f.label}
                    className="flex items-baseline justify-between gap-4 border-t border-line-soft py-3 first:border-t-0"
                  >
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="m-0 text-right font-semibold text-ink">{f.value}</dd>
                  </div>
                ))}
              </dl>
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
                    {fighter.bouts.map((b) => {
                      const method = methodLine(b);
                      return (
                      <tr key={b.id}>
                        <Td align="left">
                          <TextLink href={boutHref(b.id)} className="font-normal">
                            {fightDate(b, tz)}
                            <span className="sr-only"> fight details</span>
                          </TextLink>
                        </Td>
                        <Td align="left" className="whitespace-normal break-words">
                          {isTba(b.opponent) ? (
                            b.opponent.name
                          ) : (
                            <TextLink href={fighterHref(b.opponent.slug)}>{b.opponent.name}</TextLink>
                          )}
                          <div className="mt-1 min-[900px]:hidden">
                            <TextLink href={eventHref(b.event.slug)} className="font-normal">{b.event.name}</TextLink>
                          </div>
                        </Td>
                        <Td align="left">
                          {resultChip(b)}
                          {method ? <div className="mt-1 text-notes text-muted">{method}</div> : null}
                        </Td>
                        <Td align="left" className={`${EVENT_COLUMN} whitespace-normal`}>
                          <TextLink href={eventHref(b.event.slug)}>{b.event.name}</TextLink>
                        </Td>
                      </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            ) : (
              <Note className="px-4 py-5 min-[900px]:px-7">No fights to show yet.</Note>
            )}
          </Card>
        </Main>
      </PageLayout>
    </>
  );
}
