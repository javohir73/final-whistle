"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { rowKey } from "@/components/play/leaderboardRows";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
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
import { cn } from "@/lib/utils";
import { getOrCreateDeviceId } from "@/lib/session";
import { getUfcPicksSummary, UFC_SCORING } from "@/lib/ufcPicks";
import type { UfcLeaderboardEntry, UfcLeaderboardResponse, UfcPicksSummaryResponse } from "@/lib/ufcTypes";
import { findViewerRow } from "./ufcLeaderboardViewer";

const RULE = `${UFC_SCORING} Ties go to more winner-and-method picks.`;

/** /ufc/leaderboard for one card or one year. The board is public and the same for every
 *  visitor (rendered from the server payload, in the payload's order); the only per-visitor
 *  work is reading this device's own totals after hydration, to mark its own row when that is
 *  certain (see `findViewerRow`). `board` null for a card scope means the API does not know
 *  that card. `currentYear` comes from the server so server and client agree. */
export function UfcLeaderboardView({
  board,
  scope,
  nextSlug,
  currentYear,
}: {
  board: UfcLeaderboardResponse | null;
  scope: UfcBoardScope;
  nextSlug: string | null;
  currentYear: number;
}) {
  const { user, loading } = useAuth();
  const summary = useViewerSummary();

  if (scope.kind === "card" && board === null) {
    return (
      <>
        <PageHead eyebrow="UFC" title="Leaderboard" />
        <EmptyState
          title="That card is not on the leaderboard"
          actions={<Button href="/ufc/leaderboard">Leaderboard</Button>}
        >
          Check the link, or open the board for the year.
        </EmptyState>
      </>
    );
  }

  const entries = board?.entries ?? [];
  const players = entries.filter((e) => !e.is_model);
  const mine = findViewerRow(entries, scope, summary);
  // The year a card's board counts in is the UTC year of its first fight.
  const cardYear = board?.event?.first_bout_utc ? new Date(board.event.first_bout_utc).getUTCFullYear() : null;
  const year = scope.kind === "year" ? scope.year : (cardYear ?? currentYear);
  const cardSlug = scope.kind === "card" ? scope.slug : nextSlug;
  const sub = scope.kind === "year" ? String(scope.year) : (board?.event?.name ?? "");
  const switchItems = [
    ...(cardSlug
      ? [{ label: "This card", href: boardHref({ kind: "card", slug: cardSlug }), current: scope.kind === "card" }]
      : []),
    { label: String(year), href: boardHref({ kind: "year", year }), current: scope.kind === "year" },
  ];

  return (
    <>
      <PageHead
        eyebrow="UFC"
        title="Leaderboard"
        sub={sub || undefined}
        actions={switchItems.length > 1 ? <Segmented label="Show" items={switchItems} /> : null}
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
                <p className="font-semibold text-ink">{`You are ${players.indexOf(mine) + 1} of ${board.participant_count}.`}</p>
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
                        <tr key={`${rowKey(row)}:${row.rank}`} className={cn(row === mine && "bg-brand-soft")}>
                          <Td pos>{row.rank}</Td>
                          <PlayerName row={row} you={row === mine} />
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

/** This device's own per-card totals, read after hydration only. A failed lookup or blocked
 *  storage leaves it null, and then no row is marked. */
function useViewerSummary(): UfcPicksSummaryResponse | null {
  const identityVersion = useTipsIdentityVersion();
  const [summary, setSummary] = useState<UfcPicksSummaryResponse | null>(null);
  useEffect(() => {
    const device = getOrCreateDeviceId();
    if (!device) return;
    let live = true;
    getUfcPicksSummary(device)
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [identityVersion]);
  return summary;
}

/** The handle cell. User-chosen text: rendered as text, wrapped anywhere, isolated for
 *  right-to-left handles. "Model" and "You" are words, not just colour. */
function PlayerName({ row, you }: { row: UfcLeaderboardEntry; you: boolean }) {
  return (
    <Td align="left" className="min-w-0 whitespace-normal font-semibold text-ink">
      <span className="inline-flex flex-wrap items-center gap-2">
        <bdi className={"[overflow-wrap:anywhere]"}>{row.handle}</bdi>
        {row.is_model ? (
          <Tag>
            Model<span className="sr-only">, the site&apos;s model</span>
          </Tag>
        ) : null}
        {you ? (
          <Tag className="bg-brand text-white">
            You<span className="sr-only">, you</span>
          </Tag>
        ) : null}
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
