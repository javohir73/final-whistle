import type { Metadata } from "next";
import { Button, EmptyState, PageHead } from "@/components/ui";
import { UfcCardView } from "@/components/ufc/UfcCardView";
import { getUfcEventsServer, getUfcNextEventServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";

export const revalidate = 120;

export const metadata: Metadata = {
  title: `UFC fight cards — ${APP_NAME}`,
  description:
    "The next UFC card fight by fight, with start times in your local time.",
};

export default async function UfcHomePage() {
  const [next, upcoming] = await Promise.all([
    getUfcNextEventServer().catch(() => undefined),
    getUfcEventsServer("upcoming", 4).catch(() => null),
  ]);

  if (next === undefined) {
    return (
      <>
        <PageHead eyebrow="UFC" title="UFC" />
        <EmptyState
          title="Fight cards are unavailable right now"
          actions={<Button href="/ufc/events">All cards</Button>}
        >
          We could not reach the fight feed. Try again in a minute.
        </EmptyState>
      </>
    );
  }
  if (next === null) {
    return (
      <>
        <PageHead eyebrow="UFC" title="UFC" />
        <EmptyState title="No UFC cards yet" actions={<Button href="/">Go to the home page</Button>}>
          Fight cards appear here as soon as they are announced.
        </EmptyState>
      </>
    );
  }
  return <UfcCardView event={next} upcoming={upcoming?.events ?? []} />;
}
