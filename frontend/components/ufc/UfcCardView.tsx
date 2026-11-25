"use client";

/** One UFC card laid out like a matchweek: a flush card per segment (main
 *  card, prelims) with a band and a row per fight, and a rail with the other
 *  upcoming cards. */
import { Fragment } from "react";
import { kickoffTimeLower } from "@/components/match/matchPageData";
import {
  Card,
  CardHead,
  DayBand,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  TextLink,
} from "@/components/ui";
import { kickoffDate } from "@/lib/datetime";
import { ABOUT_NOTE, eventHref, eventStatusNote, mainEventId, segmentTitle } from "@/lib/ufcDisplay";
import type { UfcEventDetail, UfcEventSummary } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { BoutRow } from "./BoutRow";

function safe(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function UfcCardView({ event, upcoming }: { event: UfcEventDetail; upcoming: UfcEventSummary[] }) {
  const { tz } = useTimezone();
  const mainId = mainEventId(event);
  const date = event.first_bout_utc ? safe(() => kickoffDate(event.first_bout_utc!, tz)) : null;
  const others = (upcoming ?? []).filter((e) => e.slug !== event.slug).slice(0, 3);
  const segments = event.segments ?? [];

  return (
    <>
      <PageHead
        eyebrow={date ? `UFC · ${date}` : "UFC"}
        title={event.name}
        sub={eventStatusNote(event, tz)}
      />
      <PageLayout>
        <Main>
          {segments.length === 0 ? (
            <Card pad>
              <Note>The fights for this card have not been announced yet.</Note>
            </Card>
          ) : (
            segments.map((seg) => {
              const time = seg.scheduled_utc ? safe(() => kickoffTimeLower(seg.scheduled_utc!, tz)) : null;
              return (
                <Card key={seg.key} flush aria-label={segmentTitle(seg.label)}>
                  <DayBand as="h2" className="flex justify-between gap-3">
                    <span>{segmentTitle(seg.label)}</span>
                    {time && (
                      <span className="font-normal text-muted">
                        <span className="sr-only">, starts </span>
                        {time}
                      </span>
                    )}
                  </DayBand>
                  {seg.bouts.map((b) => (
                    <Fragment key={b.id}>
                      <BoutRow bout={b} tz={tz} isMainEvent={b.id === mainId} />
                    </Fragment>
                  ))}
                </Card>
              );
            })
          )}
        </Main>
        <Rail aria-label="More">
          {others.length > 0 && (
            <Card pad>
              <CardHead title="Upcoming cards" />
              <ul className="mt-4 space-y-4">
                {others.map((e) => {
                  const d = e.first_bout_utc ? safe(() => kickoffDate(e.first_bout_utc!, tz)) : null;
                  const versus = e.main_event
                    ? `${e.main_event.fighter_a.name} v ${e.main_event.fighter_b.name}`
                    : null;
                  const line = [d, versus].filter(Boolean).join(" · ");
                  return (
                    <li key={e.slug}>
                      <TextLink href={eventHref(e.slug)}>{e.name}</TextLink>
                      {line && <Note>{line}</Note>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <Card pad>
            <CardHead title="About these pages" />
            <Note className="mt-4">{ABOUT_NOTE}</Note>
          </Card>
        </Rail>
      </PageLayout>
    </>
  );
}
