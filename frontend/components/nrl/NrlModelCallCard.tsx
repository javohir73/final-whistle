import { Card, Chip, Note } from "@/components/ui";
import { wholePct } from "@/lib/nrlDisplay";
import type { NrlMatch, NrlMatchDetailPrediction } from "@/lib/types";
import { NrlYourTipLine } from "./NrlYourTipLine";

/** "The model's call" on an NRL match that is past the point of tipping (the
 *  football match page's card, NRL words): the side the model picked and how
 *  sure it was, then -- in plain words -- the margin it expected and, once
 *  finished, how the call went. ONLY render this when the reveal rule allows
 *  it (the page decides: kicked off, live, finished or cancelled). */
export function NrlModelCallCard({
  match,
  home,
  away,
  season,
  round,
  detailPrediction,
}: {
  match: NrlMatch;
  home: string;
  away: string;
  season: number;
  round: number;
  /** The detail endpoint's prediction, for a promoted scoreline (optional). */
  detailPrediction?: NrlMatchDetailPrediction | null;
}) {
  const p = match.prediction;
  if (!p) return null;
  const level = p.p_home === p.p_away;
  const homeFav = p.p_home > p.p_away;
  const team = level ? null : homeFav ? home : away;
  const prob = Math.max(p.p_home, p.p_away);
  const sh = match.score_home;
  const sa = match.score_away;
  const finished = match.status === "finished" && sh != null && sa != null;
  const winner = finished ? (sh > sa ? "home" : sa > sh ? "away" : "draw") : null;
  const called = finished && team ? (homeFav ? winner === "home" : winner === "away") : null;

  const margin = p.expected_margin != null && team ? Math.abs(p.expected_margin) : null;
  const marginWords =
    margin != null ? (margin < 1 ? "a very close game" : `a win by about ${Math.round(margin)} points`) : null;
  const ps = detailPrediction?.predicted_score ?? null;

  const lines: string[] = [];
  if (team) {
    lines.push(`It picked ${team} at ${wholePct(prob)}${marginWords ? ` and expected ${marginWords}` : ""}.`);
  } else {
    lines.push("It rated the two sides dead level.");
  }
  if (ps) lines.push(`Its predicted score was ${home} ${ps.home}–${ps.away} ${away}.`);
  if (finished) {
    const result = `${sh}–${sa}`;
    if (winner === "draw") lines.push(`The match was drawn ${result}.`);
    else {
      const won = winner === "home" ? home : away;
      lines.push(
        called
          ? `${won} won ${winner === "home" ? result : `${sa}–${sh}`}, so the call was right.`
          : `${won} won ${winner === "home" ? result : `${sa}–${sh}`}, an upset the model did not see.`,
      );
    }
  }

  return (
    <Card pad id="forecast" aria-labelledby="nrl-call-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div>
          <h2 id="nrl-call-heading" className="text-h2 font-semibold text-ink">
            The model’s call
          </h2>
          <Note className="mt-1.5">Made before kick-off.</Note>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {called != null ? <Chip tone={called ? "ok" : "miss"}>{called ? "Called it" : "Missed"}</Chip> : null}
          {team ? (
            <span className="inline-flex items-baseline gap-3">
              <span className="text-h2 font-semibold text-ink">{team}</span>
              <span className="text-stat font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
                {wholePct(prob)}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-4 max-w-prose text-ink">{lines.join(" ")}</p>
      <NrlYourTipLine season={season} round={round} matchId={match.id} home={home} away={away} winner={winner} />
    </Card>
  );
}
