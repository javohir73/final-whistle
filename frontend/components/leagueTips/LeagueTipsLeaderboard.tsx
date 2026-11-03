"use client";

import { useEffect, useState } from "react";
import { ErrorState, Loading } from "@/components/States";
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
import { cn } from "@/lib/utils";
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
  viewerHandle: viewerHandleProp,
}: {
  league: string;
  matchweek?: number;
  seasonOnly?: boolean;
  viewerHandle?: string | null;
}) {
  const reportedHandle = useViewerHandle();
  const viewerHandle = viewerHandleProp !== undefined ? viewerHandleProp : reportedHandle;
  const [tab, setTab] = useState<"weekly" | "season">(seasonOnly ? "season" : "weekly");
  const [weeklyState, setWeeklyState] = useState<WeeklyState>({ status: "loading" });
  const [weeklyAttempt, setWeeklyAttempt] = useState(0);
  const [seasonState, setSeasonState] = useState<SeasonState>({ status: "loading" });
  const [seasonAttempt, setSeasonAttempt] = useState(0);

  useEffect(() => {
    if (seasonOnly || matchweek == null) return;
    let live = true;
    setWeeklyState({ status: "loading" });
    getLeagueTipsLeaderboard(league, matchweek)
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
  }, [league, matchweek, seasonOnly, weeklyAttempt]);

  // Season tab is fetched lazily -- a visitor who never leaves the default
  // Weekly view never costs the season endpoint a request.
  useEffect(() => {
    if (tab !== "season") return;
    let live = true;
    setSeasonState({ status: "loading" });
    getLeagueSeasonLeaderboard(league)
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
  }, [tab, league, seasonAttempt]);

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <h2 className="text-label font-semibold uppercase tracking-wider text-muted">Leaderboard</h2>
        {!seasonOnly && <div className="flex gap-1 rounded-lg bg-surface-2 p-0.5 text-label font-semibold">
          <button
            type="button"
            onClick={() => setTab("weekly")}
            aria-pressed={tab === "weekly"}
            className={cn("rounded-md px-2 py-1", tab === "weekly" ? "bg-win text-pitch" : "text-muted")}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setTab("season")}
            aria-pressed={tab === "season"}
            className={cn("rounded-md px-2 py-1", tab === "season" ? "bg-win text-pitch" : "text-muted")}
          >
            Season
          </button>
        </div>}
      </div>

      {tab === "weekly" ? (
        <>
          {weeklyState.status === "loading" && <Loading label="Loading leaderboard…" />}
          {weeklyState.status === "error" && (
            <ErrorState message={weeklyState.message} onRetry={() => setWeeklyAttempt((a) => a + 1)} />
          )}
          {weeklyState.status === "success" && (
            <WeeklyBoard
              participantCount={weeklyState.data.participant_count}
              entries={weeklyState.data.entries}
              viewerHandle={viewerHandle}
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
            <SeasonBoard
              participantCount={seasonState.data.participant_count}
              entries={seasonState.data.entries}
              viewerHandle={viewerHandle}
            />
          )}
        </>
      )}
    </section>
  );
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
      <WeeklyTable entries={entries} viewerHandle={viewerHandle} />
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
      <SeasonTable entries={entries} viewerHandle={viewerHandle} />
    </>
  );
}

function WeeklyTable({ entries, viewerHandle }: { entries: WeeklyEntry[]; viewerHandle: string | null }) {
  return (
    <div className="glass overflow-x-auto rounded-2xl p-2 sm:p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-label uppercase tracking-wider text-muted">
            <th className="px-2 pb-2 text-left font-medium">#</th>
            <th className="px-2 pb-2 text-left font-medium">Player</th>
            <th className="px-2 pb-2 text-right font-medium">Points</th>
            <th className="px-2 pb-2 text-right font-medium">Exact</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row, i) => (
            <tr key={rowKey(row)} className={rowClassName(row, viewerHandle)}>
              <td
                className={cn("px-2 py-2.5 font-semibold tabular-nums", i === 0 ? "text-gold" : "text-muted")}
              >
                {i + 1}
              </td>
              <PlayerCell row={row} viewerHandle={viewerHandle} />
              <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums">{row.points}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-muted">{row.exact_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Same table idiom as WeeklyTable, plus the season's Matchweeks column. */
function SeasonTable({ entries, viewerHandle }: { entries: SeasonEntry[]; viewerHandle: string | null }) {
  return (
    <div className="glass overflow-x-auto rounded-2xl p-2 sm:p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-label uppercase tracking-wider text-muted">
            <th className="px-2 pb-2 text-left font-medium">#</th>
            <th className="px-2 pb-2 text-left font-medium">Player</th>
            <th className="px-2 pb-2 text-right font-medium">Points</th>
            <th className="px-2 pb-2 text-right font-medium">Exact</th>
            <th className="px-2 pb-2 text-right font-medium">MWs</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row, i) => (
            <tr key={rowKey(row)} className={rowClassName(row, viewerHandle)}>
              <td
                className={cn("px-2 py-2.5 font-semibold tabular-nums", i === 0 ? "text-gold" : "text-muted")}
              >
                {i + 1}
              </td>
              <PlayerCell row={row} viewerHandle={viewerHandle} />
              <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums">{row.points}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-muted">{row.exact_count}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-muted">{row.matchweeks_played ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
