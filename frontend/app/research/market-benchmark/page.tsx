/** EXPERIMENTAL / SHADOW — venue market benchmark research page.
 *
 *  Renders the operator-generated research artifact verbatim: sample sizes,
 *  capture window, coverage, exclusions, uncertainty, and explicit
 *  not-enough-data states. Nothing here feeds serving, and nothing here may
 *  claim improvement without holdout evidence — a NOT_READY group renders as
 *  exactly that.
 */
import { getMarketBenchmarkServer } from "@/lib/api";
import type { MarketBenchmarkGroup } from "@/lib/types";
import { Card, CardHead, Note, PageHead, Table, TableScroll, Td, Th } from "@/components/ui";

const DETAILS = "rounded-card border border-line bg-ground px-5 py-4 [&>summary]:min-h-[44px] [&>summary]:cursor-pointer [&>summary]:py-2.5 [&>summary]:font-semibold [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ul]:text-notes [&_h3]:mt-3 [&_h3]:font-semibold";

export const metadata = {
  title: "Market benchmark (experimental) — FinalWhistle research",
  robots: { index: false },
};

function Group({ group }: { group: MarketBenchmarkGroup }) {
  if (group.status !== "READY") {
    return (
      <Card pad as="section" data-testid={`group-${group.venue}`}>
        <CardHead title={group.venue} />
        <Note className="mt-2">
          <strong className="font-semibold text-ink">Not enough data:</strong> {group.n_matches} matches (minimum{" "}
          {group.min_matches}). No verdict and no ranking on a sample this
          small.
        </Note>
      </Card>
    );
  }
  const ci = group.delta_ci95_match_clustered;
  return (
    <Card pad as="section" data-testid={`group-${group.venue}`}>
      <CardHead title={group.venue} />
      <Note className="mt-1.5">
        {group.n_matches} holdout matches
        {group.capture_window
          ? ` · kickoffs ${group.capture_window.first_kickoff.slice(0, 10)} → ${group.capture_window.last_kickoff.slice(0, 10)}`
          : null}
      </Note>
      <TableScroll className="mt-3">
        <Table>
          <thead>
            <tr>
              <Th align="left">Series</Th>
              <Th>Log loss</Th>
              <Th>Brier</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td align="left">Model</Td>
              <Td>{group.model?.log_loss}</Td>
              <Td>{group.model?.brier}</Td>
            </tr>
            <tr>
              <Td align="left">Venue (vig-normalized)</Td>
              <Td>{group.venue_normalized?.log_loss}</Td>
              <Td>{group.venue_normalized?.brier}</Td>
            </tr>
            <tr>
              <Td align="left">Baseline (uniform)</Td>
              <Td>{group.baseline_uniform?.log_loss}</Td>
              <Td>{group.baseline_uniform?.brier}</Td>
            </tr>
          </tbody>
        </Table>
      </TableScroll>
      <Note className="mt-3">
        Δ log loss (model − venue): {group.delta_log_loss_model_minus_venue}
        {ci ? ` · 95% CI [${ci[0]}, ${ci[1]}] (match-clustered)` : " · CI unavailable"}
        {" · "}verdict: {group.verdict}
      </Note>
    </Card>
  );
}

export default async function MarketBenchmarkPage() {
  let data;
  try {
    data = await getMarketBenchmarkServer();
  } catch {
    data = null;
  }

  return (
    <div>
      <PageHead
        eyebrow="FinalWhistle research"
        title="Venue market benchmark"
        sub="How the model's probabilities compare with prediction-market prices on the same matches."
      />
      <div className="flex max-w-[900px] flex-col gap-6">
      <p className="rounded-card border border-line bg-soft px-5 py-4 font-semibold text-ink">
        EXPERIMENTAL / SHADOW — research data only. Nothing on this page feeds
        predictions, and readiness here is never a deployment switch.
      </p>

      {/* `no_data` is the ONLY state that may claim emptiness, so it is
          matched first and by name. Everything else that is not a complete
          success — a fault, a poisoned artifact, an unreachable API, or an
          `ok` carrying no artifact — is a fault on our side. Ordering it this
          way means a status we have never seen fails toward "something is
          wrong" rather than toward "there is nothing here". */}
      {data && data.status === "no_data" ? (
        <p data-testid="no-data" className="max-w-prose text-muted">
          No benchmark data yet. An operator generates this artifact with{" "}
          <code>pipeline.run_market_benchmark_report</code>; until then there is
          nothing to show — and nothing is claimed.
        </p>
      ) : !data || data.status !== "ok" || !data.artifact ? (
        <p data-testid="unavailable" className="max-w-prose text-muted">
          This benchmark cannot be read right now. That is a fault on our side
          — <strong>not</strong> a statement that no data exists. Whatever was
          published last is still published; this page just could not reach or
          parse it, so nothing is shown rather than something wrong.
        </p>
      ) : (
        <>
          <Note>
            Generated {data.artifact.generated_at} · eligible observations:{" "}
            {data.artifact.coverage.eligible_observations ?? 0} · holdout
            matches: {data.artifact.benchmark.split?.holdout_matches ?? 0}
          </Note>
          {Object.keys(data.artifact.exclusions).length > 0 ? (
            <details className={DETAILS}>
              <summary>
                Exclusions (
                {Object.values(data.artifact.exclusions).reduce((a, b) => a + b, 0)}
                {" "}fixture groups)
              </summary>
              <ul>
                {Object.entries(data.artifact.exclusions).map(([reason, count]) => (
                  <li key={reason}>
                    {reason}: {count}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {data.artifact.benchmark.groups.length === 0 ? (
            <p data-testid="no-groups" className="max-w-prose text-muted">
              No eligible (venue, match) groups yet — capture and resolution
              have not produced scoreable data.
            </p>
          ) : (
            data.artifact.benchmark.groups.map((group) => (
              <Group key={group.venue} group={group} />
            ))
          )}
          {data.artifact.health?.venues ? (
            <details className={DETAILS}>
              <summary>Mapping & quote coverage</summary>
              {Object.entries(data.artifact.health.venues).map(([venue, health]) => (
                <div key={venue} data-testid={`health-${venue}`}>
                  <h3>{venue}</h3>
                  <ul>
                    <li>
                      markets: {health.markets_total} · mapping:{" "}
                      {Object.entries(health.mapping)
                        .map(([status, count]) => `${status} ${count}`)
                        .join(", ")}
                    </li>
                    <li>
                      fixtures with complete 1X2: {health.fixtures_with_complete_1x2}{" "}
                      of {health.mapped_fixtures} mapped
                      {health.fixtures_incomplete_1x2.length > 0
                        ? ` · incomplete: ${health.fixtures_incomplete_1x2.join(", ")}`
                        : null}
                    </li>
                    <li>
                      fixtures missing a pre-match quote:{" "}
                      {health.fixtures_missing_prematch_quote.length}
                    </li>
                    {Object.entries(health.quote_freshness_by_transport).map(
                      ([transport, freshness]) => (
                        <li key={transport}>
                          last {transport} quote:{" "}
                          {Math.round(freshness.age_seconds / 60)} min ago
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </details>
          ) : null}
          {data.artifact.health?.heartbeat_freshness_by_venue_worker ? (
            <details className={DETAILS}>
              <summary>Capture freshness</summary>
              <ul>
                {Object.entries(
                  data.artifact.health.heartbeat_freshness_by_venue_worker,
                ).map(([key, value]) => (
                  <li key={key}>
                    {key}: last cycle {value.last_completed_at} (
                    {Math.round(value.age_seconds / 60)} min ago)
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}
