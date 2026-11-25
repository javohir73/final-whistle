import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageHead } from "@/components/ui";
import { UfcCardView } from "@/components/ufc/UfcCardView";
import { getUfcEventServer, getUfcEventsServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { isEventSlug } from "@/lib/ufcDisplay";

export const revalidate = 120;

// No cards are prebuilt; an empty list switches this segment to ISR.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const fallback = { title: `UFC card — ${APP_NAME}` };
  if (!isEventSlug(slug)) return fallback;
  const event = await getUfcEventServer(slug).catch(() => null);
  if (!event) return fallback;
  const n = event.bout_count;
  const tail = `the full card: ${n} fights, start times and results.`;
  const description = event.main_event
    ? `${event.main_event.fighter_a.name} v ${event.main_event.fighter_b.name} and ${tail}`
    : `The ${tail.replace(/^the /, "")}`;
  return { title: `${event.name} — fight card and results | ${APP_NAME}`, description };
}

export default async function UfcEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isEventSlug(slug)) notFound();
  const [event, upcoming] = await Promise.all([
    getUfcEventServer(slug).catch(() => undefined),
    getUfcEventsServer("upcoming", 4).catch(() => null),
  ]);
  if (event === null) notFound();
  if (event === undefined) {
    return (
      <>
        <PageHead eyebrow="UFC" title="UFC" />
        <EmptyState title="This card is unavailable right now">
          We could not reach the fight feed. Try again in a minute.
        </EmptyState>
      </>
    );
  }
  return <UfcCardView event={event} upcoming={upcoming?.events ?? []} />;
}
