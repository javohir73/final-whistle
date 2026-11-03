"use client";

import Link from "next/link";
import { BrandMark } from "@/components/Logo";
import { NextUpStrip } from "@/components/play/NextUpStrip";
import { useCompetitionScope } from "@/components/TournamentProvider";
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import { isNrlOffSeasonDate } from "@/lib/nrlTips";
import type { CompetitionId } from "@/lib/sports";

/** How a competition reads after "Beat the model at …" -- with its article
 *  where English wants one ("the Premier League", but "La Liga"). Only the
 *  competitions you can play right now are listed. */
const PLAY_NAME: Partial<Record<CompetitionId, string>> = {
  epl: "the Premier League",
  laliga: "La Liga",
  bundesliga: "the Bundesliga",
  nrl: "the NRL",
};

export interface HeroCopy {
  headline: string;
  playHref: string;
  /** Football competition whose next fixtures the strip shows. */
  nextUp: CompetitionId;
}

/** The hero for the visitor's current competition. A competition with no
 *  picks open right now (the NRL off- or pre-season, the Champions League
 *  before its tips switch on, the finished World Cup, or nothing resolved at
 *  all) gets the plain "Beat the model." and a way into the Premier League
 *  instead of a promise it can't keep. `nrlPlayable` comes from the NRL's
 *  current round (the shared season rule); the calendar is only a fallback. */
export function heroCopy(
  competition: CompetitionId | null | undefined,
  now: Date = new Date(),
  nrlPlayable?: boolean,
): HeroCopy {
  const footballLeague = competition != null && ACTIVE_LEAGUES.includes(competition);
  const nrlOpen = nrlPlayable ?? !isNrlOffSeasonDate(now);
  const playable = footballLeague || (competition === "nrl" && nrlOpen);
  const name = playable && competition ? PLAY_NAME[competition] : undefined;
  if (!competition || !name) {
    return { headline: "Beat the model.", playHref: "/play?competition=epl", nextUp: "epl" };
  }
  return {
    headline: `Beat the model at ${name}.`,
    playHref: `/play?competition=${competition}`,
    // The strip reads football fixtures; an NRL visitor sees the EPL's.
    nextUp: footballLeague ? competition : "epl",
  };
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M5 12h14M14 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The home page's first screen: what the game is, for the competition the
 *  visitor follows (the nav's scope: URL -> remembered -> EPL), the way in,
 *  and the next fixtures to pick -- all inside the first mobile screen. */
export function PlatformHero({ now, nrlPlayable }: { now?: Date; nrlPlayable?: boolean }) {
  const { competition } = useCompetitionScope();
  const copy = heroCopy(competition, now, nrlPlayable);

  return (
    <section className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden border-b border-border pb-8 pt-6 sm:pb-12 sm:pt-12 lg:pb-16 lg:pt-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_40%,hsl(var(--win)/0.07),transparent_32%)]"
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-5">
        <div className="max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 text-label font-bold uppercase tracking-[0.16em] text-lime-deep sm:mb-6">
            <BrandMark className="h-5 w-auto" />
            Sports, clearly explained
          </div>
          <h1 className="max-w-4xl font-display text-[clamp(2.25rem,8vw,6rem)] font-extrabold leading-[0.95] tracking-[-0.05em]">
            {copy.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:mt-6 sm:text-lg">
            Pick the scores before kickoff. Then see where you stand against the model.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:flex sm:gap-3">
            <Link
              href={copy.playHref}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-win px-4 font-display text-sm font-bold text-action-ink transition hover:brightness-105 sm:px-5"
            >
              Make your picks
              <ArrowIcon />
            </Link>
            <a
              href="#competitions"
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-border bg-surface/50 px-4 font-display text-sm font-bold transition hover:border-win/40 hover:bg-surface sm:px-5"
            >
              Choose a competition
            </a>
          </div>

          <NextUpStrip competition={copy.nextUp} />
        </div>
      </div>
    </section>
  );
}
