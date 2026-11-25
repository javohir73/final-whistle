import type { Metadata } from "next";
import { Button, EmptyState, GhostButton, PageHead } from "@/components/ui";
import { UfcLeaderboardView } from "@/components/ufc/UfcLeaderboardView";
import { getUfcLeaderboardServer, getUfcNextEventServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { boardHref, parseBoardScope } from "./scope";

export const metadata: Metadata = {
  title: `UFC leaderboard — ${APP_NAME}`,
  description:
    "Players ranked by their UFC picks, card by card and across the year. Winner and method 5 points, winner 2.",
};

type Params = { event?: string | string[]; view?: string | string[]; year?: string | string[] };

/** Dynamic (it reads the query string). The scope is validated before anything is fetched, so
 *  the API only ever gets a request it will answer; with no parameters, or a hand-typed bad
 *  one, it opens on the current UTC year's board. The next card (for the "This card" switch)
 *  is optional: if it cannot be found the board still shows, without that switch. The board is
 *  public and cached; per-visitor work happens in the view. */
export default async function UfcLeaderboardPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const now = new Date();
  const scope = parseBoardScope((await searchParams) ?? {}, now);
  const [next, board] = await Promise.all([
    getUfcNextEventServer().catch(() => null),
    (scope.kind === "year"
      ? getUfcLeaderboardServer({ year: scope.year })
      : getUfcLeaderboardServer({ event: scope.slug })
    ).catch(() => undefined),
  ]);
  if (board === undefined) {
    return (
      <>
        <PageHead eyebrow="UFC" title="Leaderboard" />
        <EmptyState
          title="The leaderboard is not available right now"
          actions={
            <>
              <Button href={boardHref(scope)}>Try again</Button>
              <GhostButton href="/ufc">See the fight cards</GhostButton>
            </>
          }
        >
          We could not reach the leaderboard. Try again in a minute.
        </EmptyState>
      </>
    );
  }
  return (
    <UfcLeaderboardView
      board={board}
      scope={scope}
      nextSlug={next?.slug ?? null}
      currentYear={now.getUTCFullYear()}
    />
  );
}
