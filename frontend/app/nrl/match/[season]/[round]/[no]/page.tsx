import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getNrlLadderServer, getNrlMatchDetailServer, getNrlRoundServer,
} from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { pct } from "@/lib/format";
import { ClubBadge } from "@/components/ClubBadge";
import { ShareButton } from "@/components/ShareButton";
import { BackLink, Card, CardHead, ClubCell, Note, Table, Td, TextLink, Th } from "@/components/ui";
import { NrlMatchTipGate } from "@/components/nrl/NrlMatchTipGate";
import { signedNumber } from "@/lib/nrlDisplay";
import { canRevealModelPublicly } from "@/lib/reveal";
import { LiveMatchProvider } from "./LiveMatchProvider";
import { MatchIntelClient } from "./MatchIntelClient";
import { NrlMatchHero } from "./NrlMatchHero";
import type { NrlMatch, NrlMatchDetail } from "@/lib/types";

export const revalidate = 300;

/** NRL match detail: /nrl/match/{season}/{round}/{match_no} -- the triple is
 *  the match identity (sports.py keys matches on it; the page reads the round
 *  payload and picks its match out).
 *
 *  The reveal rule: until the match is past the point of tipping, NOTHING the
 *  server renders or serialises carries the model's call -- the prediction is
 *  stripped from the match row and the detail payload before they reach any
 *  (client) component, the probability history is not fetched, and the model
 *  card is the client tip gate (it reads the viewer's tip, and only then the
 *  model's call, from /tips/mine). */

interface RouteParams {
  season: string;
  round: string;
  no: string;
}

function parseIds(p: RouteParams): { season: number; round: number; no: number } | null {
  const int = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);
  const season = int(p.season);
  const round = int(p.round);
  const no = int(p.no);
  if ([season, round, no].some(Number.isNaN)) return null;
  return { season, round, no };
}

async function loadMatch(
  season: number,
  round: number,
  no: number,
): Promise<{ match: NrlMatch; disclaimer: string } | null> {
  const data = await getNrlRoundServer(season, round);
  const match = data?.rounds.flatMap((r) => r.matches).find((m) => m.match_no === no) ?? null;
  return match && data ? { match, disclaimer: data.disclaimer } : null;
}

/** Past the point of tipping (kicked off, live, finished, cancelled)? Same
 *  rule as every public surface (lib/reveal.ts). */
function modelIsPublic(match: NrlMatch, now: Date): boolean {
  return canRevealModelPublicly("nrl", match.status, match.kickoff_utc, now);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const ids = parseIds(await params);
  if (!ids) return { title: `NRL match — ${APP_NAME}` };
  const found = await loadMatch(ids.season, ids.round, ids.no).catch(() => null);
  if (!found?.match.home || !found.match.away) {
    return { title: `NRL match — ${APP_NAME}` };
  }
  const { match } = found;
  const p = modelIsPublic(match, new Date()) ? match.prediction : null;
  const open = !modelIsPublic(match, new Date());
  const title = open
    ? `${match.home} v ${match.away} — tip it | ${APP_NAME}`
    : `${match.home} vs ${match.away} — NRL prediction | ${APP_NAME}`;
  const description = open
    ? `NRL round ${ids.round}: ${match.home} v ${match.away}. Tip the winner before kick-off, then see the model's call.`
    : p
    ? `Model prediction for ${match.home} vs ${match.away} (NRL round ${ids.round}): ` +
      `${match.home} ${pct(p.p_home)}, draw ${pct(p.p_draw)}, ${match.away} ${pct(p.p_away)}.`
    : `NRL round ${ids.round}: ${match.home} vs ${match.away} — Model prediction, kickoff and ladder context.`;
  return {
    title,
    description,
    alternates: { canonical: `/nrl/match/${ids.season}/${ids.round}/${ids.no}` },
    openGraph: { title, description },
  };
}

export default async function NrlMatchDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const ids = parseIds(await params);
  if (!ids) notFound();
  const [found, ladder] = await Promise.all([
    loadMatch(ids.season, ids.round, ids.no),
    // Ladder context is secondary — a hiccup must not take down the page.
    getNrlLadderServer().catch(() => null),
  ]);
  if (!found) notFound();
  const { disclaimer } = found;
  const revealed = modelIsPublic(found.match, new Date());
  const hadPrediction = found.match.prediction != null;
  // Open match: the prediction never leaves the server.
  const match: NrlMatch = revealed ? found.match : { ...found.match, prediction: null };

  // Match intelligence is additive — a hiccup must not take down the page.
  // (The probability-history sparkline was cut from the redesign, so that
  // endpoint is no longer fetched.)
  const rawDetail = await getNrlMatchDetailServer(match.id).catch(() => null);
  const detail: NrlMatchDetail | null = rawDetail
    ? revealed
      ? rawDetail
      : { ...rawDetail, prediction: null, factors: [] }
    : null;

  const home = match.home ?? "TBC";
  const away = match.away ?? "TBC";
  const p = match.prediction;
  const clubRows = (ladder?.rows ?? []).filter((r) => r.name === match.home || r.name === match.away);
  const roundLabel = `Round ${ids.round}`;

  return (
    <LiveMatchProvider match={match}>
      <div className="flex flex-col gap-6">
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
          <BackLink href={`/nrl/round/${ids.round}`}>{roundLabel}</BackLink>
          <ShareButton title={`${home} v ${away} — NRL ${roundLabel}`} />
        </div>

        <NrlMatchHero match={match} home={home} away={away} roundLabel={roundLabel} />

        {revealed ? (
          !p && match.status !== "finished" ? (
            <Card pad>
              <CardHead title="No call from the model" />
              <Note className="mt-2">The model did not publish a call on this match before kick-off.</Note>
            </Card>
          ) : null
        ) : (
          <NrlMatchTipGate
            season={ids.season}
            round={ids.round}
            matchId={match.id}
            home={home}
            away={away}
            hasPrediction={hadPrediction}
          />
        )}

        {detail && <MatchIntelClient detail={detail} probHistory={null} revealed={revealed} />}

        {/* Season context: the two clubs' ladder rows. */}
        {clubRows.length > 0 && (
          <Card pad aria-labelledby="nrl-season-so-far">
            <CardHead
              id="nrl-season-so-far"
              title="Season so far"
              action={<TextLink href="/nrl/ladder">Full ladder</TextLink>}
            />
            <Table className="mt-2">
              <thead>
                <tr>
                  <Th align="left">
                    <span className="sr-only">Position</span>
                  </Th>
                  <Th align="left">Club</Th>
                  <Th>W–L</Th>
                  <Th>Diff</Th>
                  <Th>Pts</Th>
                </tr>
              </thead>
              <tbody>
                {clubRows.map((r) => (
                  <tr key={r.team_id}>
                    <Td pos>{r.rank}</Td>
                    <Td align="left" className="whitespace-normal">
                      <ClubCell
                        href={`/nrl/team/${r.team_id}`}
                        crest={<ClubBadge name={r.name} size={22} decorative />}
                        name={r.name}
                      />
                    </Td>
                    <Td>
                      {r.wins}–{r.losses}
                    </Td>
                    <Td>{signedNumber(r.diff)}</Td>
                    <Td pts>{r.points}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        <p className="text-label text-muted">
          {p ? <>Prediction frozen at kickoff · graded after full time · model {p.model_version} · </> : null}
          {disclaimer}
        </p>
      </div>
    </LiveMatchProvider>
  );
}
