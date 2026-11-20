import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLeagueTipsShareServer } from "@/lib/api";
import { leagueLabel } from "@/lib/leagueConfig";
import { APP_NAME } from "@/lib/constants";
import { isCompetitionId } from "@/lib/sports";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { Button, Card, Note } from "@/components/ui";

// Matches getLeagueTipsShareServer's fetch revalidate (lib/api.ts) -- kept
// short so a pre-grading 404 (see that comment) can't pin the route render
// itself for the full hour a graded result's own longer-lived data would
// otherwise tolerate.
export const revalidate = 60;

type Params = { league: string; matchweek: string; handle: string };

function parseIntParam(s: string): number | null {
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Public, unfakeable per-matchweek share card (design doc: League Score
 *  Predictions, 2026-07-24) -- league-generic port of /nrl/tips/share. Every
 *  number on this page comes straight from the graded LeagueScorePrediction
 *  rows the leaderboard already trusts (see getLeagueTipsShareServer); there
 *  is no client-supplied score anywhere in this contract. A handle with no
 *  graded prediction that matchweek -- unknown handle, never played it, or
 *  not graded yet -- all notFound() identically (the backend 404s with the
 *  same code/message in every case, by design). */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { league, matchweek: matchweekParam, handle } = await params;
  const matchweek = parseIntParam(matchweekParam);
  if (matchweek == null) return { title: `${leagueLabel(league)} tips result — ${APP_NAME}` };

  const share = await getLeagueTipsShareServer(league, matchweek, handle).catch(() => null);
  if (!share) return { title: `${leagueLabel(league)} tips result — ${APP_NAME}` };

  const title = `${share.handle_display} went ${share.player_points}/${share.player_of} vs the model — ${leagueLabel(league)} Matchweek ${matchweek} | ${APP_NAME}`;
  const description = `${share.handle_display} scored ${share.player_points}/${share.player_of} in ${leagueLabel(league)} Matchweek ${matchweek} — the model scored ${share.model_points}/${share.model_of}. Play against the model at ${APP_NAME}.`;
  return {
    title,
    description,
    alternates: { canonical: `/tips/share/${league}/${matchweek}/${encodeURIComponent(handle)}` },
    openGraph: { title, description },
  };
}

export default async function LeagueTipsShareCardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { league, matchweek: matchweekParam, handle } = await params;
  const matchweek = parseIntParam(matchweekParam);
  if (matchweek == null) notFound();

  const share = await getLeagueTipsShareServer(league, matchweek, handle).catch(() => null);
  if (!share) notFound();

  // Grading runs per finished match, not per whole matchweek, so
  // matchweek_complete can be false for days while player_of/model_of are
  // only what's graded so far -- "so far" keeps the verdict honest about an
  // in-progress matchweek instead of framing it as final.
  const verdict = share.matchweek_complete
    ? share.player_points > share.model_points
      ? `${share.handle_display} beat the model this matchweek`
      : share.player_points < share.model_points
        ? "The model came out on top this matchweek"
        : `${share.handle_display} drew with the model this matchweek`
    : share.player_points > share.model_points
      ? `${share.handle_display} is ahead of the model so far this matchweek`
      : share.player_points < share.model_points
        ? "The model is ahead so far this matchweek"
        : `${share.handle_display} is tied with the model so far this matchweek`;

  const top = Math.max(share.player_points, share.model_points, 1);
  const competition = isCompetitionId(share.league) ? share.league : null;

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-6">
      <Card pad className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          {competition ? <CompetitionLogo competition={competition} size={32} decorative /> : null}
          <p className="text-notes font-medium text-muted">
            {leagueLabel(share.league)} Matchweek {share.matchweek}
          </p>
        </div>
        <h1 className="text-2xl font-semibold leading-snug text-ink">
          {share.handle_display} went {share.player_points}/{share.player_of} — the model went{" "}
          {share.model_points}/{share.model_of}
        </h1>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="break-words text-notes text-muted">{share.handle_display}</div>
            <div className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-brand tabular-nums">
              {share.player_points}
            </div>
          </div>
          <div>
            <div className="text-notes text-muted">The model</div>
            <div className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink tabular-nums">
              {share.model_points}
            </div>
          </div>
        </div>
        <div className="grid gap-1.5" aria-hidden="true">
          <span className="block h-1.5 rounded-[3px] bg-brand" style={{ width: `${(share.player_points / top) * 100}%` }} />
          <span className="block h-1.5 rounded-[3px] bg-ink" style={{ width: `${(share.model_points / top) * 100}%` }} />
        </div>
        <div>
          <p className="font-semibold text-ink">{verdict}</p>
          {!share.matchweek_complete && (
            <Note className="mt-1">Matchweek still in progress — more matches to come.</Note>
          )}
          <Note className="mt-1">Points from finished matches only. Exact score 5, right result 2.</Note>
        </div>
      </Card>

      <p>
        <Button href={`/play?competition=${encodeURIComponent(share.league)}`}>
          Beat the model at the {leagueLabel(share.league)} →
        </Button>
      </p>

      <Note>{share.disclaimer}</Note>
    </div>
  );
}
