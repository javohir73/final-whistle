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
import { BILLING_ENABLED } from "@/lib/constants";
import { getPremiumMarkets, type PremiumMarkets as Payload } from "@/lib/session";
import { pct, formatScore } from "@/lib/format";
import type { CompetitionId } from "@/lib/sports";
import { Card, CardHead } from "@/components/ui";

const TEASER_DISCLAIMER = "Not betting advice.";

/** A redacted bar standing in for a withheld number. Deliberately not a digit:
 *  see MarketsTeaser. */
function Redacted({ w = "3rem" }: { w?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-[0.7em] rounded-full bg-current align-middle opacity-30"
      style={{ width: w }}
    />
  );
}

/** The free/anon placeholder: the SHAPE of the premium panel with no values in
 *  it.
 *
 *  This used to render a hardcoded sample (Over 2.5 = 57%, BTTS = 48%, a 2-1
 *  scoreline at 11%) behind a blur. Two problems, both real:
 *
 *  1. Those digits were serialized into the DOM of every anonymous match page.
 *     A blur is a visual effect — "view source", a screen reader that ignores
 *     aria-hidden, a scraper, or Reader Mode all get the numbers regardless. A
 *     gate you can defeat with devtools is not a gate.
 *  2. They contradicted the page. The public Goals section, a few hundred
 *     pixels above, showed the REAL Over 2.5 and BTTS for that fixture. A
 *     visitor comparing the two saw 53% and 57% for the same quantity — which
 *     reads as the model being unreliable rather than as a marketing panel.
 *
 *  Withholding the numbers entirely fixes both: nothing gated ships to an
 *  unauthorized client, and there is nothing left that can disagree with the
 *  public section. The layout still communicates what the tier buys. */
function MarketsTeaser({ home, away }: { home: string; away: string }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Correct score
        </p>
        <ul className="grid grid-cols-3 gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="rounded-input bg-soft px-2 py-3 text-center">
              <p className="text-h2 font-semibold text-ink">
                <Redacted w="2.2rem" />
              </p>
              <p className="mt-0.5 text-label font-medium text-muted">
                <Redacted w="1.6rem" />
              </p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Over/under
        </p>
        <ul className="space-y-0">
          {["0.5", "1.5", "2.5", "3.5", "4.5"].map((line) => (
            <li key={line} className="flex items-center justify-between gap-3 border-t border-line-soft py-2 text-table first:border-t-0">
              {/* The LINES are the product description, not the prediction —
                  every match is priced at the same ladder. Only the
                  probabilities are withheld. */}
              <span className="text-muted">{line} goals</span>
              <span className="text-line-strong">
                <Redacted w="5.5rem" />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Both teams to score
        </p>
        <p className="text-table text-line-strong">
          <Redacted w="7rem" />
        </p>
      </div>
      <div>
        <p className="mb-2 text-notes font-medium text-muted">
          Asian handicap
        </p>
        <ul className="space-y-0">
          {["-1.0", "-0.5", "0.0", "+0.5", "+1.0"].map((line) => (
            <li key={line} className="flex items-center justify-between gap-3 border-t border-line-soft py-2 text-table first:border-t-0">
              <span className="text-muted">
                {home} {line}
              </span>
              <span className="text-line-strong">
                <Redacted w="6rem" />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-notes text-muted">
        Probabilities for {home} v {away} are available to members.{" "}
        {TEASER_DISCLAIMER}
      </p>
    </div>
  );
}

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

export function PremiumMarkets({
  matchId,
  home,
  away,
  competition,
  returnTo,
}: {
  matchId: number;
  home: string;
  away: string;
  competition?: CompetitionId;
  returnTo?: string;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // State belongs to one fixture only. Clear a previous success/failure as
    // soon as the route reuses this component for another match so stale
    // numbers never flash while the new request is in flight.
    setData(null);
    setFailed(false);
    // Billing off must behave exactly as if Premium never existed — even for
    // a session with a server-set premium:true (e.g. the flag gets flipped
    // off after subscriptions already exist). Never fire the entitled fetch
    // in that case.
    if (!BILLING_ENABLED || !user?.premium) return;
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

  // Billing off ⇒ nothing, full stop — even for an existing premium session.
  // PremiumGate enforces this same rule for the free/anon teaser path below,
  // but the premium branch returns before ever reaching PremiumGate, so it
  // needs its own check here too.
  if (!BILLING_ENABLED) return null;

  if (user?.premium) {
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

  return (
    <PremiumGate
      teaser={<MarketsTeaser home={home} away={away} />}
      competition={competition}
      returnTo={returnTo}
    >
      {null}
    </PremiumGate>
  );
}
