"use client";

import { useEffect, useState } from "react";
import {
  BoardNote,
  EmptyBoard,
  PlayerCell,
  ViewerVsModel,
  boardState,
  rowClassName,
  rowKey,
  type WithModelFlag,
} from "@/components/play/leaderboardRows";
import { useViewerHandle } from "@/components/play/viewerHandle";
import { getLeagueSeasonLeaderboard, getLeagueTipsLeaderboard } from "@/lib/leagueTips";
import { ApiError } from "@/lib/session";
import { Button, Card, Note, Segmented, Table, TableScroll, Td, Th } from "@/components/ui";
import type {
  LeagueSeasonLeaderboardEntry,
  LeagueSeasonLeaderboardResponse,
  LeagueTipsLeaderboardEntry,
  LeagueTipsLeaderboardResponse,
} from "@/lib/types";

// The model's season row may arrive without a matchweeks count on an older
// API; everything else is the same shape as a player's.
type WeeklyEntry = WithModelFlag<LeagueTipsLeaderboardEntry>;
type SeasonEntry = WithModelFlag<
  Omit<LeagueSeasonLeaderboardEntry, "matchweeks_played"> & { matchweeks_played?: number | null }
>;

type WeeklyState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: LeagueTipsLeaderboardResponse };

type SeasonState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: LeagueSeasonLeaderboardResponse };

/** Weekly (per-matchweek) leaderboard for the league beat-the-AI loop (design
 *  doc: League Score Predictions, 2026-07-24), plus a Season tab over the
 *  season-long totals endpoint -- league-generic port of components/nrl/
 *  NrlTipsLeaderboard.tsx. Boards always show now: the backend dropped the
 *  10-player reveal gate and ranks the model itself as a row (`is_model`), so
 *  one player still sees "you vs the model". A board with no players yet gets
 *  an honest empty state; an older, still-gated API's count-only response
 *  falls back to the quiet participant count. Tiebreak is exact-count
 *  (replacing NRL's margin) -- the natural score-prediction tiebreak per the
 *  design doc.
 *
 *  `viewerHandle` overrides the handle this device plays under, which is
 *  otherwise picked up from whichever tips surface on the page reported it
 *  (components/play/viewerHandle.ts). */
export function LeagueTipsLeaderboard({
  league,
  matchweek,
  seasonOnly = false,
  initialView = "weekly",
  viewerHandle: viewerHandleProp,
  onSeasonLoaded,
  view,
}: {
  league: string;
  matchweek?: number;
  seasonOnly?: boolean;
  /** Which board opens first when both exist ("Season" on /leaderboard). */
  initialView?: "weekly" | "season";
  viewerHandle?: string | null;
  /** Called with the season board once it loads (the page reads the
   *  model's matchweek count from it for its sub line). */
  onSeasonLoaded?: (data: LeagueSeasonLeaderboardResponse) => void;
  /** Controlled board: the parent renders its own Season/Matchweek control
   *  (the /leaderboard page puts it in the page head). */
  view?: "weekly" | "season";
}) {
  const reportedHandle = useViewerHandle();
  const viewerHandle = viewerHandleProp !== undefined ? viewerHandleProp : reportedHandle;
  const [ownTab, setTab] = useState<"weekly" | "season">(
    seasonOnly || initialView === "season" || matchweek == null ? "season" : "weekly",
  );
  const tab = view !== undefined ? (view === "weekly" && matchweek == null ? "season" : view) : ownTab;
  const [weeklyState, setWeeklyState] = useState<WeeklyState>({ status: "loading" });
  const [weeklyAttempt, setWeeklyAttempt] = useState(0);
  const [seasonState, setSeasonState] = useState<SeasonState>({ status: "loading" });
  const [seasonAttempt, setSeasonAttempt] = useState(0);

  // The weekly board is fetched when it is first shown, and again only when
  // the league or matchweek changes (or on retry) -- switching back to it
  // from Season reuses what is loaded.
  const weeklyWanted = !seasonOnly && matchweek != null && tab === "weekly";
  const weeklyKey = weeklyWanted ? `${league}:${matchweek}:${weeklyAttempt}` : null;
  const [weeklyLoadedKey, setWeeklyLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    if (weeklyKey == null || weeklyKey === weeklyLoadedKey || matchweek == null) return;
    let live = true;
    setWeeklyState({ status: "loading" });
    getLeagueTipsLeaderboard(league, matchweek)
      .then((data) => {
        if (!live) return;
        setWeeklyState({ status: "success", data });
        setWeeklyLoadedKey(weeklyKey);
      })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeklyKey]);

  // Season board is fetched lazily -- a visitor who never opens it never costs
  // the season endpoint a request.
  useEffect(() => {
    if (tab !== "season") return;
    let live = true;
    setSeasonState({ status: "loading" });
    getLeagueSeasonLeaderboard(league)
      .then((data) => {
        if (!live) return;
        setSeasonState({ status: "success", data });
        onSeasonLoaded?.(data);
      })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, league, seasonAttempt]);

  const showToggle = view === undefined && !seasonOnly && matchweek != null;

  return (
    <Card pad className="max-w-[900px]" aria-label="Leaderboard">
      {showToggle ? (
        <div className="mb-4 flex justify-end">
          <Segmented
            label="Leaderboard"
            items={[
              { label: "Season", current: tab === "season", onSelect: () => setTab("season") },
              { label: `Matchweek ${matchweek}`, current: tab === "weekly", onSelect: () => setTab("weekly") },
            ]}
          />
        </div>
      ) : null}

      {tab === "weekly" ? (
        <BoardBody
          state={weeklyState}
          onRetry={() => setWeeklyAttempt((a) => a + 1)}
          render={(data) => (
            <WeeklyBoard
              participantCount={data.participant_count}
              entries={data.entries}
              viewerHandle={viewerHandle}
            />
          )}
        />
      ) : (
        <BoardBody
          state={seasonState}
          onRetry={() => setSeasonAttempt((a) => a + 1)}
          render={(data) => (
            <SeasonBoard
              participantCount={data.participant_count}
              entries={data.entries}
              viewerHandle={viewerHandle}
            />
          )}
        />
      )}
    </Card>
  );
}

function BoardBody<T>({
  state,
  onRetry,
  render,
}: {
  state: { status: "loading" } | { status: "error"; message: string } | { status: "success"; data: T };
  onRetry: () => void;
  render: (data: T) => React.ReactNode;
}) {
  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading the leaderboard" className="flex flex-col gap-3 py-2">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="block h-6 w-full rounded bg-line-soft" />
        ))}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
        <Note>{state.message}</Note>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{render(state.data)}</>;
}

function WeeklyBoard({
  participantCount,
  entries,
  viewerHandle,
}: {
  participantCount: number;
  entries: WeeklyEntry[];
  viewerHandle: string | null;
}) {
  const state = boardState(participantCount, entries);
  if (state === "empty") {
    return (
      <EmptyBoard
        entries={entries}
        message="No one has played this matchweek yet — make your picks to take on the model."
      />
    );
  }
  if (state === "withheld") return <BoardNote>{participantCount} playing this matchweek</BoardNote>;
  return (
    <>
      <ViewerVsModel entries={entries} viewerHandle={viewerHandle} scope="matchweek" />
      <BoardTable entries={entries} viewerHandle={viewerHandle} />
    </>
  );
}

function SeasonBoard({
  participantCount,
  entries,
  viewerHandle,
}: {
  participantCount: number;
  entries: SeasonEntry[];
  viewerHandle: string | null;
}) {
  const state = boardState(participantCount, entries);
  if (state === "empty") {
    return (
      <EmptyBoard
        entries={entries}
        message="No graded picks yet this season — the board fills in after full time."
      />
    );
  }
  if (state === "withheld") return <BoardNote>{participantCount} playing this season</BoardNote>;
  return (
    <>
      <ViewerVsModel entries={entries} viewerHandle={viewerHandle} scope="season" />
      <BoardTable entries={entries} viewerHandle={viewerHandle} season />
    </>
  );
}

/** rank · Tipster · (Matchweeks) · Exact scores · Points -- only the columns
 *  the API returns for that board. Every row the API returns is shown. */
function BoardTable({
  entries,
  viewerHandle,
  season = false,
}: {
  entries: (WeeklyEntry | SeasonEntry)[];
  viewerHandle: string | null;
  season?: boolean;
}) {
  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th align="left">
              <span className="sr-only">Rank</span>
            </Th>
            <Th align="left">Tipster</Th>
            {season ? <Th className="hidden sm:table-cell">Matchweeks</Th> : null}
            <Th>
              <span className="sm:hidden">Exact</span>
              <span className="hidden sm:inline">Exact scores</span>
            </Th>
            <Th>Points</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row, i) => (
            <tr key={rowKey(row)} className={rowClassName(row, viewerHandle)}>
              <Td pos>{i + 1}</Td>
              <PlayerCell row={row} viewerHandle={viewerHandle} />
              {season ? (
                <Td className="hidden sm:table-cell">{(row as SeasonEntry).matchweeks_played ?? "–"}</Td>
              ) : null}
              <Td>{row.exact_count}</Td>
              <Td pts>{row.points}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}
