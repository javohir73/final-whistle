"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { Skeleton } from "@/components/Skeleton";
import { MatchUserPrediction } from "@/components/MatchUserPrediction";
import { useMatchLive, type MatchLive } from "@/components/match/MatchLiveProvider";
import {
  cachedPrediction,
  findMyLeagueTip,
  LeagueTipsNotOpen,
  writePickerCache,
  type FoundTip,
} from "@/components/match/leagueTipLookup";
import { submitLeagueTip } from "@/lib/leagueTips";
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import { ApiError, getOrCreateDeviceId, pingDailyActivity } from "@/lib/session";
import { recordEngagement } from "@/lib/engagement";
import { trackEvent } from "@/lib/analytics";
import { useTimezone } from "@/lib/useTimezone";
import { kickoffDate, kickoffTime, relativeDayLabel, tzAbbrev } from "@/lib/datetime";
import { formatScore } from "@/lib/format";
import { isPickable, matchPhase, RESULT_PENDING, stoppedLabel, type MatchPhase } from "@/lib/matchStatus";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { cn } from "@/lib/utils";
import type { LeagueTipsMineModel, LeagueTipsMineYourPrediction } from "@/lib/types";

const MIN_GOALS = 0;
const MAX_GOALS = 9;

/** Competitions whose match pages host the scored scoreline game. One source
 *  of truth with /play (lib/leagueConfig ACTIVE_LEAGUES): a league joins here
 *  the moment it joins there, so a pick made on a match page always shows up in
 *  /play and on the leaderboard. */
export function isLeagueTipsCompetition(competition: CompetitionId): boolean {
  return ACTIVE_LEAGUES.includes(competition);
}

/** Server-mirrored pick window: the status must be open for picks
 *  (scheduled / postponed, as the backend's OPEN_FOR_PICKS) and a scheduled
 *  fixture locks at kickoff by the clock, before the feed even flips. */
export function pickWindowOpen(status: string, kickoffUtc: string | null | undefined, now: Date): boolean {
  if (!isPickable(status)) return false;
  if (status !== "scheduled" || !kickoffUtc) return true;
  return now.getTime() < Date.parse(kickoffUtc);
}

/** "Locks at kickoff · 3:00 PM AEDT" (today) / "· Sat 8 Nov, 3:00 PM AEDT". */
export function pickLockLine(
  status: string,
  kickoffUtc: string | null | undefined,
  now: Date,
  tz: string,
): string {
  if (status === "postponed") return "Postponed · picks stay open";
  const stopped = stoppedLabel(status);
  if (stopped) return `${stopped} · picks closed`;
  if (!pickWindowOpen(status, kickoffUtc, now)) return "Locked at kickoff";
  if (!kickoffUtc) return "Locks at kickoff";
  const time = `${kickoffTime(kickoffUtc, tz)} ${tzAbbrev(kickoffUtc, tz)}`.trim();
  const day = relativeDayLabel(kickoffUtc, tz, now);
  if (day === "Today") return `Locks at kickoff · ${time}`;
  return `Locks at kickoff · ${day ?? kickoffDate(kickoffUtc, tz)}, ${time}`;
}

/** The pick, directly under the model's call (`#pick`, the target of every
 *  "Make your pick"). A sport-agnostic shell -- heading and lock line -- over
 *  one adapter per game:
 *
 *  - club leagues: the SCORED scoreline game (the same /tips/submit as /play,
 *    5 pts exact / 2 pts right result), so a pick here counts;
 *  - the World Cup (knockout): the legacy W/D/L pick, kept for the archive;
 *  - anything else: an honest "not open" note.
 *
 *  The shell never disappears: when the API fails it says so and offers a
 *  retry. Pickability reads the page's shared live feed, so the controls lock
 *  at kickoff on an open tab without a reload. */
export function MatchPick({
  competition,
  matchId,
  home,
  away,
  kickoffUtc,
}: {
  competition: CompetitionId;
  matchId: number;
  home: string;
  away: string;
  /** The prediction's kickoff, used until the live summary says otherwise. */
  kickoffUtc: string | null;
}) {
  const live = useMatchLive();
  const { tz } = useTimezone();
  const [fallbackNow] = useState(() => new Date());
  const now = live?.now ?? fallbackNow;
  const summary = live?.summary ?? null;
  const kickoff = summary?.kickoff_utc ?? kickoffUtc;
  const status = summary?.status ?? "scheduled";
  const phase = matchPhase({ status, kickoff_utc: kickoff ?? null }, now);

  return (
    <section id="pick" aria-labelledby="pick-heading" className="scroll-mt-24">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
        <h2 id="pick-heading" className="font-display text-lg font-bold text-foreground">
          Your pick
        </h2>
        <span className="text-label font-semibold text-muted">{pickLockLine(status, kickoff, now, tz)}</span>
      </div>
      {isLeagueTipsCompetition(competition) ? (
        <LeagueScorePick
          league={competition}
          competition={competition}
          matchId={matchId}
          home={home}
          away={away}
          kickoffUtc={kickoff ?? null}
          liveStatus={summary?.status ?? null}
          liveScore={summary ? { home: summary.score_home, away: summary.score_away } : null}
          phase={phase}
          now={now}
          refreshLive={live?.refresh}
        />
      ) : competition === "wc26" ? (
        <OutcomePick live={live} />
      ) : (
        <PicksNotOpen competition={competition} />
      )}
    </section>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("glass rounded-2xl p-4", className)}>{children}</div>;
}

function Unavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold text-foreground">Picks unavailable right now</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition hover:border-win hover:text-lime-deep"
        >
          Retry
        </button>
      )}
    </Card>
  );
}

function PickSkeleton() {
  return (
    <Card>
      <div role="status" aria-label="Loading your pick…" className="space-y-3">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </Card>
  );
}

function PicksNotOpen({ competition }: { competition: CompetitionId }) {
  return (
    <Card>
      <p className="text-sm text-foreground">
        Score picks for {COMPETITIONS[competition].label} aren&apos;t open yet.
      </p>
      <Link href="/play" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-lime-deep">
        See what&apos;s open in Play →
      </Link>
    </Card>
  );
}

/** World Cup adapter: the local W/D/L pick, fed by the shared live summary so
 *  it locks at kickoff like everything else on the page. */
function OutcomePick({ live }: { live: MatchLive | null }) {
  if (live?.summary) return <MatchUserPrediction match={live.summary} now={live.now} />;
  if (live?.loading) return <PickSkeleton />;
  return <Unavailable onRetry={live?.refresh} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; found: FoundTip }
  | { kind: "error" }
  | { kind: "closed" }
  | { kind: "no-device" };

interface Submitted {
  your: LeagueTipsMineYourPrediction;
  model: LeagueTipsMineModel | null;
  handle: string;
}

function LeagueScorePick({
  league,
  competition,
  matchId,
  home,
  away,
  kickoffUtc,
  liveStatus,
  liveScore,
  phase,
  now,
  refreshLive,
}: {
  league: string;
  competition: CompetitionId;
  matchId: number;
  home: string;
  away: string;
  kickoffUtc: string | null;
  /** The polled summary's status (fresher than the tips row), if any. */
  liveStatus: string | null;
  liveScore: { home: number | null; away: number | null } | null;
  phase: MatchPhase;
  now: Date;
  refreshLive?: () => void;
}) {
  // undefined until mounted (SSR / hydration), null when storage is blocked.
  const [deviceId, setDeviceId] = useState<string | null | undefined>(undefined);
  useEffect(() => setDeviceId(getOrCreateDeviceId()), []);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [draft, setDraft] = useState({ home: 0, away: 0 });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (deviceId === undefined) return;
    if (deviceId === null) {
      setLoad({ kind: "no-device" });
      return;
    }
    let alive = true;
    setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    findMyLeagueTip(league, deviceId, matchId, kickoffUtc)
      .then((found) => {
        if (alive) setLoad({ kind: "ready", found });
      })
      .catch((err) => {
        if (alive) setLoad(err instanceof LeagueTipsNotOpen ? { kind: "closed" } : { kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [deviceId, league, matchId, kickoffUtc, attempt]);

  const found = load.kind === "ready" ? load.found : null;
  const row = found?.row ?? null;
  const matchweek = found?.matchweek ?? null;
  // Merge-on-load parity with /play: a confirmed submit cached locally before
  // the server row reflects it still counts as the device's pick.
  const cached =
    !row?.your_prediction && matchweek != null ? cachedPrediction(league, matchweek, matchId) : null;
  const your: LeagueTipsMineYourPrediction | null =
    submitted?.your ??
    row?.your_prediction ??
    (cached ? { ...cached, points: null, exact: null, graded_at: null, updated_at: null } : null);
  const model = submitted?.model ?? row?.model ?? null;
  const handle = submitted?.handle ?? found?.handle ?? null;
  const status = liveStatus ?? row?.status ?? "scheduled";
  const open = pickWindowOpen(status, kickoffUtc, now);
  const finalScore =
    row?.score_home != null && row?.score_away != null
      ? formatScore(row.score_home, row.score_away)
      : liveScore && liveScore.home != null && liveScore.away != null
        ? formatScore(liveScore.home, liveScore.away)
        : null;

  const retry = useCallback(() => {
    setMessage(null);
    setAttempt((a) => a + 1);
    refreshLive?.();
  }, [refreshLive]);

  async function lockIn() {
    if (!deviceId || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await submitLeagueTip(league, {
        device_id: deviceId,
        match_id: matchId,
        predicted_home: draft.home,
        predicted_away: draft.away,
      });
      setSubmitted({
        your: {
          predicted_home: res.prediction.predicted_home,
          predicted_away: res.prediction.predicted_away,
          points: null,
          exact: null,
          graded_at: null,
          updated_at: res.prediction.updated_at,
        },
        model: res.model,
        handle: res.handle,
      });
      if (matchweek != null) {
        writePickerCache(league, matchweek, matchId, {
          predicted_home: res.prediction.predicted_home,
          predicted_away: res.prediction.predicted_away,
        });
      }
      recordEngagement("pick"); // gates the install prompt
      trackEvent("pick_submit", { competition, match_id: matchId, source: "match_page" });
      pingDailyActivity().catch(() => {}); // retention instrumentation, best-effort
    } catch (err) {
      if (err instanceof ApiError && err.code === "prediction_finalized") {
        // This device already has a pick (another tab, or /play): show it.
        setMessage(err.message);
        setAttempt((a) => a + 1);
      } else if (err instanceof ApiError && err.code === "match_locked") {
        setMessage("This match has kicked off, so picks are closed.");
        refreshLive?.();
      } else {
        setMessage(err instanceof ApiError ? err.message : "Couldn't save your pick. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  if (load.kind === "loading") return <PickSkeleton />;
  if (load.kind === "error") return <Unavailable onRetry={retry} />;
  if (load.kind === "closed") return <PicksNotOpen competition={competition} />;
  if (load.kind === "no-device") {
    return (
      <Card>
        <p className="text-sm text-foreground">
          Picks need your browser&apos;s storage to remember you. Allow site data to play.
        </p>
      </Card>
    );
  }

  const playHref = `/play?competition=${competition}`;
  const boardHref = `/leaderboard?competition=${competition}`;
  const note = message ? (
    <p role="alert" className="mt-2 text-xs font-medium text-loss-ink">
      {message}
    </p>
  ) : null;

  if (your) {
    const yours = formatScore(your.predicted_home, your.predicted_away);
    const models = model ? formatScore(model.predicted_home, model.predicted_away) : "—";
    const graded = your.graded_at != null && your.points != null;
    if (graded) {
      const pts = your.points ?? 0;
      const headline = your.exact
        ? `You +${pts} pts · exact score`
        : pts > 0
          ? `You +${pts} pts · right result`
          : "You 0 pts · not this time";
      return (
        <Card>
          <p className={cn("font-display text-lg font-extrabold", pts > 0 ? "text-lime-deep" : "text-foreground")}>
            {headline}
          </p>
          <p className="mt-1 text-sm tabular-nums text-muted">
            You {yours} · Model {models}
            {finalScore ? ` · Final ${finalScore}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5">
            <Link href={playHref} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-lime-deep">
              Your picks →
            </Link>
            <Link href={boardHref} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-lime-deep">
              Leaderboard →
            </Link>
          </div>
          {note}
        </Card>
      );
    }
    const progress =
      phase === "live"
        ? "In play · points land at full time"
        : phase === "stale"
          ? `${RESULT_PENDING} · points land once it's confirmed`
          : phase === "finished"
            ? `Full time${finalScore ? ` ${finalScore}` : ""} · points land when the result is graded`
            : "Locked in · 5 pts for the exact score, 2 for the right result";
    return (
      <Card>
        <p className="font-display text-lg font-extrabold tabular-nums text-foreground">
          You {yours} · Model {models}
        </p>
        <p className="mt-1 text-sm text-muted">{progress}</p>
        <Link href={playHref} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-lime-deep">
          Pick the rest of the matchweek →
        </Link>
        {note}
      </Card>
    );
  }

  if (!open) {
    const stopped = stoppedLabel(status);
    return (
      <Card>
        <p className="font-display text-base font-bold text-foreground">
          {stopped ? `${stopped} · no picks` : "Picks closed at kickoff"}
        </p>
        <p className="mt-1 text-sm tabular-nums text-muted">
          {stopped ? "This match won't be scored." : "You didn't pick this one."}
          {model ? ` Model ${formatScore(model.predicted_home, model.predicted_away)}.` : ""}
        </p>
        <Link href={playHref} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-lime-deep">
          Pick what&apos;s still open →
        </Link>
        {note}
      </Card>
    );
  }

  const scoreline = formatScore(draft.home, draft.away);
  return (
    <Card>
      <div className="space-y-2.5">
        <GoalStepper
          team={home}
          value={draft.home}
          disabled={pending}
          onChange={(v) => setDraft((d) => ({ ...d, home: v }))}
        />
        <GoalStepper
          team={away}
          value={draft.away}
          disabled={pending}
          onChange={(v) => setDraft((d) => ({ ...d, away: v }))}
        />
      </div>
      <button
        type="button"
        onClick={lockIn}
        disabled={pending}
        className="mt-3.5 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-win px-4 font-display text-sm font-bold text-action-ink transition hover:brightness-105 disabled:cursor-wait disabled:opacity-disabled-40"
      >
        {pending ? "Locking in…" : `Lock in ${scoreline}`}
      </button>
      <p className="mt-2.5 text-xs leading-relaxed text-muted">
        5 pts for the exact score, 2 for the right result. Your first pick is final: locking in
        reveals the model&apos;s frozen scoreline.
        {handle ? ` Playing as ${handle}.` : ""}
      </p>
      {note}
    </Card>
  );
}

function GoalStepper({
  team,
  value,
  disabled,
  onChange,
}: {
  team: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const step = (delta: 1 | -1) => onChange(Math.min(MAX_GOALS, Math.max(MIN_GOALS, value + delta)));
  const button =
    "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-2/50 text-lg font-bold text-muted transition hover:border-win/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-disabled-40";
  return (
    <div role="group" aria-label={`${team} goals`} className="flex items-center gap-3">
      <TeamBadge team={team} size={24} />
      <span className="min-w-0 flex-1 truncate font-display text-sm font-bold">{team}</span>
      <button
        type="button"
        aria-label={`Fewer ${team} goals`}
        disabled={disabled || value <= MIN_GOALS}
        onClick={() => step(-1)}
        className={button}
      >
        −
      </button>
      <span
        aria-live="polite"
        aria-atomic="true"
        className="w-7 text-center font-display text-xl font-extrabold tabular-nums text-foreground"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`More ${team} goals`}
        disabled={disabled || value >= MAX_GOALS}
        onClick={() => step(1)}
        className={button}
      >
        +
      </button>
    </div>
  );
}
