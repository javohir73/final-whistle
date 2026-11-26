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
import { BAND, FighterPortrait } from "./FighterPortrait";

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/** The pill badges under a portrait (country, record). */
export function BandPill({ children }: { children: ReactNode }) {
  return (
    <span className={`rounded-full ${BAND.tile} px-2.5 py-1 text-[12px] font-medium leading-none ${BAND.text}`}>
      {children}
    </span>
  );
}

function Side({
  fighter,
  side,
  winner,
  weightClass,
  className,
}: {
  className: string;
  fighter: UfcFighterMini;
  side: "a" | "b";
  winner: boolean;
  weightClass: string | null;
}) {
  const record = recordText(fighter.record);
  const nameCls = `block break-words font-display text-[22px] font-bold leading-[1.05] tracking-[-0.025em] ${BAND.text} [hyphens:auto] min-[900px]:text-[40px]`;
  return (
    <div data-side={side} className={`flex min-w-0 flex-col items-center gap-3 text-center ${className}`}>
      <FighterPortrait fighter={fighter} weightClass={weightClass} priority />
      <div className="min-w-0">
        {isTba(fighter) ? (
          <span className={nameCls}>{fighter.name}</span>
        ) : (
          <Link
            href={fighterHref(fighter.slug)}
            className="inline-block min-h-[44px] no-underline hover:underline hover:decoration-2 hover:underline-offset-[5px]"
          >
            <span className={nameCls}>{fighter.name}</span>
          </Link>
        )}
        {(fighter.country || record) && (
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {!isTba(fighter) && fighter.country && <BandPill>{fighter.country}</BandPill>}
            {record && <BandPill>{record}</BandPill>}
          </div>
        )}
        {winner && <span className={`mt-2 block text-notes font-semibold ${BAND.lime}`}>Winner</span>}
      </div>
    </div>
  );
}

function Centre({ bout, tz, eyebrow }: { bout: UfcBoutDetail; tz: string; eyebrow: string }) {
  const big = `whitespace-nowrap font-display text-[26px] font-bold leading-[1.1] tracking-[-0.02em] ${BAND.text} min-[900px]:text-[34px]`;
  let main: ReactNode;
  if (bout.status === "finished") {
    main = (
      <ResultBox className="!bg-ufc-lime !text-ufc-band">{bout.result ? resultBoxText(bout.result) : "–"}</ResultBox>
    );
  } else if (bout.status === "live") main = <div className={big}>Live</div>;
  else if (bout.status === "cancelled") main = <div className={big}>Cancelled</div>;
  else {
    const time = bout.scheduled_utc ? safe(() => kickoffTimeLower(bout.scheduled_utc as string, tz)) : null;
    const date = bout.scheduled_utc ? safe(() => kickoffDate(bout.scheduled_utc as string, tz)) : null;
    main = (
      <div className={big}>
        {time ?? "TBC"}
        {date && <small className={`mt-1 block text-notes font-normal tracking-normal ${BAND.muted}`}>{date}</small>}
      </div>
    );
  }
  return (
    <div className="order-first col-span-2 flex flex-col items-center gap-3 text-center min-[900px]:order-none min-[900px]:col-span-1 min-[900px]:col-start-2 min-[900px]:row-start-1 min-[900px]:self-center min-[900px]:px-2">
      <p className={`text-notes font-semibold uppercase tracking-[0.08em] ${BAND.lime}`}>{eyebrow}</p>
      {main}
      <span aria-hidden="true" className={`text-sm font-semibold uppercase tracking-[0.2em] ${BAND.muted}`}>
        vs
      </span>
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
    <div>
      <section
        aria-labelledby="fight-title"
        className={`rounded-card ${BAND.bg} ${BAND.text} flex flex-col items-center px-4 pb-7 pt-7 text-center min-[900px]:px-10 min-[900px]:pb-9 min-[900px]:pt-10`}
      >
        <h1 id="fight-title" className="sr-only">
          {bout.fighter_a.name} v {bout.fighter_b.name}
        </h1>
        <div className="grid w-full max-w-[880px] grid-cols-2 items-start gap-x-3 gap-y-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_minmax(0,1fr)] min-[900px]:gap-x-8 min-[900px]:self-center">
          <Centre bout={bout} tz={tz} eyebrow={eyebrow} />
          <Side fighter={bout.fighter_a} side="a" className="min-[900px]:col-start-1 min-[900px]:row-start-1" winner={winner === "a"} weightClass={bout.weight_class} />
          <Side fighter={bout.fighter_b} side="b" className="min-[900px]:col-start-3 min-[900px]:row-start-1" winner={winner === "b"} weightClass={bout.weight_class} />
        </div>
        <p className={`mt-5 text-notes ${BAND.muted}`}>{boutSubLine(bout, false)}</p>
        {line && <p className={`mt-2 text-base font-semibold ${BAND.text}`}>{line}</p>}
      </section>
      {/* The pick controls are light-theme UI, so they get their own card under the band. */}
      {children && (
        <Card className="mt-3 flex flex-col items-center px-4 pb-7 text-center min-[900px]:px-10 min-[900px]:pb-9">
          {children}
        </Card>
      )}
    </div>
  );
}
