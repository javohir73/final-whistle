import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getNrlLadderServer, getNrlMatchDetailServer, getNrlRoundServer,
} from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { pct } from "@/lib/format";
import { ClubBadge } from "@/components/ClubBadge";
import { WhyCard } from "@/components/match/MatchCards";
import { BackLink, Card, CardHead, ClubCell, Note, Table, TableScroll, Td, TextLink, Th } from "@/components/ui";
import { NrlMatchTipGate } from "@/components/nrl/NrlMatchTipGate";
import { NrlModelCallCard } from "@/components/nrl/NrlModelCallCard";
import { signedNumber } from "@/lib/nrlDisplay";
import { canRevealModelPublicly } from "@/lib/reveal";
import { LiveMatchProvider } from "./LiveMatchProvider";
import { NrlMatchHero } from "./NrlMatchHero";
import type { NrlFactor, NrlMatch, NrlMatchDetail } from "@/lib/types";

export const revalidate = 300;

/** NRL match detail: /nrl/match/{season}/{round}/{match_no} -- the triple is
 *  the match identity (sports.py keys matches on it; the page reads the round
 *  payload and picks its match out).
 *
 *  Calm, like the football match page: the hero (crests, score or kick-off,
 *  try scorers), one "The model's call" card, a short "Why the model thinks
 *  so" list when the API gives reasons, and one card of match facts.
 *
 *  The reveal rule: until the match is past the point of tipping, NOTHING the
 *  server renders or serialises carries the model's call -- the prediction is
 *  stripped from the match row, the detail payload is not fetched at all, and
 *  the model card is the client tip gate (it reads the viewer's tip, and only
 *  then the model's call, from /tips/mine). */

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
): Promise<{ match: NrlMatch } | null> {
  const data = await getNrlRoundServer(season, round);
  const match = data?.rounds.flatMap((r) => r.matches).find((m) => m.match_no === no) ?? null;
  return match ? { match } : null;
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
  const revealed = modelIsPublic(found.match, new Date());
  const hadPrediction = found.match.prediction != null;
  // Open match: the prediction never leaves the server.
  const match: NrlMatch = revealed ? found.match : { ...found.match, prediction: null };

  // The detail payload only adds the model's reasons and a promoted
  // scoreline, both part of the model's call -- so it is only fetched once
  // the call is public. (Form, head-to-head, the scoring breakdown and the
  // live win-chance card were cut from the calm page.)
  const detail: NrlMatchDetail | null = revealed
    ? await getNrlMatchDetailServer(match.id).catch(() => null)
    : null;

  const home = match.home ?? "TBC";
  const away = match.away ?? "TBC";
  const p = match.prediction;
  const roundLabel = `Round ${ids.round}`;
  const reasons = p && detail ? whyReasons(detail.factors, home, away) : [];
  const clubRows = (ladder?.rows ?? [])
    .filter((r) => r.name === match.home || r.name === match.away)
    .sort((a, b) => a.rank - b.rank);

  return (
    <LiveMatchProvider match={match}>
      <div className="flex flex-col gap-6">
        <div className="-mt-2">
          <BackLink href={`/nrl/round/${ids.round}`}>{roundLabel}</BackLink>
        </div>

        <NrlMatchHero match={match} home={home} away={away} roundLabel={roundLabel} />

        {revealed ? (
          p ? (
            <NrlModelCallCard
              match={match}
              home={home}
              away={away}
              season={ids.season}
              round={ids.round}
              detailPrediction={detail?.prediction ?? null}
            />
          ) : (
            <Card pad aria-labelledby="nrl-no-call">
              <CardHead id="nrl-no-call" title="No call from the model" />
              <Note className="mt-1.5">The model did not publish a call on this match before kick-off.</Note>
            </Card>
          )
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

        {reasons.length > 0 ? <WhyCard reasons={reasons} /> : null}

        {/* The one card of match facts: where the two clubs stand. */}
        {clubRows.length > 0 && (
          <Card pad aria-labelledby="nrl-where-they-stand">
            <CardHead id="nrl-where-they-stand" title="Where they stand" />
            <TableScroll className="mt-2.5">
              <Table>
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
                          crest={<ClubBadge name={r.name} size={26} decorative />}
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
            </TableScroll>
            <p className="mt-4">
              <TextLink href="/nrl/ladder">Full ladder</TextLink>
            </p>
          </Card>
        )}
      </div>
    </LiveMatchProvider>
  );
}

/** "Why the model thinks so", in words, from the API's own factors (largest
 *  first): "Elo rating gap favours Roosters". */
function whyReasons(factors: NrlFactor[], home: string, away: string): string[] {
  return [...factors]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => `${f.label} favours ${f.favors === "home" ? home : away}`);
}
