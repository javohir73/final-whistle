"use client";

import { useEffect, useState } from "react";
import { ErrorState, Loading } from "@/components/States";
import { Card, CardHead, Note, Segmented, Table, TableScroll, Tag, Td, Th } from "@/components/ui";
import {
  boardState,
  isViewerRow,
  rowKey,
  viewerVsModelLine,
  type BoardScope,
  type WithModelFlag,
} from "@/components/play/leaderboardRows";
import { useViewerHandle } from "@/components/play/viewerHandle";
import { getNrlSeasonLeaderboard, getNrlTipsLeaderboard } from "@/lib/nrlTips";
import { ApiError } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { NrlSeasonLeaderboardEntry, NrlSeasonLeaderboardResponse, NrlTipsLeaderboardEntry, NrlTipsLeaderboardResponse } from "@/lib/types";

// The model's row carries no margin (it never guesses one) and, on an older
// API, may lack a rounds count; otherwise it is shaped like a tipper's.
type WeeklyEntry = WithModelFlag<
  Omit<NrlTipsLeaderboardEntry, "round_margin"> & { round_margin?: number | null }
>;
type SeasonEntry = WithModelFlag<
  Omit<NrlSeasonLeaderboardEntry, "total_margin" | "rounds_played"> & {
    total_margin?: number | null;
    rounds_played?: number | null;
  }
>;

type WeeklyState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: NrlTipsLeaderboardResponse };

type SeasonState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: NrlSeasonLeaderboardResponse };

/** Weekly (per-round) leaderboard for the beat-the-AI loop (design doc: NRL
 *  Round Tips, Slice 2), plus a Season tab (Slice 2.5) over the season-long
 *  totals endpoint. Boards always show now: the backend dropped the 10-player
 *  reveal gate and ranks the model as a row (`is_model`), so a lone tipper
 *  still sees "you vs the model"; a round nobody tipped gets an honest empty
 *  state, and an older, still-gated API's count-only response falls back to
 *  the quiet participant count. Mirrors LeaderboardClient's table look for
 *  the football leaderboard.
 *
 *  `viewerHandle` overrides the handle this device plays under, which is
 *  otherwise picked up from whichever tips surface on the page reported it
 *  (components/play/viewerHandle.ts). */
export function NrlTipsLeaderboard({
  season,
  round,
  seasonOnly = false,
  viewerHandle: viewerHandleProp,
  title = "Leaderboard",
  className,
}: {
  season: number;
  round?: number;
  seasonOnly?: boolean;
  viewerHandle?: string | null;
  /** Card heading; null drops it (the page's h1 already says "Leaderboard"). */
  title?: string | null;
  className?: string;
}) {
  const reportedHandle = useViewerHandle();
  const viewerHandle = viewerHandleProp !== undefined ? viewerHandleProp : reportedHandle;
  const [tab, setTab] = useState<"weekly" | "season">(seasonOnly ? "season" : "weekly");
  const [weeklyState, setWeeklyState] = useState<WeeklyState>({ status: "loading" });
  const [weeklyAttempt, setWeeklyAttempt] = useState(0);
  const [seasonState, setSeasonState] = useState<SeasonState>({ status: "loading" });
  const [seasonAttempt, setSeasonAttempt] = useState(0);

  useEffect(() => {
    if (seasonOnly || round == null) return;
    let live = true;
    setWeeklyState({ status: "loading" });
    getNrlTipsLeaderboard(season, round)
      .then((data) => live && setWeeklyState({ status: "success", data }))
      .catch(
        (err) =>
          live &&
          setWeeklyState({
            status: "error",
            message: err instanceof ApiError ? err.message : "Couldn't load the leaderboard.",
          }),
      );
    return () => {
      live = false;
    };
  }, [season, round, seasonOnly, weeklyAttempt]);

  // Season tab is fetched lazily -- a visitor who never leaves the default
  // Weekly view never costs the season endpoint a request.
  useEffect(() => {
    if (tab !== "season") return;
    let live = true;
    setSeasonState({ status: "loading" });
    getNrlSeasonLeaderboard(season)
      .then((data) => live && setSeasonState({ status: "success", data }))
      .catch(
        (err) =>
          live &&
          setSeasonState({
            status: "error",
            message: err instanceof ApiError ? err.message : "Couldn't load the season leaderboard.",
          }),
      );
    return () => {
      live = false;
    };
  }, [tab, season, seasonAttempt]);

  return (
    <Card pad className={className} aria-label={title ?? "Leaderboard"}>
      {title != null || !seasonOnly ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          {title != null ? <CardHead title={title} /> : <span />}
          {!seasonOnly && (
            <Segmented
              label="Leaderboard period"
              items={[
                { label: "Weekly", current: tab === "weekly", onSelect: () => setTab("weekly") },
                { label: "Season", current: tab === "season", onSelect: () => setTab("season") },
              ]}
            />
          )}
        </div>
      ) : null}

      {tab === "weekly" ? (
        <>
          {weeklyState.status === "loading" && <Loading label="Loading leaderboard…" />}
          {weeklyState.status === "error" && (
            <ErrorState message={weeklyState.message} onRetry={() => setWeeklyAttempt((a) => a + 1)} />
          )}
          {weeklyState.status === "success" && (
            <Board
              scope="round"
              participantCount={weeklyState.data.participant_count}
              entries={weeklyState.data.entries.map((e: WeeklyEntry) => ({ ...e, margin: e.round_margin ?? null }))}
              viewerHandle={viewerHandle}
              emptyMessage="No one has tipped this round yet — make your picks to take on the model."
            />
          )}
        </>
      ) : (
        <>
          {seasonState.status === "loading" && <Loading label="Loading season leaderboard…" />}
          {seasonState.status === "error" && (
            <ErrorState message={seasonState.message} onRetry={() => setSeasonAttempt((a) => a + 1)} />
          )}
          {seasonState.status === "success" && (
            <Board
              scope="season"
              participantCount={seasonState.data.participant_count}
              entries={seasonState.data.entries.map((e: SeasonEntry) => ({
                ...e,
                margin: e.total_margin ?? null,
                rounds: e.rounds_played ?? null,
              }))}
              viewerHandle={viewerHandle}
              emptyMessage="No graded tips yet this season — the board fills in after full time."
            />
          )}
        </>
      )}
    </Card>
  );
}

type BoardEntry = WithModelFlag<{ handle: string; points: number; margin: number | null; rounds?: number | null }>;

function pts(n: number): string {
  return `${n} pt${n === 1 ? "" : "s"}`;
}

function QuietNote({ children }: { children: ReactNode }) {
  return <Note className="py-4 text-center">{children}</Note>;
}

/** One board (round or season) on the G table parts: rank, Tipster (with a
 *  "Model" tag on the model's row and "You" on this device's), Rounds (season
 *  board), Margin (the tiebreak -- only when someone has one), Points. */
function Board({
  scope,
  participantCount,
  entries,
  viewerHandle,
  emptyMessage,
}: {
  scope: BoardScope;
  participantCount: number;
  entries: BoardEntry[];
  viewerHandle: string | null;
  emptyMessage: string;
}) {
  const state = boardState(participantCount, entries);
  if (state === "empty") {
    const model = entries.find((e) => e.is_model);
    return (
      <QuietNote>
        {emptyMessage}
        {model && model.points > 0 ? ` The model has ${pts(model.points)} so far.` : null}
      </QuietNote>
    );
  }
  if (state === "withheld") return <QuietNote>{participantCount} playing this {scope}</QuietNote>;

  const line = viewerVsModelLine(entries, viewerHandle, scope);
  const showRounds = scope === "season";
  const showMargin = entries.some((e) => e.margin != null);
  return (
    <>
      {line ? (
        <p className={cn("mb-2 font-semibold", line.ahead ? "text-brand" : "text-ink")}>{line.text}</p>
      ) : null}
      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th align="left">
                <span className="sr-only">Rank</span>
              </Th>
              <Th align="left">Tipster</Th>
              {showRounds ? <Th>Rounds</Th> : null}
              {showMargin ? <Th>Margin</Th> : null}
              <Th>Points</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row, i) => {
              const you = isViewerRow(row, viewerHandle);
              return (
                <tr key={rowKey(row)} className={cn(you && "bg-brand-soft")}>
                  <Td pos>{i + 1}</Td>
                  <Td align="left" className="whitespace-normal font-semibold">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="break-all">{row.handle}</span>
                      {row.is_model ? <Tag>Model</Tag> : null}
                      {you ? <Tag className="bg-brand text-white">You</Tag> : null}
                    </span>
                  </Td>
                  {showRounds ? <Td>{row.rounds ?? "—"}</Td> : null}
                  {showMargin ? <Td className="text-muted">{row.margin ?? "—"}</Td> : null}
                  <Td pts>{row.points}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
    </>
  );
}
