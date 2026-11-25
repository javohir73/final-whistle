import type { Metadata } from "next";
import { getUfcEventsServer } from "@/lib/api";
import { UfcEventList } from "@/components/ufc/UfcEventList";
import { Card, CardHead, CARD_X, Note, PageHead } from "@/components/ui";
import type { UfcEventSummary } from "@/lib/ufcTypes";
import { EVENTS_PAGE, MAX_OFFSET, offsetParam } from "./paging";

export const metadata: Metadata = {
  title: "UFC events: upcoming cards and results | FinalWhistle",
  description: "Every upcoming UFC card and past results, with the main event and the number of fights.",
};

const href = (up: number, past: number) => {
  const q = new URLSearchParams();
  if (up > 0) q.set("up", String(up));
  if (past > 0) q.set("past", String(past));
  const s = q.toString();
  return s ? `/ufc/events?${s}` : "/ufc/events";
};

async function load(when: "upcoming" | "past", offset: number): Promise<UfcEventSummary[] | null> {
  try {
    return (await getUfcEventsServer(when, EVENTS_PAGE + 1, offset))?.events ?? null;
  } catch {
    return null;
  }
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const up = offsetParam(sp.up);
  const past = offsetParam(sp.past);
  const [upcoming, results] = await Promise.all([load("upcoming", up), load("past", past)]);

  const section = (
    title: string,
    rows: UfcEventSummary[] | null,
    emptyText: string,
    offset: number,
    link: (offset: number) => string,
  ) => {
    if (!rows) {
      return (
        <Card flush aria-label={title}>
          <CardHead title={title} className={`${CARD_X} py-4`} />
          <Note className={`${CARD_X} border-t border-line-soft py-5`}>
            We could not reach the fight feed. Try again in a minute.
          </Note>
        </Card>
      );
    }
    const next = offset + EVENTS_PAGE;
    return (
      <UfcEventList
        title={title}
        events={rows.slice(0, EVENTS_PAGE)}
        emptyText={emptyText}
        moreHref={rows.length > EVENTS_PAGE && next <= MAX_OFFSET ? link(next) : null}
        backHref={offset > 0 ? link(0) : null}
      />
    );
  };

  return (
    <>
      <PageHead eyebrow="UFC" title="Events" sub="Upcoming cards and results. Dates are in your local time." />
      <div className="flex flex-col gap-6">
        {section("Upcoming", upcoming, "No upcoming cards are listed yet.", up, (o) => href(o, past))}
        {section("Results", results, "No results yet. Finished cards appear here.", past, (o) => href(up, o))}
      </div>
    </>
  );
}
