"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatchUserPrediction } from "@/components/MatchUserPrediction";
import { useMatchLive } from "@/components/match/MatchLiveProvider";
import {
  cachedPrediction,
  findMyLeagueTip,
  LeagueTipsNotOpen,
  type FoundTip,
} from "@/components/match/leagueTipLookup";
import { isLeagueTipsCompetition } from "@/components/match/picks";
import {
  agreementLine,
  draftReady,
  EMPTY_DRAFT,
  MAX_GOALS,
  MIN_GOALS,
  stepDraft,
  type Draft,
  type WeekFixture,
} from "@/components/match/matchPageData";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { Button, CheckIcon, TextLink } from "@/components/ui";
import { submitLeagueTip } from "@/lib/leagueTips";
import { ApiError, getOrCreateDeviceId, pingDailyActivity } from "@/lib/session";
import { recordEngagement } from "@/lib/engagement";
import { trackEvent } from "@/lib/analytics";
import { announceLockedPick, useModelRevealMap } from "@/lib/useModelReveal";
import { kickoffDate, kickoffTime, relativeDayLabel, tzAbbrev } from "@/lib/datetime";
import { isPickable, matchPhase, stoppedLabel, type MatchPhase } from "@/lib/matchStatus";
import { COMPETITIONS, footballMatchHref, type CompetitionId } from "@/lib/sports";
import { cn } from "@/lib/utils";
import type { LeagueTipsMineModel, LeagueTipsMineYourPrediction } from "@/lib/types";

export { isLeagueTipsCompetition };

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

/** The scoring line under the lock button (the game's real rules). */
export const PICK_RULES = "Exact score 5 points, right result 2. A locked pick is final.";

/** The pick, inside the match hero under a hairline (`#pick`, the target of
 *  every "Pick score"). Direction G: both boxes start EMPTY, round − / +
 *  steppers either side of each box, the lock button stays disabled until a
 *  score is set, and a locked pick is final (no edit, no unlock).
 *
 *  Club leagues play the SCORED scoreline game (the same /tips/submit as
 *  /play, 5 points exact / 2 right result). The World Cup archive keeps its
 *  local W/D/L pick while a fixture is open (none is today). Competitions
 *  without a pick game say so in one line. Renders nothing where there is no
 *  pick to show (a finished match: the call card carries the user's pick). */
export function MatchPick({
  competition,
  matchId,
  home,
  away,
  kickoffUtc,
  matchweek,
  modelScore = null,
  week = [],
  onLocked,
}: {
  competition: CompetitionId;
  matchId: number;
  home: string;
  away: string;
  /** The prediction's kickoff, used until the live summary says otherwise. */
  kickoffUtc: string | null;
  /** The match's league matchweek from the page payload (null: none;
   *  undefined: an older backend that does not send it). */
  matchweek?: number | null;
  /** The model's predicted score when the page already has it (for the
   *  "you and the model" line after a lock). */
  modelScore?: { home: number; away: number } | null;
  /** The matchweek's fixtures in kick-off order (for "Next: X v Y"). */
  week?: WeekFixture[];
  /** Called once the server has accepted a pick. */
  onLocked?: () => void;
}) {
  const live = useMatchLive();
  const [fallbackNow] = useState(() => new Date());
  const now = live?.now ?? fallbackNow;
  const summary = live?.summary ?? null;
  const kickoff = summary?.kickoff_utc ?? kickoffUtc;
  // The polled summary carries the field too; whichever payload has it wins.
  const mw = summary?.matchweek !== undefined ? summary.matchweek : matchweek;
  const status = summary?.status ?? "scheduled";
  const phase = matchPhase({ status, kickoff_utc: kickoff ?? null }, now);

  if (isLeagueTipsCompetition(competition)) {
    return (
      <LeagueScorePick
        league={competition}
        competition={competition}
        matchId={matchId}
        home={home}
        away={away}
        kickoffUtc={kickoff ?? null}
        matchweek={mw}
        liveStatus={summary?.status ?? null}
        phase={phase}
        now={now}
        refreshLive={live?.refresh}
        modelScore={modelScore}
        week={week}
        onLocked={onLocked}
      />
    );
  }
  if (competition === "wc26") {
    // The archive: only an open fixture (none today) still takes a W/D/L pick.
    if (!summary || !pickWindowOpen(status, kickoff, now)) return null;
    return (
      <PickShell>
        <MatchUserPrediction match={summary} now={now} />
      </PickShell>
    );
  }
  if (phase === "finished") return null;
  return (
    <PickShell heading={false}>
      <p className="text-notes text-muted">
        Score picks for the {COMPETITIONS[competition].label} aren&apos;t open yet, so the model&apos;s call is shown.
      </p>
    </PickShell>
  );
}

/** The hairline and the 550px pick column inside the hero. */
function PickShell({ children, heading = true }: { children: React.ReactNode; heading?: boolean }) {
  return (
    <>
      <div aria-hidden="true" className="mt-7 h-px w-full max-w-[550px] bg-line min-[900px]:mt-8" />
      <section
        id="pick"
        aria-labelledby={heading ? "pick-heading" : undefined}
        aria-label={heading ? undefined : "Your pick"}
        className="w-full max-w-[550px] scroll-mt-28 pt-7"
      >
        {heading && (
          <h2 id="pick-heading" className="text-h2 font-semibold text-ink">
            Your pick
          </h2>
        )}
        {children}
      </section>
    </>
  );
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
}

function LeagueScorePick({
  league,
  competition,
  matchId,
  home,
  away,
  kickoffUtc,
  matchweek,
  liveStatus,
  phase,
  now,
  refreshLive,
  modelScore,
  week,
  onLocked,
}: {
  league: string;
  competition: CompetitionId;
  matchId: number;
  home: string;
  away: string;
  kickoffUtc: string | null;
  matchweek?: number | null;
  /** The polled summary's status (fresher than the tips row), if any. */
  liveStatus: string | null;
  phase: MatchPhase;
  now: Date;
  refreshLive?: () => void;
  modelScore: { home: number; away: number } | null;
  week: WeekFixture[];
  onLocked?: () => void;
}) {
  // undefined until mounted (SSR / hydration), null when storage is blocked.
  const [deviceId, setDeviceId] = useState<string | null | undefined>(undefined);
  useEffect(() => setDeviceId(getOrCreateDeviceId()), []);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The server said "kicked off": close the stepper now, not on the next tick
  // of the 30 s clock (each further tap would only spend the rate limit).
  const [serverLocked, setServerLocked] = useState(false);
  // The server said a pick already exists. If the re-fetch still cannot find
  // it (the week does not list the match), never offer the stepper again.
  const [finalized, setFinalized] = useState(false);
  // Bumps after a sign-in claim, which can move this device's picks to an
  // account (and drop the device's own player row): re-read the server, and
  // forget what this card only knew locally.
  const identityVersion = useTipsIdentityVersion();
  const firstIdentity = useRef(identityVersion);
  useEffect(() => {
    if (identityVersion === firstIdentity.current) return;
    setSubmitted(null);
    setFinalized(false);
  }, [identityVersion]);

  useEffect(() => {
    if (deviceId === undefined) return;
    if (deviceId === null) {
      setLoad({ kind: "no-device" });
      return;
    }
    let alive = true;
    setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    findMyLeagueTip(league, deviceId, matchId, { matchweek, kickoffUtc })
      .then((found) => {
        if (alive) setLoad({ kind: "ready", found });
      })
      .catch((err) => {
        if (alive) setLoad(err instanceof LeagueTipsNotOpen ? { kind: "closed" } : { kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [deviceId, league, matchId, matchweek, kickoffUtc, attempt, identityVersion]);

  const found = load.kind === "ready" ? load.found : null;
  const row = found?.row ?? null;
  // The week the row was actually found in (null when it was not found).
  const foundWeek = found?.matchweek ?? null;
  // Merge-on-load parity with /play: a confirmed submit cached locally before
  // the server row reflects it still counts as the device's pick.
  const cached =
    !row?.your_prediction && foundWeek != null ? cachedPrediction(league, foundWeek, matchId) : null;
  const your: LeagueTipsMineYourPrediction | null =
    submitted?.your ??
    row?.your_prediction ??
    (cached ? { ...cached, points: null, exact: null, graded_at: null, updated_at: null } : null);
  const rowModel = submitted?.model ?? row?.model ?? null;
  const model =
    rowModel && rowModel.predicted_home != null && rowModel.predicted_away != null
      ? { home: rowModel.predicted_home, away: rowModel.predicted_away }
      : modelScore;
  // A confirmed result from either source wins: the page's summary can be
  // hours old (ISR), the tips row is never cached.
  const status = row?.status === "finished" ? "finished" : liveStatus ?? row?.status ?? "scheduled";
  const effectivePhase: MatchPhase = status === "finished" ? "finished" : phase;
  const open = !serverLocked && !finalized && pickWindowOpen(status, kickoffUtc, now);

  const retry = useCallback(() => {
    setMessage(null);
    setAttempt((a) => a + 1);
    refreshLive?.();
  }, [refreshLive]);

  async function lockIn() {
    if (!deviceId || pending || !draftReady(draft)) return;
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
      });
      // Every gated section on the page reveals at once (and the confirmed-
      // pick cache /play reads is written, as writePickerCache did).
      announceLockedPick({
        competition,
        matchId,
        matchweek: foundWeek ?? (typeof matchweek === "number" ? matchweek : null),
        pick: {
          kind: "score",
          home: res.prediction.predicted_home,
          away: res.prediction.predicted_away,
          points: null,
          exact: null,
          gradedAt: null,
        },
      });
      onLocked?.();
      recordEngagement("pick"); // gates the install prompt
      trackEvent("pick_submit", { competition, match_id: matchId, source: "match_page" });
      pingDailyActivity().catch(() => {}); // retention instrumentation, best-effort
    } catch (err) {
      if (err instanceof ApiError && err.code === "prediction_finalized") {
        // This device already has a pick (another tab, or /play): re-fetch to
        // show it, and stop offering the stepper either way.
        setMessage(err.message);
        setFinalized(true);
        setAttempt((a) => a + 1);
      } else if (err instanceof ApiError && err.code === "match_locked") {
        setMessage("This match has kicked off, so picks are closed.");
        setServerLocked(true);
        refreshLive?.();
      } else {
        setMessage(err instanceof ApiError ? err.message : "Couldn’t save your pick. Check your connection and try again.");
      }
    } finally {
      setPending(false);
    }
  }

  // A finished match: the model's call card shows the result, the call and
  // this viewer's pick with its points. Nothing to do here.
  if (effectivePhase === "finished") return null;

  const playHref = `/play?competition=${competition}`;
  const note = message ? (
    <p role="alert" className="mt-3 text-notes font-medium text-miss">
      {message}
    </p>
  ) : null;

  if (load.kind === "loading") {
    return (
      <PickShell>
        <div role="status" aria-label="Loading your pick…" className="mt-5 flex flex-col items-center gap-6">
          <div className="h-[72px] w-full max-w-[420px] rounded-[14px] bg-soft min-[480px]:h-[84px]" />
          <div className="h-14 w-full rounded-full bg-soft" />
        </div>
      </PickShell>
    );
  }
  if (load.kind === "error") {
    return (
      <PickShell>
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-notes text-muted">Picks are unavailable right now.</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      </PickShell>
    );
  }
  if (load.kind === "closed") {
    return (
      <PickShell>
        <p className="mt-3 text-notes text-muted">
          Score picks for the {COMPETITIONS[competition].label} aren&apos;t open yet.
        </p>
      </PickShell>
    );
  }
  if (load.kind === "no-device") {
    return (
      <PickShell>
        <p className="mt-3 text-notes text-muted">
          Picks need your browser&apos;s storage to remember you. Allow site data to play.
        </p>
      </PickShell>
    );
  }

  if (your) {
    const mine = { home: your.predicted_home, away: your.predicted_away };
    const stopped = stoppedLabel(status);
    const line =
      status === "postponed"
        ? "Postponed. Your pick carries over to the new date."
        : status === "cancelled"
          ? "Cancelled. This pick won’t be scored."
          : status === "suspended"
            ? "Suspended. Points wait on the outcome."
            : effectivePhase === "live" || effectivePhase === "stale"
              ? "Points land at full time."
              : model
                ? agreementLine(mine, model)
                : null;
    return (
      <PickShell>
        <div className="mb-6 mt-5 flex items-center justify-center gap-3.5">
          <ScoreBox value={mine.home} team={home} />
          <Dash />
          <ScoreBox value={mine.away} team={away} />
        </div>
        <p className="inline-flex items-center justify-center gap-2 font-semibold text-brand">
          <CheckIcon size={16} />
          <span>
            Locked.{line ? ` ${line}` : ""}
            {stopped && !line ? ` ${stopped}.` : ""}
          </span>
        </p>
        <NextPick competition={competition} matchId={matchId} week={week} playHref={playHref} />
        {note}
      </PickShell>
    );
  }

  if (finalized) {
    return (
      <PickShell>
        <p className="mt-3 font-semibold text-ink">Your pick for this match is already locked in.</p>
        <div className="mt-4">
          <TextLink href={playHref}>See it in My picks</TextLink>
        </div>
        {note}
      </PickShell>
    );
  }

  if (!open) {
    const stopped = stoppedLabel(status);
    return (
      <PickShell>
        <p className="mt-3 text-notes text-muted">
          {stopped ? `${stopped}. This match won’t be scored.` : "Picks closed at kick-off. You didn’t pick this one."}
        </p>
        <NextPick competition={competition} matchId={matchId} week={week} playHref={playHref} quiet />
        {note}
      </PickShell>
    );
  }

  const ready = draftReady(draft);
  const step = (side: "home" | "away", dir: 1 | -1) => setDraft((d) => stepDraft(d, side, dir));
  return (
    <PickShell>
      <div
        role="group"
        aria-label="Set your score"
        className="mb-6 mt-5 flex items-center justify-center gap-0.5 min-[400px]:gap-1 min-[480px]:gap-3.5"
      >
        <Stepper label={`Take a goal off ${home}`} disabled={pending || draft.home === MIN_GOALS} onClick={() => step("home", -1)}>
          −
        </Stepper>
        <ScoreBox value={draft.home} team={home} live />
        <Stepper label={`Add a goal for ${home}`} disabled={pending || draft.home === MAX_GOALS} onClick={() => step("home", 1)}>
          +
        </Stepper>
        <Dash />
        <Stepper label={`Take a goal off ${away}`} disabled={pending || draft.away === MIN_GOALS} onClick={() => step("away", -1)}>
          −
        </Stepper>
        <ScoreBox value={draft.away} team={away} live />
        <Stepper label={`Add a goal for ${away}`} disabled={pending || draft.away === MAX_GOALS} onClick={() => step("away", 1)}>
          +
        </Stepper>
      </div>
      <Button wide disabled={!ready || pending} onClick={lockIn}>
        {pending
          ? "Locking in…"
          : ready
            ? `Lock in ${home} ${draft.home}–${draft.away} ${away}`
            : "Use + and − to set a score"}
      </Button>
      <p className="mt-3.5 text-notes text-muted">
        {status === "postponed" ? "Postponed: picks stay open until the new kick-off. " : ""}
        {PICK_RULES}
      </p>
      {note}
    </PickShell>
  );
}

function Stepper({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-ground text-[20px] font-semibold leading-none text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:border-line min-[480px]:h-12 min-[480px]:w-12"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

/** A score box: soft 72×84 (smaller on narrow phones), "–" while empty. */
function ScoreBox({ value, team, live }: { value: number | null; team: string; live?: boolean }) {
  return (
    <div
      aria-live={live ? "polite" : undefined}
      aria-atomic={live ? "true" : undefined}
      className={cn(
        "grid h-16 w-12 shrink-0 place-items-center rounded-[14px] bg-soft text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums min-[400px]:h-[72px] min-[400px]:w-14 min-[400px]:text-[36px] min-[480px]:h-[84px] min-[480px]:w-[72px] min-[480px]:text-[44px]",
        value == null ? "text-placeholder" : "text-ink",
      )}
    >
      <span className="sr-only">{team} </span>
      {value == null ? (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">not set</span>
        </>
      ) : (
        value
      )}
    </div>
  );
}

function Dash() {
  return (
    <span aria-hidden="true" className="px-0.5 text-[22px] text-dash">
      –
    </span>
  );
}

/** "Next: X v Y" to the matchweek's next unpicked open fixture, else "All
 *  picked. See my picks". Reads the same /tips/mine the reveal hooks share. */
function NextPick({
  competition,
  matchId,
  week,
  playHref,
  quiet,
}: {
  competition: CompetitionId;
  matchId: number;
  week: WeekFixture[];
  playHref: string;
  /** Closed without a pick: only offer a next match, never "All picked". */
  quiet?: boolean;
}) {
  const fixtures = useMemo(
    () =>
      week.map((f) => ({
        competition,
        matchId: f.id,
        status: f.status,
        kickoffUtc: f.kickoffUtc,
        matchweek: f.matchweek,
      })),
    [week, competition],
  );
  const reveals = useModelRevealMap(fixtures);
  if (reveals.isLoading) return <div className="mt-6 min-h-[56px]" aria-hidden="true" />;
  // Open and not picked by this device = the reveal rule's "hidden".
  const next = week.find((f) => f.id !== matchId && reveals.get(f.id).reason === "hidden");
  if (next) {
    return (
      <div className="mt-6">
        <Button wide href={footballMatchHref(competition, next.id)}>
          Next: {next.home} v {next.away}
        </Button>
      </div>
    );
  }
  if (quiet) return null;
  return (
    <div className="mt-6">
      <Button wide href={playHref}>
        All picked. See my picks
      </Button>
    </div>
  );
}
