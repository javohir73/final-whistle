import Link from "next/link";
// Lazy: recharts loads after hydration, not on /record's first load.
import { CalibrationChartLazy } from "@/components/CalibrationChartLazy";
import { Card, CardHead, Chip, EmptyState, Main, Note, PageLayout, Rail, Stat, StatGrid } from "@/components/ui";
import type { ModelRecord, ModelRecordEntry } from "@/lib/types";

const SMALL_SAMPLE = 30;
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/** "2026-08-18T07:58:47+00:00" → "18 August 2026" (UTC, so server and client agree). */
export function formatRecordDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function RecordView({ record }: { record: ModelRecord }) {
  if (record.evaluated_matches === 0) {
    return (
      <EmptyState title="No matches scored yet">
        This fills in as fixtures finish. Every prediction is graded on the score after it is played, never
        adjusted with hindsight.
      </EmptyState>
    );
  }

  const n = record.evaluated_matches;
  const fmt3 = (v: number | null) => (v != null ? v.toFixed(3) : "—");

  return (
    <PageLayout>
      <Main>
        <Card pad>
          <CardHead title="Season total" />
          <StatGrid>
            <Stat value={pct(record.winner_accuracy)} label={`of results called, ${record.winners_correct} of ${n}`} />
            {record.advancement_matches > 0 && (
              <Stat
                value={pct(record.advancement_accuracy)}
                label={`Knockout progression, ${record.advancement_correct} of ${record.advancement_matches} ties`}
              />
            )}
            <Stat value={pct(record.exact_score_rate)} label={`${record.exact_score_hits} of ${n} scorelines exact`} />
          </StatGrid>
          {n < SMALL_SAMPLE && (
            <Note className="mt-5">
              Small sample ({n} matches) — treat these with caution while the sample is small.
            </Note>
          )}
          <Note className="mt-5">
            Model version {record.model_version}. Average log loss {fmt3(record.avg_log_loss)}, Brier{" "}
            {fmt3(record.avg_brier)} (lower is better for both).
          </Note>
        </Card>

        <Card pad>
          <CardHead title="Is a “60%” really 60%?" />
          <Note className="mt-1.5">
            Every call binned by its stated chance, against how often it happened. An honest forecast follows
            the dashed line.
          </Note>
          <div className="mt-5">
            <CalibrationChartLazy bins={record.calibration} />
          </div>
          <Note className="mt-3">Based on {n} scored matches (all win, draw and loss calls).</Note>
        </Card>

        <div className="flex flex-col gap-2 text-notes text-muted">
          <p>
            Results are graded on the 90-minute score, draws included.
            {record.advancement_matches > 0 && " Knockout ties are graded on who went through, extra time and penalties included."}
          </p>
          <p>{record.disclaimer}</p>
          <p>
            Back-tests and how the forecast is built:{" "}
            <Link href="/methodology" className="font-semibold text-brand underline-offset-[3px] hover:underline">
              Methodology
            </Link>
          </p>
        </div>
      </Main>
      <Rail aria-label="Best calls and biggest misses">
        <CallList title="Best calls" entries={record.best_calls} />
        <CallList title="Biggest misses" entries={record.biggest_misses} />
      </Rail>
    </PageLayout>
  );
}

function CallList({ title, entries }: { title: string; entries: ModelRecordEntry[] }) {
  return (
    <Card pad>
      <CardHead title={title} />
      {entries.length === 0 ? (
        <Note className="mt-2">None yet.</Note>
      ) : (
        <ul className="mt-3 list-none p-0">
          {entries.map((e) => (
            <li
              key={e.match_id}
              className="flex items-center justify-between gap-3 border-t border-line-soft py-3 first:border-t-0"
            >
              <span className="min-w-0 font-medium text-ink">{e.label}</span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted">
                {e.prob_assigned != null ? pct(e.prob_assigned) : "—"}
                <Chip tone={e.winner_correct ? "ok" : "miss"}>{e.winner_correct ? "Called it" : "Missed"}</Chip>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
