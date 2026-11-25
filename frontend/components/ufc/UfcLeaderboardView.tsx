"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isViewerRow, rowClassName, rowKey } from "@/components/play/leaderboardRows";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { reportViewerHandle, useViewerHandle } from "@/components/play/viewerHandle";
import {
  Button,
  Card,
  CardHead,
  EmptyState,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  Segmented,
  Table,
  TableScroll,
  Tag,
  TextLink,
  Td,
  Th,
} from "@/components/ui";
import { boardHref, type UfcBoardScope } from "@/app/ufc/leaderboard/scope";
import { getOrCreateDeviceId } from "@/lib/session";
import { getUfcPicksSummary, UFC_SCORING } from "@/lib/ufcPicks";
import type { UfcLeaderboardEntry, UfcLeaderboardResponse } from "@/lib/ufcTypes";

const RULE = `${UFC_SCORING} Ties go to more winner-and-method picks.`;

/** /ufc/leaderboard for one card or one year. The board is public and the same for every
 *  visitor (rendered from the server payload, in the payload's order); the only per-visitor
 *  work is learning this device's handle after hydration, to mark its own row. `board` null
 *  with a card slug means the API does not know that card; with no slug there is no card yet. */
export function UfcLeaderboardView({
  board,
  scope,
  nextSlug,
}: {
  board: UfcLeaderboardResponse | null;
  scope: UfcBoardScope;
  nextSlug: string | null;
}) {
  const { user, loading } = useAuth();
  const viewerHandle = useViewerHandle();
  useViewerLookup();

  if (scope.kind === "card" && scope.slug !== null && board === null) {
    return (
      <>
        <PageHead eyebrow="UFC" title="Leaderboard" />
        <EmptyState
          title="That card is not on the leaderboard"
          actions={<Button href="/ufc/leaderboard">Leaderboard</Button>}
        >
          Check the link, or open the board for the next card.
        </EmptyState>
      </>
    );
  }

  const cardSlug = scope.kind === "card" ? (scope.slug ?? nextSlug) : nextSlug;
  const entries = board?.entries ?? [];
  const mine = entries.find((e) => isViewerRow(e, viewerHandle));
  // The year link is the card's own UTC year (the year its board counts in) while looking at a
  // card, else the year being shown; `year=` is only spelled out when it is not the current one.
  const thisYear = new Date().getUTCFullYear();
  const cardYear = board?.event?.first_bout_utc ? new Date(board.event.first_bout_utc).getUTCFullYear() : null;
  const year = scope.kind === "year" ? scope.year : (cardYear ?? thisYear);
  const yearHref = year === thisYear ? "/ufc/leaderboard?view=year" : boardHref({ kind: "year", year });
  const sub = scope.kind === "year" ? String(scope.year) : (board?.event?.name ?? "The next card");

  return (
    <>
      <PageHead
        eyebrow="UFC"
        title="Leaderboard"
        sub={sub}
        actions={
          <Segmented
            label="Show"
            items={[
              {
                label: "This card",
                href: boardHref({ kind: "card", slug: cardSlug }),
                current: scope.kind === "card",
              },
              {
                label: String(year),
                href: yearHref,
                current: scope.kind === "year",
              },
            ]}
          />
        }
      />
      <PageLayout>
        <Main>
          {entries.length === 0 ? (
            <Card pad>
              <Note>
                {scope.kind === "year"
                  ? `No fights have been scored in ${scope.year} yet.`
                  : "No fights on this card have been scored yet. The board fills in as results come in."}
              </Note>
              <p className="mt-4">
                <Button href="/ufc">Pick the next card</Button>
              </p>
            </Card>
          ) : (
            <>
              {mine && board ? (
                <p className="font-semibold text-ink">{`You are ${mine.rank} of ${board.participant_count}.`}</p>
              ) : null}
              <Card flush>
                <TableScroll>
                  <Table>
                    <thead>
                      <tr>
                        <Th align="left">
                          <span className="sr-only">Rank</span>
                        </Th>
                        <Th align="left">Player</Th>
                        <Th>Points</Th>
                        <Th className="whitespace-normal">Winner and method</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((row) => (
                        <tr key={`${rowKey(row)}:${row.rank}`} className={rowClassName(row, viewerHandle)}>
                          <Td pos>{row.rank}</Td>
                          <PlayerName row={row} viewerHandle={viewerHandle} />
                          <Td pts>{row.points}</Td>
                          <Td>{row.winner_method}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableScroll>
              </Card>
            </>
          )}
          <Note>{RULE}</Note>
        </Main>
        {!loading && user == null ? <SignInRail /> : null}
      </PageLayout>
    </>
  );
}

/** Learns this device's handle (after hydration only) so its own row can be marked. A
 *  failed lookup or blocked storage simply means no row is marked. */
function useViewerLookup() {
  const identityVersion = useTipsIdentityVersion();
  useEffect(() => {
    const device = getOrCreateDeviceId();
    if (!device) return;
    let live = true;
    getUfcPicksSummary(device)
      .then((s) => live && reportViewerHandle(s.handle))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [identityVersion]);
}

/** The handle cell. User-chosen text: rendered as text, wrapped anywhere, isolated for
 *  right-to-left handles. "Model" and "You" are words, not just colour. */
function PlayerName({ row, viewerHandle }: { row: UfcLeaderboardEntry; viewerHandle: string | null }) {
  return (
    <Td align="left" className="min-w-0 whitespace-normal font-semibold text-ink">
      <span className="inline-flex flex-wrap items-center gap-2">
        <bdi className={"[overflow-wrap:anywhere]"}>{row.handle}</bdi>
        {row.is_model ? <Tag>Model</Tag> : null}
        {isViewerRow(row, viewerHandle) ? <Tag className="bg-brand text-white">You</Tag> : null}
      </span>
    </Td>
  );
}

function SignInRail() {
  const { openSignIn } = useAuth();
  return (
    <Rail aria-label="Keep your picks">
      <Card pad>
        <CardHead title="Keep your picks" />
        <Note className="mt-1.5">A free account keeps your picks and your place on the board across devices.</Note>
        <p className="mt-3">
          <TextLink onClick={() => openSignIn()} className="min-h-[44px] text-left">
            Sign in to keep your picks across devices
          </TextLink>
        </p>
      </Card>
    </Rail>
  );
}
