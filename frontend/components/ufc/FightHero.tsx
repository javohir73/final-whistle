import type { ReactNode } from "react";
import Link from "next/link";
import { kickoffTimeLower } from "@/components/match/matchPageData";
import { Card, ResultBox } from "@/components/ui";
import { kickoffDate } from "@/lib/datetime";
import {
  boutSubLine,
  fighterHref,
  isTba,
  recordText,
  resultBoxText,
  resultLine,
  segmentTitle,
} from "@/lib/ufcDisplay";
import type { UfcBoutDetail, UfcFighterMini } from "@/lib/ufcTypes";
import { FighterMark } from "./FighterMark";

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

function Side({ fighter, side, winner }: { fighter: UfcFighterMini; side: "a" | "b"; winner: boolean }) {
  const record = recordText(fighter.record);
  const nameCls =
    "block break-words text-[22px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink [hyphens:auto] min-[900px]:text-[32px]";
  return (
    <div data-side={side} className="flex min-w-0 flex-col items-center gap-2 text-center">
      <FighterMark name={fighter.name} size={60} />
      <div className="min-w-0">
        {isTba(fighter) ? (
          <span className={nameCls}>{fighter.name}</span>
        ) : (
          <Link href={fighterHref(fighter.slug)} className="no-underline hover:underline hover:decoration-2 hover:underline-offset-[5px]">
            <span className={nameCls}>{fighter.name}</span>
          </Link>
        )}
        {record && <span className="mt-1 block text-notes text-muted">{record}</span>}
        {winner && <span className="mt-1 block text-notes font-semibold text-ink">Winner</span>}
      </div>
    </div>
  );
}

function Centre({ bout, tz }: { bout: UfcBoutDetail; tz: string }) {
  const big = "whitespace-nowrap text-[20px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink min-[900px]:text-[28px]";
  if (bout.status === "finished") {
    return <ResultBox>{bout.result ? resultBoxText(bout.result) : "–"}</ResultBox>;
  }
  if (bout.status === "live") return <div className={big}>Live</div>;
  if (bout.status === "cancelled") return <div className={big}>Cancelled</div>;
  const time = bout.scheduled_utc ? safe(() => kickoffTimeLower(bout.scheduled_utc as string, tz)) : null;
  const date = bout.scheduled_utc ? safe(() => kickoffDate(bout.scheduled_utc as string, tz)) : null;
  return (
    <div className={big}>
      {time ?? "TBC"}
      {date && <small className="mt-1 block text-notes font-normal tracking-normal text-muted">{date}</small>}
    </div>
  );
}

/** The fight hero: both fighters either side of the start time or the result. */
export function FightHero({ bout, tz, children }: { bout: UfcBoutDetail; tz: string; children?: ReactNode }) {
  const date = bout.scheduled_utc ? safe(() => kickoffDate(bout.scheduled_utc as string, tz)) : null;
  const eyebrow = ["UFC", date, segmentTitle(bout.segment.label)].filter(Boolean).join(" · ");
  const finished = bout.status === "finished";
  const winner = finished && bout.result && bout.result.method !== "draw" && bout.result.method !== "no_contest" ? bout.result.winner : null;
  const line = resultLine(bout);
  return (
    <Card
      aria-labelledby="fight-title"
      className="flex flex-col items-center px-4 pb-7 pt-7 text-center min-[900px]:px-10 min-[900px]:pb-9 min-[900px]:pt-10"
    >
      <h1 id="fight-title" className="sr-only">
        {bout.fighter_a.name} v {bout.fighter_b.name}
      </h1>
      <p className="text-notes font-medium text-muted">{eyebrow}</p>
      <div className="mt-6 grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 min-[900px]:gap-x-8">
        <Side fighter={bout.fighter_a} side="a" winner={winner === "a"} />
        <Centre bout={bout} tz={tz} />
        <Side fighter={bout.fighter_b} side="b" winner={winner === "b"} />
      </div>
      <p className="mt-5 text-notes text-muted">{boutSubLine(bout, false)}</p>
      {line && <p className="mt-2 text-base font-semibold text-ink">{line}</p>}
      {children}
    </Card>
  );
}
