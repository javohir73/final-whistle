"use client";

/** The premium advanced-markets panel (Phase A of the premium spec): correct-
 *  score grid, totals, BTTS, Asian handicap — the same frozen numbers the B2B
 *  /v1/markets surface serves. Free/anon users see a blurred teaser (static
 *  sample data, no fetch) via PremiumGate; the backend independently enforces
 *  the entitlement (403 premium_required), so this stays presentation-only
 *  and simple. A fetch failure or missing data collapses quietly — never a
 *  half-rendered card. */
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PremiumGate } from "@/components/PremiumGate";
import { getPremiumMarkets, type PremiumMarkets as Payload } from "@/lib/session";
import { pct, formatScore } from "@/lib/format";

const TEASER_DISCLAIMER = "Not betting advice.";

// Static sample numbers for the blurred teaser — never fetched, so a free/anon
// visitor never hits the entitled endpoint.
const TEASER: Payload["markets"] = {
  one_x_two: { home_win: 0.52, draw: 0.26, away_win: 0.22 },
  totals: [{ line: 2.5, over: 0.57, under: 0.43 }],
  btts: { yes: 0.48, no: 0.52 },
  correct_score: [
    { home: 2, away: 1, prob: 0.11 },
    { home: 1, away: 1, prob: 0.1 },
    { home: 1, away: 0, prob: 0.1 },
  ],
  asian_handicap: [{ line: -0.5, home: 0.52, push: 0, away: 0.48 }],
};

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
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Correct score
        </p>
        <ul className="grid grid-cols-3 gap-2">
          {topScores.map((cs) => (
            <li
              key={`${cs.home}-${cs.away}`}
              className="rounded-2xl bg-win/[0.06] px-2 py-3 text-center"
            >
              <p className="font-display text-lg font-extrabold tabular-nums text-lime-deep">
                {formatScore(cs.home, cs.away)}
              </p>
              <p className="mt-0.5 text-label font-semibold text-muted">{pct(cs.prob)}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Over/under
        </p>
        <ul className="space-y-1.5">
          {markets.totals.map((t) => (
            <li key={t.line} className="flex items-center justify-between text-sm">
              <span className="text-muted">{t.line} goals</span>
              <span className="font-display font-bold tabular-nums text-lime-deep">
                Over {pct(t.over)} · Under {pct(t.under)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Both teams to score
        </p>
        <p className="text-sm">
          <span className="font-display font-bold tabular-nums text-lime-deep">
            Yes {pct(markets.btts.yes)}
          </span>
          <span className="text-muted"> · </span>
          <span className="font-display font-bold tabular-nums text-lime-deep">
            No {pct(markets.btts.no)}
          </span>
        </p>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Asian handicap
        </p>
        <ul className="space-y-1.5">
          {markets.asian_handicap.map((h) => (
            <li key={h.line} className="flex items-center justify-between text-sm">
              <span className="text-muted">
                {home} {h.line > 0 ? `+${h.line}` : h.line}
              </span>
              <span className="font-display font-bold tabular-nums text-lime-deep">
                {pct(h.home)} · push {pct(h.push)} · {away} {pct(h.away)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs leading-relaxed text-muted">{disclaimer}</p>
    </div>
  );
}

export function PremiumMarkets({
  matchId,
  home,
  away,
}: {
  matchId: number;
  home: string;
  away: string;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user?.premium) return;
    let alive = true;
    getPremiumMarkets(matchId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [matchId, user?.premium]);

  if (user?.premium) {
    if (failed || !data) return null; // loading or unavailable: collapse quietly
    return (
      <section className="glass rounded-2xl p-6">
        <h2 className="mb-4 font-display text-lg font-bold text-foreground">
          Full match markets
        </h2>
        <MarketsBody
          home={home}
          away={away}
          markets={data.markets}
          disclaimer={data.disclaimer}
        />
      </section>
    );
  }

  return (
    <PremiumGate
      teaser={
        <MarketsBody home={home} away={away} markets={TEASER} disclaimer={TEASER_DISCLAIMER} />
      }
    >
      {null}
    </PremiumGate>
  );
}
