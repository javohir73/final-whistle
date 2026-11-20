"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { Card, CardHead, Note, TextLink } from "@/components/ui";
import { getLeagueSeasonLeaderboard, getLeagueTipsSummary, getMyLeagueTips } from "@/lib/leagueTips";
import { pickGameFor } from "@/lib/reveal";
import { COMPETITIONS, competitionLinks, type CompetitionId } from "@/lib/sports";
import { getOrCreateDeviceId } from "@/lib/session";

/** The scoring line, worded as the match page's pick card words it. */
export const SCORING_SHORT = "Exact score 5, right result 2.";

type Loaded = {
  modelPoints: number;
  /** Matchweeks the model has been graded on this season, when the board says. */
  matchweeks: number | null;
  /** The viewer's season points; null until at least one of their picks is graded. */
  yourPoints: number | null;
  /** The viewer has at least one pick in the current matchweek (graded or not). */
  hasPicks: boolean;
  /** The current matchweek, for the "this matchweek" link. */
  currentMatchweek: number | null;
};

type State = { status: "loading" } | { status: "hidden" } | { status: "ready"; data: Loaded };

function isCompetition(id: string): id is CompetitionId {
  return Object.prototype.hasOwnProperty.call(COMPETITIONS, id);
}

/** "You and the model" — season-to-date points, the viewer's beside the
 *  model's, for a football league with a score-pick game. Real values only:
 *  the model's total comes from the season leaderboard's model row, the
 *  viewer's from their device/account summary. Renders nothing when the
 *  competition has no score-pick game or the model's total can't be read. */
export function YouAndModelCard({ competition }: { competition: string }) {
  const { user, loading: authLoading, openSignIn } = useAuth();
  const identityVersion = useTipsIdentityVersion();
  const playable = pickGameFor(competition) === "league_tips" && isCompetition(competition);
  const [state, setState] = useState<State>(playable ? { status: "loading" } : { status: "hidden" });

  useEffect(() => {
    if (!playable) {
      setState({ status: "hidden" });
      return;
    }
    let live = true;
    const deviceId = getOrCreateDeviceId();
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));

    const board = getLeagueSeasonLeaderboard(competition);
    const summary = deviceId ? getLeagueTipsSummary(competition, deviceId).catch(() => null) : Promise.resolve(null);
    const mine = deviceId ? getMyLeagueTips(competition, deviceId).catch(() => null) : Promise.resolve(null);

    Promise.all([board, summary, mine])
      .then(([b, s, m]) => {
        if (!live) return;
        const model = b.entries.find((e) => e.is_model);
        if (!model || !Number.isFinite(model.points)) {
          setState({ status: "hidden" });
          return;
        }
        if (s?.handle) reportViewerHandle(s.handle);
        const graded = s != null && s.matchweeks.length > 0;
        setState({
          status: "ready",
          data: {
            modelPoints: model.points,
            matchweeks: model.matchweeks_played ?? null,
            yourPoints: graded ? s.totals.your_points : null,
            hasPicks: graded || (m?.matches.some((x) => x.your_prediction != null) ?? false),
            currentMatchweek: m?.matchweek ?? null,
          },
        });
      })
      .catch(() => live && setState({ status: "hidden" }));
    return () => {
      live = false;
    };
  }, [competition, playable, identityVersion]);

  if (state.status === "hidden") return null;
  if (state.status === "loading") return <YouAndModelSkeleton />;

  const { modelPoints, matchweeks, yourPoints, hasPicks, currentMatchweek } = state.data;
  const links = competitionLinks(competition as CompetitionId);
  const signedOut = !authLoading && user == null;
  // Signed out and nothing picked on this device: only the model's number.
  const modelOnly = yourPoints == null && !hasPicks && signedOut;
  const scale = Math.max(modelPoints, yourPoints ?? 0, 1);
  const weekHref = currentMatchweek != null ? `${links.home}?mw=${currentMatchweek}` : links.home;

  return (
    <Card pad aria-labelledby="you-and-model-title" data-testid="you-and-model">
      <CardHead id="you-and-model-title" title="You and the model" action="Season to date" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {modelOnly ? null : (
          <div>
            <div className="text-notes text-muted">You</div>
            <div className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-brand tabular-nums">
              {yourPoints ?? "–"}
            </div>
          </div>
        )}
        <div>
          <div className="text-notes text-muted">The model</div>
          <div className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink tabular-nums">
            {modelPoints}
          </div>
        </div>
      </div>
      <div className="my-3.5 grid gap-1.5" aria-hidden="true">
        {yourPoints != null ? (
          <span className="block h-1.5 rounded-[3px] bg-brand" style={{ width: `${(yourPoints / scale) * 100}%` }} />
        ) : null}
        <span className="block h-1.5 rounded-[3px] bg-ink" style={{ width: `${(modelPoints / scale) * 100}%` }} />
      </div>
      <Note>
        {matchweeks != null && matchweeks > 0
          ? `Points after ${matchweeks} matchweek${matchweeks === 1 ? "" : "s"}. ${SCORING_SHORT}`
          : `Points this season. ${SCORING_SHORT}`}
      </Note>
      {modelOnly ? (
        <Note className="mt-3">
          <TextLink onClick={() => openSignIn()} className="min-h-[44px] text-left">
            Sign in to keep your picks across devices
          </TextLink>
        </Note>
      ) : yourPoints == null ? (
        <Note className="mt-3">
          {hasPicks ? "Your points appear after full time." : "Make your first pick this matchweek."}{" "}
          <TextLink href={weekHref}>
            {currentMatchweek != null ? `Matchweek ${currentMatchweek}` : "This matchweek"}
          </TextLink>
        </Note>
      ) : null}
      <p className="mt-3">
        <TextLink href={links.leaderboard}>See the leaderboard</TextLink>
      </p>
    </Card>
  );
}

/** Fixed-height placeholder while the three reads resolve (no layout jump). */
export function YouAndModelSkeleton() {
  return (
    <Card pad aria-busy="true" aria-label="You and the model, loading" data-testid="you-and-model-loading">
      <div className="flex h-[214px] flex-col gap-4">
        <span className="block h-5 w-40 rounded bg-line-soft" />
        <div className="grid grid-cols-2 gap-3">
          <span className="block h-11 w-16 rounded bg-line-soft" />
          <span className="block h-11 w-16 rounded bg-line-soft" />
        </div>
        <span className="block h-1.5 w-full rounded bg-line-soft" />
        <span className="block h-4 w-3/4 rounded bg-line-soft" />
      </div>
    </Card>
  );
}
