import type { Metadata } from "next";
import { Button, EmptyState, PageHead } from "@/components/ui";
import { UfcMyPicksView } from "@/components/ufc/UfcMyPicksView";
import { getUfcNextEventServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";

export const revalidate = 120;

export const metadata: Metadata = {
  title: `My UFC picks — ${APP_NAME}`,
  description:
    "Pick the winner of every fight on the next UFC card, and how they win. Winner and method 5 points, winner 2.",
};

/** /ufc/picks: the next card's fights with the player's picks, and every card they have played.
 *  Everything about the player loads in the browser (UfcMyPicksView); this server render is the
 *  same for every visitor. */
export default async function UfcPicksPage() {
  const next = await getUfcNextEventServer().catch(() => undefined);

  if (next === undefined) {
    return (
      <>
        <PageHead eyebrow="UFC" title="My picks" />
        <EmptyState title="Picks are unavailable right now" actions={<Button href="/ufc/events">All cards</Button>}>
          We could not reach the fight feed. Try again in a minute.
        </EmptyState>
      </>
    );
  }
  if (next === null) {
    return (
      <>
        <PageHead eyebrow="UFC" title="My picks" />
        <EmptyState title="No UFC cards yet" actions={<Button href="/ufc/events">All cards</Button>}>
          Picks open as soon as the next card is announced.
        </EmptyState>
      </>
    );
  }
  return <UfcMyPicksView event={next} />;
}
