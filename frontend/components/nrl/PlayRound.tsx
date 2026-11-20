"use client";

import { useCallback, useEffect, useState } from "react";
import { ClubBadge } from "@/components/ClubBadge";
import { Card, CARD_X, Tag } from "@/components/ui";
import { visibleModel } from "@/components/nrl/useMyNrlRound";
import { ConfidenceRing } from "@/components/ConfidenceRing";
import { ErrorState, Loading } from "@/components/States";
import { nrlKickoffLabel as kickoffLabel } from "@/lib/nrlDisplay";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { NRL_TIPS_CACHE_PREFIX, useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { trackEvent } from "@/lib/analytics";
import { confidenceTier } from "@/lib/confidenceTier";
import { recordEngagement } from "@/lib/engagement";
import { getMyNrlTips, submitNrlTip } from "@/lib/nrlTips";
import { ApiError, getOrCreateDeviceId, pingDailyActivity } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { NrlMyTipsMatch, NrlMyTipYourTip } from "@/lib/types";

type Pick = "home" | "draw" | "away";

// Per-round local cache: paints last-confirmed picks instantly on a repeat
// visit instead of waiting on /tips/mine, mirrors useMatchPicks' localStorage
// idiom. Only ever written from a CONFIRMED (server-accepted) submit --
// see submit() below -- so a stale/rejected optimistic value never persists.
// Cleared after a sign-in claim (components/play/tipsIdentity.ts).
const CACHE_PREFIX = NRL_TIPS_CACHE_PREFIX;

interface CachedTip {
  pick: Pick;
  margin: number | null;
}

function readCache(season: number, round: number): Record<number, CachedTip> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${season}:${round}`);
    return raw ? (JSON.parse(raw) as Record<number, CachedTip>) : {};
  } catch {
    return {}; // corrupt -- start fresh
  }
}

function writeCache(season: number, round: number, matchId: number, tip: CachedTip): void {
  try {
    const next = { ...readCache(season, round), [matchId]: tip };
    window.localStorage.setItem(`${CACHE_PREFIX}${season}:${round}`, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode / quota) -- non-fatal */
  }
}

function pickLabel(pick: Pick, match: NrlMyTipsMatch): string {
  return pick === "home" ? (match.home ?? "Home") : pick === "away" ? (match.away ?? "Away") : "a draw";
}

/** "Play this round" (design doc: NRL Round Tips, Slice 2): tap-to-pick per
 *  game plus a margin guess on the featured match, submitted anonymously via
 *  the device id. `season`/`round` come from the already-rendered tipsheet
 *  so this can never disagree with what the page above it is showing.
 *
 *  Nothing here renders server-side with user-specific data -- the ISR page
 *  stays cacheable because every fetch below happens client-side after
 *  mount (deviceId starts null during SSR/hydration, same guard as
 *  ActivityPing/useMatchPicks).
 *
 *  `showConfidence` (default false, Floodlight P5 p5-s5) opts each row into the
 *  shared ConfidenceRing beside the model's call. Only the Play hub passes true;
 *  /nrl/tips leaves it off, so that route stays byte-for-byte unchanged. */
export function PlayRound({
  season,
  round,
  showConfidence = false,
}: {
  season: number;
  round: number;
  showConfidence?: boolean;
}) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => setDeviceId(getOrCreateDeviceId()), []);

  // Local clock so a row freezes into its locked state the moment kickoff
  // passes, even if the tab has been open since before it did (mirrors
  // MatchesClient's always-on tick).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [matches, setMatches] = useState<NrlMyTipsMatch[] | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [marginDraft, setMarginDraft] = useState<Record<number, string>>({});
  // Re-read the server when a sign-in claim may have changed whose tips
  // this device shows.
  const identityVersion = useTipsIdentityVersion();

  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    setLoadError(null);
    getMyNrlTips(deviceId, season, round)
      .then((res) => {
        if (!live) return;
        // Fill in any locally-cached pick the server doesn't know about yet
        // (e.g. a submit that raced this load) -- server truth wins per match.
        const cache = readCache(season, round);
        const merged = res.matches.map((m) => {
          if (m.your_tip || !cache[m.id]) return m;
          const c = cache[m.id];
          const your_tip: NrlMyTipYourTip = {
            pick: c.pick, margin: c.margin, points: null, round_margin: null,
            graded_at: null, updated_at: null,
          };
          return { ...m, your_tip };
        });
        setMatches(merged);
        setHandle(res.handle);
        reportViewerHandle(res.handle);
      })
      .catch((err) => {
        if (!live) return;
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load this round's tips.");
      });
    return () => {
      live = false;
    };
  }, [deviceId, season, round, attempt, identityVersion]);

  const submit = useCallback(
    async (matchId: number, pick: Pick, marginOverride?: number) => {
      if (!deviceId) return;
      const prevMatches = matches;
      const prevTip = matches?.find((m) => m.id === matchId)?.your_tip ?? null;
      const margin = marginOverride !== undefined ? marginOverride : (prevTip?.margin ?? null);

      setRowError((e) => {
        const next = { ...e };
        delete next[matchId];
        return next;
      });
      setPending((p) => ({ ...p, [matchId]: true }));
      // Optimistic paint -- reverted below if the server rejects it.
      setMatches(
        (cur) =>
          cur?.map((m) =>
            m.id === matchId
              ? { ...m, your_tip: { pick, margin, points: null, round_margin: null, graded_at: null, updated_at: new Date().toISOString() } }
              : m,
          ) ?? cur,
      );

      try {
        const res = await submitNrlTip({ device_id: deviceId, match_id: matchId, pick, margin });
        setMatches(
          (cur) =>
            cur?.map((m) =>
              m.id === matchId
                ? { ...m, your_tip: { pick: res.tip.pick, margin: res.tip.margin, points: null, round_margin: null, graded_at: null, updated_at: res.tip.updated_at } }
                : m,
            ) ?? cur,
        );
        writeCache(season, round, matchId, { pick: res.tip.pick, margin: res.tip.margin });
        setHandle(res.handle);
        reportViewerHandle(res.handle);
        // Retention instrumentation (design doc: "tips-locked ... ride the
        // existing activity-ping client") -- reuse the same best-effort call
        // ActivityPing fires on every page load, not a new analytics path.
        pingDailyActivity().catch(() => {});
        // A scored tip is the engagement signal the install prompt waits for,
        // and the loop's own funnel event.
        recordEngagement("pick");
        trackEvent("tips_submit", { competition: "nrl", round, match_id: matchId });
      } catch (err) {
        setMatches(prevMatches ?? null); // never claim a rejected pick was saved
        setRowError((e) => ({
          ...e,
          [matchId]: err instanceof ApiError ? err.message : "Couldn't save your tip — try again.",
        }));
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[matchId];
          return next;
        });
      }
    },
    [deviceId, matches, season, round],
  );

  if (loadError) return <ErrorState message={loadError} onRetry={() => setAttempt((a) => a + 1)} />;
  if (!matches) return <Loading label="Loading this round's tips…" />;
  if (matches.length === 0) return null;

  const tipped = matches.filter((m) => m.your_tip).length;
  return (
    <Card flush aria-labelledby="nrl-play-round">
      <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-5", CARD_X)}>
        <h2 id="nrl-play-round" className="text-h2 font-semibold text-ink">
          Round {round}
        </h2>
        <span className="text-notes text-muted">
          {tipped} of {matches.length} tipped{handle ? ` · Playing as ${handle}` : ""}
        </span>
      </div>
      {matches.map((m) => (
        <PlayRow
          key={m.id}
          match={m}
          now={now}
          showConfidence={showConfidence}
          pending={!!pending[m.id]}
          error={rowError[m.id]}
          marginDraft={marginDraft[m.id]}
          onPick={(pick) => submit(m.id, pick)}
          onMarginChange={(v) => setMarginDraft((d) => ({ ...d, [m.id]: v }))}
          onMarginCommit={(pick, margin) => submit(m.id, pick, margin)}
        />
      ))}
    </Card>
  );
}

function PlayRow({
  match,
  now,
  showConfidence,
  pending,
  error,
  marginDraft,
  onPick,
  onMarginChange,
  onMarginCommit,
}: {
  match: NrlMyTipsMatch;
  now: Date;
  showConfidence: boolean;
  pending: boolean;
  error?: string;
  marginDraft?: string;
  onPick: (pick: Pick) => void;
  onMarginChange: (value: string) => void;
  onMarginCommit: (pick: Pick, margin: number) => void;
}) {
  const locked = match.kickoff_utc != null && now.getTime() >= new Date(match.kickoff_utc).getTime();
  const tip = match.your_tip;
  // The reveal rule (lib/reveal.ts): the model's call on this match only once
  // it is tipped or has kicked off -- whatever /tips/mine sends.
  const model = visibleModel(match, now);
  const home = match.home ?? "TBC";
  const away = match.away ?? "TBC";

  return (
    <div className={cn("border-t border-line-soft py-5", CARD_X)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-notes font-medium text-muted">{locked ? "Locked" : kickoffLabel(match.kickoff_utc)}</span>
        {match.is_featured ? <Tag>Featured match — margin for tiebreaks</Tag> : null}
      </div>

      {locked ? (
        <div className="mt-3 flex flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            <ClubBadge name={match.home} size={22} decorative />
            {home} v {away}
            <ClubBadge name={match.away} size={22} decorative />
          </p>
          <p className="text-notes">
            {tip ? (
              <>
                You picked <strong className="text-brand">{pickLabel(tip.pick, match)}</strong>
                {tip.points != null ? (
                  <span className={tip.points > 0 ? "text-brand" : "text-miss"}>
                    {" "}
                    — {tip.points > 0 ? "scored" : "missed"}
                  </span>
                ) : (
                  <span className="text-muted"> — awaiting full time</span>
                )}
              </>
            ) : (
              <span className="text-muted">No tip submitted</span>
            )}
          </p>
        </div>
      ) : (
        <>
          <div
            className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2"
            role="group"
            aria-label={`Your pick for ${match.home ?? "home"} vs ${match.away ?? "away"}`}
          >
            {(["home", "draw", "away"] as const).map((side) => {
              const label = side === "home" ? home : side === "away" ? away : "Draw";
              const active = tip?.pick === side;
              const crestName = side === "home" ? match.home : side === "away" ? match.away : null;
              return (
                <button
                  key={side}
                  type="button"
                  aria-pressed={active}
                  disabled={pending}
                  onClick={() => onPick(side)}
                  className={cn(
                    "inline-flex min-h-[48px] min-w-0 items-center justify-center gap-2 rounded-full border px-3 font-semibold transition-colors disabled:cursor-not-allowed",
                    side === "draw" && "px-4 text-notes",
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-ground text-ink hover:border-ink",
                  )}
                >
                  {crestName ? <ClubBadge name={crestName} size={22} decorative /> : null}
                  <span className="min-w-0 truncate">{label}</span>
                </button>
              );
            })}
          </div>

          {match.is_featured ? (
            <label className="mt-3 flex items-center justify-between gap-3 text-notes text-muted">
              <span>Margin guess (points)</span>
              <input
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                disabled={!tip?.pick || pending}
                value={marginDraft ?? tip?.margin ?? ""}
                onChange={(e) => onMarginChange(e.target.value)}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (tip?.pick && e.target.value !== "" && Number.isFinite(n)) onMarginCommit(tip.pick, n);
                }}
                className="h-11 w-20 rounded-input border border-line-strong bg-ground px-3 text-right text-ink disabled:bg-soft"
              />
            </label>
          ) : null}
        </>
      )}

      {/* The model's call, after the reveal. The Play hub (showConfidence)
          rings it by confidence; /nrl/tips prints it as one quiet line. */}
      {model ? (
        showConfidence ? (
          <div className="fw-rise mt-3 flex items-center justify-between gap-3 border-t border-line-soft pt-3">
            <div className="min-w-0">
              <p className="text-label font-medium text-muted">Model&apos;s call</p>
              <p className="truncate font-semibold">{pickLabel(model.pick, match)}</p>
            </div>
            <ConfidenceRing
              probability={model.pick_confidence}
              confidence={confidenceTier(model.pick_confidence)}
              outcomeLabel={pickLabel(model.pick, match)}
              size={56}
            />
          </div>
        ) : (
          <p className="fw-rise mt-3 text-notes text-muted">
            Model {pickLabel(model.pick, match)}{" "}
            <b className="font-bold text-ink">{Math.round(model.pick_confidence * 100)}%</b>
          </p>
        )
      ) : null}

      {error ? <p className="mt-2 text-notes font-medium text-miss">{error}</p> : null}
    </div>
  );
}
