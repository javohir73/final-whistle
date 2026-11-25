"use client";

/** The match markets panel: correct-score grid, totals, BTTS, Asian handicap,
 *  the same frozen numbers the B2B /v1/markets surface serves. Free for every
 *  visitor; the caller decides when a fixture may show it (MatchView's
 *  `showDetail`). A fetch failure or missing data collapses quietly, never a
 *  half-rendered card. */
import { useEffect, useState } from "react";
import { getMatchMarkets, type MatchMarketsPayload as Payload } from "@/lib/session";
import { pct, formatScore } from "@/lib/format";
import { Card, CardHead } from "@/components/ui";

function MarketsBody({
  home,
  away,
  markets,
  disclaimer,
}: {
  home: string;
  away: string;
  markets: Payload["markets"];
  disclaimer: string;
}) {
  const topScores = [...markets.correct_score].sort((a, b) => b.prob - a.prob).slice(0, 6);
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Correct score
        </p>
        <ul className="grid grid-cols-3 gap-2">
          {topScores.map((cs) => (
            <li
              key={`${cs.home}-${cs.away}`}
              className="rounded-input bg-soft px-2 py-3 text-center"
            >
              <p className="text-h2 font-semibold tabular-nums text-ink">
                {formatScore(cs.home, cs.away)}
              </p>
              <p className="mt-0.5 text-label font-medium text-muted">{pct(cs.prob)}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Over/under
        </p>
        <ul className="space-y-0">
          {markets.totals.map((t) => (
            <li key={t.line} className="flex items-center justify-between gap-3 border-t border-line-soft py-2 text-table first:border-t-0">
              <span className="text-muted">{t.line} goals</span>
              <span className="text-right font-semibold tabular-nums text-ink">
                Over {pct(t.over)} · Under {pct(t.under)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Both teams to score
        </p>
        <p className="text-table">
          <span className="text-right font-semibold tabular-nums text-ink">
            Yes {pct(markets.btts.yes)}
          </span>
          <span className="text-muted"> · </span>
          <span className="text-right font-semibold tabular-nums text-ink">
            No {pct(markets.btts.no)}
          </span>
        </p>
      </div>
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Asian handicap
        </p>
        <ul className="space-y-0">
          {markets.asian_handicap.map((h) => (
            <li key={h.line} className="flex items-center justify-between gap-3 border-t border-line-soft py-2 text-table first:border-t-0">
              <span className="text-muted">
                {home} {h.line > 0 ? `+${h.line}` : h.line}
              </span>
              <span className="text-right font-semibold tabular-nums text-ink">
                {pct(h.home)} · push {pct(h.push)} · {away} {pct(h.away)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-notes text-muted">{disclaimer}</p>
    </div>
  );
}

export function MatchMarkets({
  matchId,
  home,
  away,
}: {
  matchId: number;
  home: string;
  away: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // State belongs to one fixture only. Clear a previous success/failure as
    // soon as the route reuses this component for another match so stale
    // numbers never flash while the new request is in flight.
    setData(null);
    setFailed(false);
    let alive = true;
    getMatchMarkets(matchId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [matchId]);

  if (failed || !data) return null; // loading or unavailable: collapse quietly
  return (
    <Card pad>
      <CardHead title="Full match markets" className="mb-4" />
      <MarketsBody
        home={home}
        away={away}
        markets={data.markets}
        disclaimer={data.disclaimer}
      />
    </Card>
  );
}
