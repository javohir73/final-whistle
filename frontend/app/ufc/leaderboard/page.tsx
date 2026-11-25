import type { Metadata } from "next";
import { Button, EmptyState, GhostButton, PageHead } from "@/components/ui";
import { UfcLeaderboardView } from "@/components/ufc/UfcLeaderboardView";
import { getUfcLeaderboardServer, getUfcNextEventServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { boardHref, parseBoardScope, type UfcBoardScope } from "./scope";

export const metadata: Metadata = {
  title: `UFC leaderboard — ${APP_NAME}`,
  description:
    "Players ranked by their UFC picks, card by card and across the year. Winner and method 5 points, winner 2.",
};

type Params = { event?: string | string[]; view?: string | string[]; year?: string | string[] };

/** Dynamic (it reads the query string). The scope is validated before anything is fetched, so
 *  the API only ever gets a request it will answer; a hand-typed bad value falls back to the
 *  next card's board. The board is public and cached; per-visitor work happens in the view. */
export default async function UfcLeaderboardPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const requested = parseBoardScope((await searchParams) ?? {}, new Date());
  // undefined: the feed failed (null means there is no next card).
  const next = await getUfcNextEventServer().catch(() => undefined);
  const scope: UfcBoardScope =
    requested.kind === "card" && requested.slug === null
      ? { kind: "card", slug: next?.slug ?? null }
      : requested;

  const unavailable = (
    <>
      <PageHead eyebrow="UFC" title="Leaderboard" />
      <EmptyState
        title="The leaderboard is not available right now"
        actions={
          <>
            <Button href={boardHref(requested)}>Try again</Button>
            <GhostButton href="/ufc">See the fight cards</GhostButton>
          </>
        }
      >
        We could not reach the leaderboard. Try again in a minute.
      </EmptyState>
    </>
  );

  if (requested.kind === "card" && requested.slug === null && next === undefined) return unavailable;

  let board = null;
  try {
    if (scope.kind === "year") board = await getUfcLeaderboardServer({ year: scope.year });
    else if (scope.slug !== null) board = await getUfcLeaderboardServer({ event: scope.slug });
  } catch {
    return unavailable;
  }
  return <UfcLeaderboardView board={board} scope={scope} nextSlug={next?.slug ?? null} />;
}
