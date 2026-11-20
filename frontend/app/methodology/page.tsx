import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
// Lazy: recharts loads after hydration, not on this page's first load.
import { CalibrationChartLazy } from "@/components/CalibrationChartLazy";
import data from "@/lib/methodology-data.json";
import { getMarketRecordServer, getModelRecordServer } from "@/lib/api";
import { MarketComparison } from "@/components/MarketComparison";
import type { MarketBenchmark, ModelRecord } from "@/lib/types";
import { CARD_X, Card, CardHead, Note, PageHead, Prose, Table, TableScroll, Tag, Td, Th } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: `Methodology & accuracy — ${APP_NAME}`,
  description:
    "How FinalWhistle predicts the World Cup, and how accurate it is: calibration curve, log-loss & Brier vs baselines, sample sizes, and honest limitations.",
};

type YearMetrics = (typeof data.years)[number];

const fmt = (n: number) => n.toFixed(3);

const PENDING_MARKET: MarketBenchmark = {
  status: "pending", dataset: null, n_matches: 0, updated_at: null,
  model: null, market: null, diff_log_loss: null, diff_ci95: null,
  model_win_rate: null, mean_edge: null, verdict: null,
};

/** "2014, 2018 & 2022" */
function listYears(years: number[]): string {
  if (years.length <= 1) return years.join("");
  return `${years.slice(0, -1).join(", ")} & ${years[years.length - 1]}`;
}

function bestLogLoss(y: YearMetrics): "model" | "favorite" | "base_rate" {
  const opts: ["model" | "favorite" | "base_rate", number][] = [
    ["model", y.model.log_loss],
    ["favorite", y.favorite.log_loss],
    ["base_rate", y.base_rate.log_loss],
  ];
  return opts.sort((a, b) => a[1] - b[1])[0][0];
}

// The Athletic's public WC26 picking contest, as they reported it on
// 2026-07-08 (matches graded through the round of 16, ~94 picks). A static
// snapshot by design: their numbers are theirs; ours stay live below.
const EXTERNAL_PICKERS = [
  { name: "The algorithm (The Athletic)", accuracy: "69%", correct: 65, streak: 14 },
  { name: "The Athletic's experts", accuracy: "68%", correct: 64, streak: 11 },
  { name: "Wilfred (age 6)", accuracy: "66%", correct: 62, streak: 7 },
  { name: "Reader picks", accuracy: "62%", correct: 58, streak: 5 },
  { name: "Stanley the dog", accuracy: "39%", correct: 37, streak: 4 },
] as const;

export default async function MethodologyPage() {
  const beatsBaselines = data.years.filter((y) => bestLogLoss(y) === "model").length;
  let bench: MarketBenchmark = PENDING_MARKET;
  try {
    bench = (await getMarketRecordServer()) ?? PENDING_MARKET;
  } catch {
    bench = PENDING_MARKET;
  }
  let record: ModelRecord | null = null;
  try {
    record = await getModelRecordServer();
  } catch {
    record = null;
  }

  return (
    <article>
      <PageHead
        eyebrow="FinalWhistle"
        title="Methodology"
        sub="How the forecasts are made, and how well they held up against past World Cups."
      />
      <Prose>
        <p>
          The model learned from {data.training_matches.toLocaleString()} real matches (internationals back to
          1872) and was back-tested on the {listYears(data.backtest_years).replace(/&/, "and")} World Cups. For
          the live record, see the <Link href="/record">football record</Link>.
        </p>

        <h2>Is a &ldquo;60%&rdquo; really 60%?</h2>
        <p>
          The chart bins every forecast by its stated probability and checks how often those things happened.
          An honest forecast follows the dashed line.
        </p>
        <Card pad>
          <CalibrationChartLazy bins={data.reliability} />
          <Note className="mt-3">
            Based on {data.reliability_n.toLocaleString()} probability–outcome pairs across the{" "}
            {listYears(data.backtest_years).replace(/&/, "and")} World Cups (all win, draw and loss calls).
          </Note>
        </Card>

        <h2>Does it beat the obvious guesses?</h2>
        <p>
          A model is only useful if it beats simple rules: &ldquo;always back the favourite&rdquo; and
          &ldquo;use historical base rates&rdquo;. Lower is better for log-loss and Brier; higher is better for
          accuracy. The model wins on log-loss in {beatsBaselines} of {data.years.length} back-tested
          tournaments. 2022 was unusually upset-heavy, and no model foresees shocks reliably.
        </p>
        {/* Provenance, stated rather than implied: these historical numbers come
            from the v0.1 baseline engine (pipeline/build_methodology.py), NOT the
            served version. Re-scoring them with the current tuned parameters and
            calibrator would be leakage — those were fitted using these same
            tournaments, so the result would flatter the model on its own training
            data. The honest floor is the untuned engine; the live record is the
            forward-looking evidence. */}
        <p>
          These numbers come from the original v0.1 engine, not today&apos;s. Re-scoring them with the current
          settings would look better and mean less, because those settings were chosen using these
          tournaments. Treat them as the floor, and the <Link href="/record">live record</Link> as the real
          test.
        </p>
        <Card flush>
          {data.years.map((y, i) => {
            const best = bestLogLoss(y);
            return (
              <div key={y.year} className={cn(CARD_X, "py-5", i > 0 && "border-t border-line-soft")}>
                <CardHead as="h3" title={`World Cup ${y.year}`} action={`${y.n_matches} matches`} />
                <TableScroll className="mt-2">
                  <Table>
                    <thead>
                      <tr>
                        <Th align="left">Approach</Th>
                        <Th title="Lower is better">Log-loss</Th>
                        <Th title="Lower is better">Brier</Th>
                        <Th title="Higher is better">Accuracy</Th>
                      </tr>
                    </thead>
                    <tbody>
                      <Row label="FinalWhistle model" m={y.model} highlight={best === "model"} />
                      <Row label="Always the favourite" m={y.favorite} highlight={best === "favorite"} />
                      <Row label="Historical base rate" m={y.base_rate} highlight={best === "base_rate"} />
                    </tbody>
                  </Table>
                </TableScroll>
              </div>
            );
          })}
        </Card>

        {/* Vs the market — the real benchmark (ROADMAP-ENGINE Phase 0), live from /api/model/market-record */}
        <h2>How does it compare to the market?</h2>
        <MarketComparison bench={bench} />

        {/* Vs other public predictors — external snapshot vs our live ledger */}
        <h2>How does it compare to other predictors?</h2>
        <p>
          The Athletic ran the World Cup as a public picking contest. Their numbers are a snapshot of what they
          published on 8 July 2026 (picks graded through the round of 16); the FinalWhistle row is live from
          the same graded ledger as the record.
        </p>
        <Card pad>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th align="left">Predictor</Th>
                  <Th>Accuracy</Th>
                  <Th>Correct</Th>
                  <Th>Best streak</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td align="left" className="font-semibold text-brand">FinalWhistle model (live)</Td>
                  <Td className="font-semibold">
                    {record?.winner_accuracy != null ? `${(record.winner_accuracy * 100).toFixed(1)}%` : "—"}
                  </Td>
                  <Td>{record ? `${record.winners_correct}/${record.evaluated_matches}` : "—"}</Td>
                  <Td>{record?.best_streak ?? "—"}</Td>
                </tr>
                {EXTERNAL_PICKERS.map((p) => (
                  <tr key={p.name}>
                    <Td align="left">{p.name}</Td>
                    <Td>{p.accuracy}</Td>
                    <Td>{p.correct}</Td>
                    <Td>{p.streak}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <Note className="mt-4">
            The contests grade slightly different match sets (theirs about 94 picks; ours every finished match
            with a frozen pre-kick-off prediction), and our number grades the 90-minute result, draws included.
            On the advancement basis those contests use for knockouts, our record is{" "}
            {record && record.advancement_matches > 0
              ? `${record.advancement_correct} of ${record.advancement_matches} (${((record.advancement_accuracy ?? 0) * 100).toFixed(1)}%)`
              : "still building as the knockouts finish"}
            . Source: The Athletic, July 2026.
          </Note>
        </Card>

        <h2>Why it isn&apos;t more complicated</h2>
        <p>
          Each obvious upgrade was tested the honest way: fitted only on data available before a tournament,
          then scored on that tournament.
        </p>
        <ul>
          <li>
            Probability calibration: plain temperature scaling came out at about 1.0 (already calibrated), but a
            segmented calibrator, one correction per rating-gap bracket, cleared the test and shipped in v0.4.
          </li>
          <li>Dixon–Coles draw correction and re-tuned goal settings: gains were within noise.</li>
          <li>Recency-weighted Elo: helped one World Cup, hurt the others.</li>
        </ul>
        <p>
          The next real gain came from new signal rather than re-tuning: injuries and market priors cleared the
          same test and shipped in v0.6.
        </p>

        {/* Model changelog (FR-6.1): one line per shipped model change, newest
            first. The "current" tag must name the version actually loaded from
            ml/models/model_params.json and served by generate_predictions — check
            that file before editing this list, and remember the club
            competitions carry their OWN version strings (pipeline/leagues.py). */}
        <h2>Model changelog</h2>
        <ul>
          <li>
            <strong>poisson-elo-v0.6</strong> <Tag>Current</Tag> since 4 August 2026. Bookmaker odds (capped, so
            the model stays the main voice), player availability and suspensions now move the published number.
            Rest days and a redesigned recent-form signal were measured and refused.
          </li>
          <li>
            <strong>poisson-elo-v0.5</strong>, 8 July to 4 August 2026: extra time and penalty shootouts for
            knockout ties.
          </li>
          <li>
            <strong>poisson-elo-v0.4</strong>, 8 July 2026: v0.2 plus the segmented calibrator, fitted only on
            matches before this World Cup.
          </li>
          <li>
            <strong>poisson-elo-v0.2</strong>, until July 2026: tuned goal settings and a Dixon–Coles draw
            correction. Exact scores in knockouts are judged on the 90-minute score.
          </li>
          <li>
            <strong>poisson-elo-v0.1</strong>, May 2026: the original hand-set Elo and Poisson baseline.
          </li>
        </ul>

        {/* Per-competition engines. The versions above are the INTERNATIONAL
            ledger; each club competition keeps its own version string and its
            own track record (pipeline/leagues.py, and the ledger separation in
            backend/app/api/model_record.py). */}
        <h2>Club competitions</h2>
        <p>
          The clubs run the same Elo and Poisson machinery but keep separate records, because a goal rate
          fitted on one competition does not transfer to another.
        </p>
        <ul>
          <li>
            <strong>Premier League, La Liga, Bundesliga</strong> (poisson-elo-club-v0.3): each goal rate fitted
            on that league&apos;s own ten seasons, on the engine that reads odds, injuries and suspensions.
          </li>
          <li>
            <strong>Champions League</strong> (poisson-elo-ucl-v0.2): fitted in August 2026 on four completed
            editions, correcting a goal rate that made its forecasts too flat.
          </li>
        </ul>
        <p>Clubs that play in Europe keep one strength rating across domestic and European matches.</p>

        <h2>What the numbers mean</h2>
        <ul>
          <li><strong>Calibration</strong>: whether stated chances match what happens. 60% should mean 60%.</li>
          <li><strong>Log-loss</strong>: rewards being confident and right, punishes being confident and wrong. Lower is better.</li>
          <li><strong>Brier score</strong>: the average squared error of the chances. Lower is better.</li>
          <li><strong>Baselines</strong>: simple reference rules any real model must beat.</li>
        </ul>

        <h2>Limitations</h2>
        <ul>
          <li>
            {listYears(data.backtest_years).replace(/&/, "and")} ({data.reliability_n} matches) is a small
            sample. Treat single-tournament numbers with caution.
          </li>
          <li>
            The published number is team-level. An announced XI or injury list moves it only when that data
            exists, and coverage is patchy.
          </li>
          <li>Upset-heavy tournaments, like 2022, are hard; the model can trail simple baselines there.</li>
          <li>
            Mostly free, open data (results, rankings, official draws and fixtures). Since v0.6 it also uses
            licensed bookmaker odds and injury reports.
          </li>
          <li>For analytics, research and entertainment only. Not betting advice.</li>
        </ul>
        <p>
          <Link href="/about">How the model works</Link>
        </p>
      </Prose>
    </article>
  );
}

function Row({
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
      <Td align="left" className={highlight ? "font-semibold text-brand" : "font-medium"}>{label}</Td>
      <Td className={highlight ? "font-semibold" : undefined}>{fmt(m.log_loss)}</Td>
      <Td className="text-muted">{fmt(m.brier)}</Td>
      <Td className="text-muted">{Math.round(m.accuracy * 100)}%</Td>
    </tr>
  );
}
