import Link from "next/link";
import { TeamBadge } from "@/components/TeamBadge";
import { Eyebrow } from "@/components/Eyebrow";
import { RESULT_PENDING } from "@/lib/matchStatus";
import { cn } from "@/lib/utils";
import type { LivePeriod } from "@/lib/types";

export type ScorebugStatus = "upcoming" | "live" | "ft" | "stale";

/** What the polite live region says: the score and the phase, never the
 *  running minute -- the minute moves on almost every 30 s poll, and a screen
 *  reader would re-announce the match about once a minute for two hours. A
 *  change of score, a half-time / extra-time / penalties phase and full time
 *  are announced; ticks of the clock are not. */
function scoreAnnouncement(
  status: ScorebugStatus,
  home: string,
  away: string,
  score: string | null | undefined,
  livePeriod: LivePeriod | undefined,
  penaltyTally: string | null | undefined,
): string {
  if (!score) return "";
  const line = `${home} ${score} ${away}`;
  if (status === "ft") return `Full time: ${line}`;
  if (status === "stale") return `${RESULT_PENDING}: ${line}`;
  if (status !== "live") return "";
  const phase =
    livePeriod === "half_time"
      ? ", half-time"
      : livePeriod === "extra_time"
        ? ", extra time"
        : livePeriod === "penalty_shootout"
          ? `, penalties${penaltyTally ? ` ${penaltyTally}` : ""}`
          : "";
  return `Live: ${line}${phase}`;
}

/** TV-style broadcast scorebug: the top of the match hero (prototype
 *  match-detail lines 211-232) -- a centred stack of competition eyebrow →
 *  status line → crest/score row → team names, under a "floodlight" glow wash.
 *
 *  Presentational only — MatchScoreboard owns the live summary and feeds
 *  derived values in, so this reads identically under every football route.
 *
 *  The centre slot is reserved for REAL scores. Before kickoff it says "vs":
 *  the model's predicted scoreline used to sit here at 40 px under a small
 *  "MOST LIKELY SCORE" caption and read as a result in any screenshot or
 *  share. It now lives in the Model's call chip below, with the one W/D/L bar.
 *
 *  Status decides the voice: `upcoming` an amber kickoff·venue line; `live` a
 *  pulsing rose LIVE·clock·venue; `ft` a muted FULL TIME·venue; `stale` (the
 *  feed stopped short of a confirmed result) an amber RESULT PENDING·venue
 *  with the last known score -- full time is never inferred. */
export function Scorebug({
  competitionLabel,
  home,
  away,
  homeTeamId,
  awayTeamId,
  status,
  liveLabel,
  liveLabelSpoken,
  livePeriod,
  statusLine,
  venue,
  score,
  penaltyTally,
  teamBasePath = "/team",
}: {
  competitionLabel: string;
  home: string;
  away: string;
  homeTeamId?: number | null;
  awayTeamId?: number | null;
  status: ScorebugStatus;
  /** Live clock/phase (e.g. "63' est.", "HT", "PENS"); null unless live. */
  liveLabel?: string | null;
  /** The same clock for screen readers ("63' (estimated)"); read in place,
   *  never from the live region. */
  liveLabelSpoken?: string | null;
  /** Phase of play while live (half-time / extra time / penalties are
   *  announced; the running minute is not). */
  livePeriod?: LivePeriod;
  /** Pre-match kickoff·venue line (or a stopped label); null when unknown. */
  statusLine?: string | null;
  /** Venue, appended to the live / full-time / pending status line. */
  venue?: string | null;
  /** Actual scoreline once the match is live, final or pending; null before. */
  score?: string | null;
  /** Live penalty-shootout tally (e.g. "5–4"); null unless a shootout is in
   *  progress. The centre score stays level (1–1) through the shootout, so this
   *  runs underneath it as the decisive number. */
  penaltyTally?: string | null;
  teamBasePath?: string;
}) {
  const showScore = status !== "upcoming" && !!score;
  const venueTail = venue ? ` · ${venue}` : "";

  return (
    <div className="relative overflow-hidden border-b border-border px-[18px] pb-4 pt-4 text-center">
      {/* The prototype's radial "under the lights" wash behind the scorebug. */}
      <div className="floodlight-glow-top pointer-events-none absolute inset-0" aria-hidden />

      {/* One always-mounted polite region carrying the SCORE and the phase:
          screen readers announce changes inside an existing region, and the
          visible scoreboard is static markup to them. The running minute is
          deliberately not in it (see scoreAnnouncement). */}
      <p className="sr-only" role="status">
        {scoreAnnouncement(status, home, away, score, livePeriod, penaltyTally)}
      </p>

      <div className="relative">
        <Eyebrow tone="muted">{competitionLabel}</Eyebrow>

        {/* Status line — the middle changes voice per state, colour AND label. */}
        {status === "live" ? (
          <>
            <div
              className="mt-2 flex items-center justify-center gap-[7px] text-label font-bold uppercase tracking-[0.14em] text-loss-ink"
              aria-hidden
            >
              {/* Rose dot + pulsing ring; both reduced-motion-gated in globals. */}
              <span className="status-live-dot status-live-ring h-[7px] w-[7px] rounded-full bg-current" aria-hidden />
              LIVE{liveLabel ? ` · ${liveLabel}` : ""}{venueTail}
            </div>
            {/* The same line for screen readers, with the estimate spelled out.
                Read in place, not announced on every tick. */}
            <p className="sr-only">
              {["LIVE", liveLabelSpoken ?? liveLabel, venue].filter(Boolean).join(", ")}
            </p>
          </>
        ) : status === "ft" ? (
          <div className="mt-2 text-label font-bold uppercase tracking-[0.14em] text-muted">
            FULL TIME{venueTail}
          </div>
        ) : status === "stale" ? (
          <div className="mt-2 text-label font-bold uppercase tracking-[0.14em] text-draw-ink">
            {RESULT_PENDING.toUpperCase()}{venueTail}
          </div>
        ) : (
          statusLine && (
            <div className="mt-2 text-label font-bold uppercase tracking-[0.14em] text-amber-ink">
              {statusLine}
            </div>
          )
        )}

        {/* Crests + the real score, or "vs" until there is one. */}
        <div className="mt-2.5 flex items-center justify-center gap-[18px]">
          <Crest team={home} teamId={homeTeamId} teamBasePath={teamBasePath} />
          <span
            className={cn(
              "font-display font-extrabold tracking-[-0.03em] tabular-nums",
              showScore ? "text-score" : "text-numeral text-muted",
            )}
          >
            {showScore ? score : "vs"}
          </span>
          <Crest team={away} teamId={awayTeamId} teamBasePath={teamBasePath} />
        </div>
        {/* Live shootout: the level score above is stuck at 1–1, so the running
            spot-kick tally is the decisive number. Rose ties it to the LIVE·PENS
            status; `uppercase` renders "PENS" but keeps the text node lowercase. */}
        {penaltyTally && (
          <div className="mt-1 text-body font-bold uppercase tracking-[0.06em] tabular-nums text-loss-ink">
            {penaltyTally} pens
          </div>
        )}

        <div className="mt-1.5 flex justify-center gap-[26px] font-display text-body font-bold">
          <span>{home}</span>
          <span className="text-muted">{away}</span>
        </div>
      </div>
    </div>
  );
}

/** A crest chip, linked to the team page when we have the id (mirrors the match
 *  scoreboard's TeamHead linking). The 44px flag is itself the >=44px tap target. */
function Crest({
  team,
  teamId,
  teamBasePath,
}: {
  team: string;
  teamId?: number | null;
  teamBasePath: string;
}) {
  const crest = <TeamBadge team={team} size={44} />;
  if (teamId == null) return crest;
  return (
    <Link
      href={`${teamBasePath}/${teamId}`}
      aria-label={`View ${team} profile`}
      className="inline-flex rounded-full transition hover:opacity-80"
    >
      {crest}
    </Link>
  );
}
