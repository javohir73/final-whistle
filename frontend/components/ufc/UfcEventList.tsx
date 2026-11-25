"use client";

import Link from "next/link";
import { Card, CardHead, CARD_X, Note, TextLink } from "@/components/ui";
import { kickoffDate } from "@/lib/datetime";
import { useTimezone } from "@/lib/useTimezone";
import { eventHref } from "@/lib/ufcDisplay";
import type { UfcEventSummary } from "@/lib/ufcTypes";

/** One list of cards (upcoming or results): name, local date, main event and
 *  fight count, with optional paging links. */
export function UfcEventList({
  title,
  events,
  emptyText,
  moreHref,
  backHref,
}: {
  title: string;
  events: UfcEventSummary[];
  emptyText: string;
  moreHref: string | null;
  backHref: string | null;
}) {
  const { tz } = useTimezone();
  const note = (e: UfcEventSummary) =>
    [
      e.first_bout_utc ? kickoffDate(e.first_bout_utc, tz) : "Date to be confirmed",
      e.main_event ? `${e.main_event.fighter_a.name} v ${e.main_event.fighter_b.name}` : null,
      `${e.bout_count} ${e.bout_count === 1 ? "fight" : "fights"}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Card flush aria-label={title}>
      <CardHead title={title} className={`${CARD_X} py-4`} />
      {events.length === 0 ? (
        <Note className={`${CARD_X} border-t border-line-soft py-5`}>{emptyText}</Note>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.slug} className={`${CARD_X} min-w-0 border-t border-line-soft py-4`}>
              <Link href={eventHref(e.slug)} className="break-words font-semibold text-ink no-underline hover:underline">
                {e.name}
              </Link>
              <Note className="mt-1 break-words">{note(e)}</Note>
            </li>
          ))}
        </ul>
      )}
      {(moreHref || backHref) && (
        <div className={`${CARD_X} flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft py-4`}>
          {moreHref && <TextLink href={moreHref}>Show more</TextLink>}
          {backHref && <TextLink href={backHref}>Back to the start</TextLink>}
        </div>
      )}
    </Card>
  );
}
