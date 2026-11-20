import Link from "next/link";
import { Card, CardHead, Note, Stat, StatGrid, TextLink } from "@/components/ui";
import type { NrlRecord, NrlTipsheetRecord, OriginSeriesResponse } from "@/lib/types";
import { wholePct } from "@/lib/nrlDisplay";

/** "How the model went in {season}" (prototype NRL home): winners called,
 *  matches graded, best run -- straight off /api/nrl/model/record -- and the
 *  API's own 95% interval as one plain sentence. */
export function ModelSeasonCard({
  record,
  season,
  title,
}: {
  record: NrlRecord | NrlTipsheetRecord;
  season: number;
  title?: string;
}) {
  if (record.evaluated_matches === 0 || record.winner_accuracy == null) return null;
  const ci = record.winner_accuracy_ci95;
  return (
    <Card pad aria-labelledby="nrl-model-season">
      <CardHead
        id="nrl-model-season"
        title={title ?? `How the model went in ${season}`}
        action={<TextLink href="/nrl/record">See the full record</TextLink>}
      />
      <StatGrid>
        <Stat value={wholePct(record.winner_accuracy)} label="of winners called" />
        <Stat value={record.evaluated_matches} label="matches graded" />
        <Stat value={record.best_streak} label="best run of correct picks" />
      </StatGrid>
      {ci ? (
        <Note className="mt-5">
          With {record.evaluated_matches} matches the true rate is likely between {wholePct(ci[0])} and{" "}
          {wholePct(ci[1])}.
        </Note>
      ) : null}
    </Card>
  );
}

/** "State of Origin 2026 — NSW Blues 2–1 QLD Maroons — See the series". */
export function OriginLinkCard({ origin }: { origin: OriginSeriesResponse | null }) {
  if (!origin || origin.games.length === 0) return null;
  const s = origin.series;
  return (
    <Link
      href="/nrl/origin"
      className="group flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-ground px-4 py-5 text-ink no-underline hover:border-line-strong min-[900px]:px-7 min-[900px]:py-6"
    >
      <span>
        <span className="block text-notes text-muted">State of Origin {origin.season}</span>
        <span className="block text-h2 font-semibold">
          NSW Blues {s.blues_wins}–{s.maroons_wins} QLD Maroons
          {s.drawn_games ? ` · ${s.drawn_games} drawn` : ""}
        </span>
      </span>
      <span className="text-notes font-semibold text-brand group-hover:underline group-hover:underline-offset-[3px]">
        See the series
      </span>
    </Link>
  );
}
