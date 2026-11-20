import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, Note } from "@/components/ui";
import { getNrlTipsShareServer } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";

// Matches getNrlTipsShareServer's fetch revalidate (lib/api.ts) -- kept short
// so a pre-grading 404 (see that comment) can't pin the route render itself
// for the full hour a graded result's own longer-lived data would tolerate.
export const revalidate = 60;

type Params = { season: string; round: string; handle: string };

function parseIntParam(s: string): number | null {
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Public, unfakeable per-round share card (design doc: NRL Round Tips,
 *  Slice 2.5) -- every number on this page comes straight from the graded
 *  UserTip rows the leaderboard already trusts (see getNrlTipsShareServer);
 *  there is no client-supplied score anywhere in this contract. A handle
 *  with no graded tip that round -- unknown handle, never played it, or the
 *  round isn't graded yet -- all notFound() identically (see the backend's
 *  tips_share, which 404s with the same code/message in every case). */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { season: seasonParam, round: roundParam, handle } = await params;
  const season = parseIntParam(seasonParam);
  const round = parseIntParam(roundParam);
  if (season == null || round == null) return { title: `NRL tips result — ${APP_NAME}` };

  const share = await getNrlTipsShareServer(season, round, handle).catch(() => null);
  if (!share) return { title: `NRL tips result — ${APP_NAME}` };

  const title = `${share.handle_display} went ${share.player_points}/${share.player_of} vs the model — NRL Round ${round} | ${APP_NAME}`;
  const description = `${share.handle_display} scored ${share.player_points}/${share.player_of} in NRL Round ${round} (${season}) — the model scored ${share.model_points}/${share.model_of}. Play against the model at ${APP_NAME}.`;
  return {
    title,
    description,
    alternates: { canonical: `/nrl/tips/share/${season}/${round}/${encodeURIComponent(handle)}` },
    openGraph: { title, description },
  };
}

export default async function NrlTipsShareCardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { season: seasonParam, round: roundParam, handle } = await params;
  const season = parseIntParam(seasonParam);
  const round = parseIntParam(roundParam);
  if (season == null || round == null) notFound();

  const share = await getNrlTipsShareServer(season, round, handle).catch(() => null);
  if (!share) notFound();

  // Grading runs per finished match, not per whole round (NRL rounds span
  // Thu-Sun), so round_complete can be false for days while player_of/
  // model_of are only what's graded so far -- "so far" keeps the verdict
  // honest about an in-progress round instead of framing it as final.
  const verdict = share.round_complete
    ? share.player_points > share.model_points
      ? `${share.handle_display} beat the model this round`
      : share.player_points < share.model_points
        ? "The model came out on top this round"
        : `${share.handle_display} drew with the model this round`
    : share.player_points > share.model_points
      ? `${share.handle_display} is ahead of the model so far this round`
      : share.player_points < share.model_points
        ? "The model is ahead so far this round"
        : `${share.handle_display} is tied with the model so far this round`;

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <Card pad className="text-center">
        <p className="text-notes font-medium text-muted">
          NRL Round {share.round} · {share.season}
        </p>
        <p className="mt-3 text-2xl font-semibold leading-snug text-ink">
          {share.handle_display} went {share.player_points}/{share.player_of} — the model went{" "}
          {share.model_points}/{share.model_of}
        </p>
        <p className="mt-2 font-semibold text-brand">{verdict}</p>
        {!share.round_complete && <Note className="mt-1">Round still in progress — more matches to come.</Note>}
        {share.margin_note && <Note className="mt-3">{share.margin_note}</Note>}
      </Card>

      <div>
        <Button href="/nrl/tips">Beat the model at the NRL</Button>
      </div>

      <p className="text-label text-muted">{share.disclaimer}</p>
    </div>
  );
}
