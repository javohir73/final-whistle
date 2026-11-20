import { Card, Chip, Note } from "@/components/ui";
import { pctTriple } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Probabilities } from "@/lib/types";
import type { RevealPick } from "@/lib/useModelReveal";
import {
  outcomeOf,
  pointsVerdict,
  scoreVerdict,
  type ModelData,
} from "@/components/match/matchPageData";

/** The W/D/L chance bar: home = brand, draw = neutral, away = ink, with a key
 *  whose whole-number percentages always add to 100 (largest remainder). */
export function ChanceBar({ home, away, probabilities }: { home: string; away: string; probabilities: Probabilities }) {
  const t = pctTriple(probabilities);
  if (!t) return null;
  const parts = [
    { key: "h", w: t.home, cls: "bg-brand" },
    { key: "d", w: t.draw, cls: "bg-line-strong" },
    { key: "a", w: t.away, cls: "bg-ink" },
  ].filter((p) => p.w > 0);
  return (
    <>
      <div
        role="img"
        aria-label={`${home} ${t.home}%, draw ${t.draw}%, ${away} ${t.away}%`}
        className="mb-2.5 mt-[18px] flex h-3 gap-[3px] overflow-hidden rounded-md"
      >
        {parts.map((p) => (
          <span key={p.key} className={cn("block rounded-[3px]", p.cls)} style={{ width: `${p.w}%` }} />
        ))}
      </div>
      <div aria-hidden="true" className="flex justify-between gap-3 text-notes text-ink">
        <span>
          {home} <b className="font-bold tabular-nums">{t.home}%</b>
        </span>
        <span className="text-center">
          Draw <b className="font-bold tabular-nums">{t.draw}%</b>
        </span>
        <span className="text-right">
          {away} <b className="font-bold tabular-nums">{t.away}%</b>
        </span>
      </div>
    </>
  );
}

export type CallMode =
  /** Open fixture, the viewer's pick is locked. */
  | "locked"
  /** Open fixture of a competition with no pick game (Champions League). */
  | "open"
  /** Kicked off, stopped or result pending: made before kick-off. */
  | "made"
  /** Finished: graded against the result. */
  | "finished";

/** "The model's call": confidence, the model's score (52px), the chance bar;
 *  beside it the viewer's locked pick, or -- once finished -- how the call
 *  went ("Right result · 2 points", the game's own scoring). */
export function ModelCallCard({
  id = "forecast",
  home,
  away,
  data,
  mode,
  pick,
  result,
  rise,
  knockout,
}: {
  id?: string;
  home: string;
  away: string;
  data: ModelData;
  mode: CallMode;
  /** The viewer's own pick, when known. */
  pick: RevealPick | null;
  /** The 90-minute result once finished. */
  result: { home: number; away: number } | null;
  /** Rise in (0.35 s) -- only right after the viewer locked. */
  rise?: boolean;
  /** A knockout tie: the model's draw means level after 90 minutes. */
  knockout?: boolean;
}) {
  const conf = data.confidence ? `${data.confidence} confidence.` : "";
  const note =
    mode === "locked"
      ? `${conf} Shown because your pick is locked.`.trim()
      : mode === "open"
        ? conf || "Made before kick-off."
        : `Made before kick-off. ${conf}`.trim();
  const model = data.predicted;
  const hasScore = model.home != null && model.away != null;
  const modelScore = hasScore ? `${model.home}–${model.away}` : "—";
  const verdict =
    mode === "finished" && result && hasScore
      ? scoreVerdict({ home: model.home as number, away: model.away as number }, result)
      : null;
  const yourScore = pick?.kind === "score" ? `${pick.home}–${pick.away}` : null;

  return (
    <Card pad id={id} aria-labelledby={`${id}-heading`} className={cn("scroll-mt-28", rise && "fw-rise")}>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div>
          <h2 id={`${id}-heading`} className="text-h2 font-semibold text-ink">
            The model’s call
          </h2>
          <Note className="mt-1.5">{note}</Note>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {verdict && (
            <Chip tone={verdict.tone}>
              {verdict.label} · {verdict.points} points
            </Chip>
          )}
          {mode === "locked" && yourScore && (
            <span className="text-notes text-muted">
              You <b className="text-[24px] font-semibold tabular-nums text-brand">{yourScore}</b>
            </span>
          )}
          <span className="inline-flex items-baseline gap-5">
            {mode === "locked" && <span className="text-notes text-muted">Model</span>}
            <span className="text-stat font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
              <span className="sr-only">The model’s score </span>
              {modelScore}
            </span>
          </span>
        </div>
      </div>
      <ChanceBar home={home} away={away} probabilities={data.probabilities} />
      {knockout && mode !== "finished" && <Note className="mt-3">Draw = level after 90 minutes.</Note>}
      {mode !== "locked" && pick && <YourPickLine pick={pick} home={home} away={away} result={result} finished={mode === "finished"} />}
    </Card>
  );
}

/** Under the bar once picking is over: the viewer's own pick and, when it is
 *  graded, its points. Real values only -- nothing when there is no pick. */
function YourPickLine({
  pick,
  home,
  away,
  result,
  finished,
}: {
  pick: RevealPick;
  home: string;
  away: string;
  result: { home: number; away: number } | null;
  finished: boolean;
}) {
  if (pick.kind === "score") {
    const graded = pick.gradedAt != null && pick.points != null;
    const v = graded ? pointsVerdict(pick.points ?? 0, pick.exact) : null;
    return (
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-4">
        <span className="text-notes text-muted">
          Your pick <b className="text-[19px] font-semibold tabular-nums text-brand">{pick.home}–{pick.away}</b>
        </span>
        {v ? (
          <Chip tone={v.tone}>
            {v.label} · {pick.points} {pick.points === 1 ? "point" : "points"}
          </Chip>
        ) : (
          <span className="text-notes text-muted">
            {finished ? "Points land when the result is graded." : "Points land at full time."}
          </span>
        )}
      </div>
    );
  }
  // World Cup archive: a local W/D/L pick, never scored.
  const name = pick.pick === "home" ? home : pick.pick === "away" ? away : "a draw";
  const called = finished && result ? outcomeOf(result.home, result.away) === (pick.pick === "home" ? 1 : pick.pick === "away" ? -1 : 0) : null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-4">
      <span className="text-notes text-muted">
        You picked <b className="font-semibold text-brand">{name}</b>
      </span>
      {called != null && <Chip tone={called ? "ok" : "miss"}>{called ? "Called it" : "Missed"}</Chip>}
    </div>
  );
}
