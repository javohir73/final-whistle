import type { MarketBenchmark } from "@/lib/types";
import { Card, CardHead, Chip, Table, TableScroll, Td, Th } from "@/components/ui";

const fmt = (n: number) => n.toFixed(3);

/** "20 November 2026" from the benchmark's ISO timestamp (UTC, date only);
 *  null when the value is missing or not a date. */
export function benchmarkDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** The model against the market's final pre-kickoff consensus (methodology
 *  page, inside its Prose column). Direction G: a plain card and the shared
 *  table primitives (sentence-case muted headers), brand for the winner. */
export function MarketComparison({ bench }: { bench: MarketBenchmark }) {
  if (bench.status !== "ready" || !bench.model || !bench.market) {
    return (
      <>
        <p>
          Beating naive baselines is the entry bar; the{" "}
          <strong>market&apos;s final pre-kickoff consensus</strong> — the sharpest public forecast there is, with
          its margin removed — is the real one.
        </p>
        <p>
          Every WC26 prediction is logged <strong>pre-kickoff, next to the consensus odds we captured</strong>, so
          the two are scored on exactly the same matches. Results publish here after the first benchmarked match
          day.
        </p>
      </>
    );
  }

  const modelWins = bench.diff_log_loss !== null && bench.diff_log_loss < 0;
  const updated = benchmarkDate(bench.updated_at);
  return (
    <>
      <p>
        The market&apos;s final pre-kickoff consensus we captured — margin removed — is the sharpest public
        forecast there is. Each WC26 prediction is logged pre-kickoff next to those odds, so both are scored on
        exactly the same matches.
      </p>
      <VerdictChip verdict={bench.verdict ?? ""} />
      <Card pad>
        <CardHead as="h3" title="Model vs. market" action={`${bench.n_matches} matches`} />
        <TableScroll className="mt-2">
          <Table>
            <thead>
              <tr>
                <Th align="left">Predictor</Th>
                <Th title="Lower is better">Log-loss</Th>
                <Th title="Lower is better">Brier</Th>
                <Th title="Higher is better">Accuracy</Th>
              </tr>
            </thead>
            <tbody>
              <MetricRow label="FinalWhistle model" m={bench.model} highlight={modelWins} />
              <MetricRow label="Market consensus" m={bench.market} highlight={!modelWins} />
            </tbody>
          </Table>
        </TableScroll>
      </Card>
      {bench.diff_log_loss !== null && bench.diff_ci95 && (
        <p className="text-notes text-muted">
          Paired mean log-loss difference (model − market):{" "}
          <span className="tabular-nums text-ink">
            {bench.diff_log_loss >= 0 ? "+" : ""}
            {bench.diff_log_loss.toFixed(4)}
          </span>{" "}
          (95% CI{" "}
          <span className="tabular-nums text-ink">
            [{bench.diff_ci95[0].toFixed(4)}, {bench.diff_ci95[1].toFixed(4)}]
          </span>
          ). {bench.dataset}.{updated ? ` Updated ${updated}.` : ""}
        </p>
      )}
    </>
  );
}

function MetricRow({
  label,
  m,
  highlight,
}: {
  label: string;
  m: { log_loss: number; brier: number; accuracy: number };
  highlight: boolean;
}) {
  return (
    <tr>
      <Td align="left" className={highlight ? "font-semibold text-brand" : "font-medium"}>
        {label}
      </Td>
      <Td className={highlight ? "font-semibold" : undefined}>{fmt(m.log_loss)}</Td>
      <Td className="text-muted">{fmt(m.brier)}</Td>
      <Td className="text-muted">{Math.round(m.accuracy * 100)}%</Td>
    </tr>
  );
}

function VerdictChip({ verdict }: { verdict: string }) {
  const modelWins = verdict.startsWith("MODEL BEATS MARKET");
  const marketWins = verdict.startsWith("MARKET BEATS MODEL");
  const label = modelWins ? "Model beats market" : marketWins ? "Market beats model" : "No credible difference";
  return (
    <p>
      <Chip tone={modelWins ? "ok" : "neutral"}>{label}</Chip>
    </p>
  );
}
