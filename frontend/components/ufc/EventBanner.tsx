import Link from "next/link";
import { boutHref, fighterHref, isTba } from "@/lib/ufcDisplay";
import type { UfcBoutSummary } from "@/lib/ufcTypes";
import { BAND, FighterPortrait } from "./FighterPortrait";

function Name({ fighter }: { fighter: UfcBoutSummary["fighter_a"] }) {
  const cls = `block break-words font-display text-[16px] font-bold leading-[1.1] tracking-[-0.02em] ${BAND.text} [hyphens:auto] min-[900px]:text-[24px]`;
  return isTba(fighter) ? (
    <span className={cls}>{fighter.name}</span>
  ) : (
    <Link
      href={fighterHref(fighter.slug)}
      className="inline-block min-h-[44px] no-underline hover:underline hover:underline-offset-4"
    >
      <span className={cls}>{fighter.name}</span>
    </Link>
  );
}

/** The card's main event as a dark banner above the fight list: the date, both fighters and a link to the fight page (where the pick is). `date` is the eyebrow day, or null. */
export function EventBanner({ bout, date }: { bout: UfcBoutSummary; date: string | null }) {
  const open = bout.status === "scheduled";
  const versus = `${bout.fighter_a.name} v ${bout.fighter_b.name}`;
  return (
    <section
      aria-label="Main event"
      className={`rounded-card ${BAND.bg} ${BAND.text} px-4 pb-6 pt-6 text-center min-[900px]:px-10 min-[900px]:pb-8 min-[900px]:pt-8`}
    >
      <p className={`text-notes font-semibold uppercase tracking-[0.08em] ${BAND.lime}`}>
        {["Main event", date].filter(Boolean).join(" · ")}
      </p>
      <div className="mx-auto mt-5 grid max-w-[560px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-3 min-[900px]:gap-x-6">
        {([bout.fighter_a, bout.fighter_b] as const).map((f, i) => (
          <div key={i} className="contents">
            {i === 1 && (
              <span aria-hidden="true" className={`self-center text-sm font-semibold uppercase tracking-[0.2em] ${BAND.muted}`}>
                vs
              </span>
            )}
            <div className="flex min-w-0 flex-col items-center gap-2">
              <FighterPortrait fighter={f} weightClass={bout.weight_class} size="banner" />
              <Name fighter={f} />
            </div>
          </div>
        ))}
      </div>
      <Link
        href={boutHref(bout.id)}
        aria-label={`${open ? "Pick the main event" : "View the main event"}: ${versus}`}
        className="mt-5 inline-flex min-h-[44px] items-center rounded-full bg-ufc-lime px-6 text-sm font-semibold text-ufc-band no-underline hover:bg-ufc-lime-hover"
      >
        {open ? "Pick the main event" : "View the main event"}
      </Link>
    </section>
  );
}
