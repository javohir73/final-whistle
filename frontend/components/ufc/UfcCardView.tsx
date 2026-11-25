"use client";

/** One UFC card laid out like a matchweek: a flush card per segment (main
 *  card, prelims) with a band and a row per fight, and a rail with the other
 *  upcoming cards. */
import { Fragment } from "react";
import { useClock } from "@/components/match/clock";
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
import { dayKey, kickoffDate } from "@/lib/datetime";
import { ABOUT_NOTE, eventHref, eventStatusNote, mainEventId, segmentStartText, segmentTitle } from "@/lib/ufcDisplay";
import type { UfcEventDetail, UfcEventSummary } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { BoutPickStatus, hasPickSlot } from "./BoutPickStatus";
import { BoutRow } from "./BoutRow";
import { EventBanner } from "./EventBanner";
import { UfcPicksProvider } from "./UfcPicksProvider";
import { UfcPicksRailCard } from "./UfcPicksRailCard";

function safe(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** "Sat 12 Dec", or "Sat 12 – Sun 13 Dec" when the card's first fight and its main card fall on
 *  different local days. */
function eyebrowDay(event: UfcEventDetail, tz: string): string | null {
  const first = event.first_bout_utc;
  if (!first) return null;
  const start = safe(() => kickoffDate(first, tz));
  if (!start) return null;
  const mainIso = (event.segments ?? []).find((s) => s.key === "main")?.scheduled_utc ?? null;
  if (!mainIso) return start;
  const range = safe(() => {
    if (dayKey(mainIso, tz) === dayKey(first, tz)) return start;
    const end = kickoffDate(mainIso, tz);
    const [, , m1] = start.split(" ");
    const [, , m2] = end.split(" ");
    return m1 === m2 ? `${start.replace(` ${m1}`, "")} – ${end}` : `${start} – ${end}`;
  });
  return range ?? start;
}

export function UfcCardView({ event, upcoming }: { event: UfcEventDetail; upcoming: UfcEventSummary[] }) {
  return (
    <UfcPicksProvider eventSlug={event.slug}>
      <UfcCard event={event} upcoming={upcoming} />
    </UfcPicksProvider>
  );
}

function UfcCard({ event, upcoming }: { event: UfcEventDetail; upcoming: UfcEventSummary[] }) {
  const { tz } = useTimezone();
  const now = useClock();
  const mainId = mainEventId(event);
  const date = eyebrowDay(event, tz);
  const others = (upcoming ?? []).filter((e) => e.slug !== event.slug).slice(0, 3);
  const segments = event.segments ?? [];
  const mainBout = mainId == null ? null : segments.flatMap((s) => s.bouts ?? []).find((b) => b.id === mainId) ?? null;

  return (
    <>
      <PageHead
        eyebrow={date ? `UFC · ${date}` : "UFC"}
        title={event.name}
        sub={eventStatusNote(event, tz)}
      />
      <PageLayout>
        <Main>
          {mainBout && <EventBanner bout={mainBout} title={event.name} date={date} />}
          {segments.length === 0 ? (
            <Card pad>
              <Note>The fights for this card have not been announced yet.</Note>
            </Card>
          ) : (
            segments.map((seg) => {
              const time = segmentStartText(seg.scheduled_utc, event.first_bout_utc, tz);
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
                      <BoutRow
                        bout={b}
                        tz={tz}
                        isMainEvent={b.id === mainId}
                        showTime={false}
                        right={hasPickSlot(b) ? <BoutPickStatus bout={b} now={now} /> : undefined}
                      />
                    </Fragment>
                  ))}
                </Card>
              );
            })
          )}
        </Main>
        <Rail aria-label="About this card">
          <UfcPicksRailCard event={event} />
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
              <TextLink href="/ufc/events" className="mt-4">All cards</TextLink>
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
