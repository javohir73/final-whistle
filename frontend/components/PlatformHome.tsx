import Link from "next/link";
import type { CSSProperties } from "react";
import { BrandMark } from "@/components/Logo";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { PremiumPromo } from "@/components/PremiumPromo";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

const FOOTBALL_COMPETITIONS: Array<{
  id: CompetitionId;
  region: string;
  description: string;
}> = [
  {
    id: "epl",
    region: "England",
    description: "Fixtures, standings and match forecasts.",
  },
  {
    id: "laliga",
    region: "Spain",
    description: "A dedicated home for every La Liga club.",
  },
  {
    id: "bundesliga",
    region: "Germany",
    description: "Bundesliga teams, fixtures and tables.",
  },
  {
    id: "ucl",
    region: "Europe",
    description: "League-phase fixtures, standings and score predictions.",
  },
  {
    id: "wc26",
    region: "International",
    description: "The complete World Cup tournament view.",
  },
];

type CompetitionCardStyle = CSSProperties & {
  "--competition-card-accent": string;
};

function competitionCardStyle(accentVar: string): CompetitionCardStyle {
  return { "--competition-card-accent": `var(${accentVar})` };
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path d="M5 12h14M14 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The platform-level front door. Competition pages keep their own dense,
 * matchday-focused surfaces; this page only answers the first visit questions:
 * what FinalWhistle covers, where to go, and what "Play" means. */
export function PlatformHome() {
  return (
    <div className="-mt-8">
      <section className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden border-b border-border pb-12 pt-12 sm:pb-16 sm:pt-16 lg:pb-20 lg:pt-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_40%,hsl(var(--win)/0.07),transparent_32%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-24 h-px bg-gradient-to-r from-transparent via-win/15 to-transparent"
        />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-5">
          <div className="max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 text-label font-bold uppercase tracking-[0.16em] text-lime-deep">
              <BrandMark className="h-5 w-auto" />
              Sports, clearly explained
            </div>
            <h1 className="max-w-4xl font-display text-[clamp(2.8rem,8vw,6.5rem)] font-extrabold leading-[0.92] tracking-[-0.055em]">
              Your matchday,
              <span className="block text-lime-deep">all in one place.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Predictions, fixtures and form across football and rugby league—without
              the noise.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#competitions"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-win px-5 font-display text-sm font-bold text-action-ink transition hover:brightness-105"
              >
                Choose a competition
                <ArrowIcon />
              </a>
              <Link
                href="/play"
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-border bg-surface/50 px-5 font-display text-sm font-bold transition hover:border-win/40 hover:bg-surface"
              >
                Make your picks
              </Link>
            </div>

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/70 pt-5 text-xs font-medium text-muted">
              {["Match probabilities", "Fixtures & tables", "Model track record"].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <span className="text-lime-deep">
                      <CheckIcon />
                    </span>
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <section id="competitions" className="scroll-mt-32 py-12 sm:py-16">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="text-label font-bold uppercase tracking-[0.14em] text-lime-deep">
              Explore
            </p>
            <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Choose your competition
            </h2>
          </div>
          <span className="hidden text-sm text-muted sm:block">Football</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {FOOTBALL_COMPETITIONS.map(({ id, region, description }) => {
            const competition = COMPETITIONS[id];
            return (
              <Link
                key={id}
                href={competition.basePath}
                data-competition-card={id}
                style={competitionCardStyle(competition.accentVar)}
                className="competition-card group relative min-h-[210px] overflow-hidden rounded-2xl p-5"
              >
                <div className="flex items-start justify-between">
                  <CompetitionLogo competition={id} size={50} />
                  <span className="competition-card__arrow">
                    <ArrowIcon />
                  </span>
                </div>
                <div className="mt-8">
                  <p className="competition-card__copy text-label font-bold uppercase tracking-[0.12em]">
                    {region}
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-extrabold tracking-tight">
                    {competition.label}
                  </h3>
                  <p className="competition-card__copy mt-2 text-sm leading-relaxed">
                    {description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-10 mb-4 flex items-end justify-between">
          <div>
            <p className="text-label font-bold uppercase tracking-[0.14em] text-lime-deep">
              Rugby league
            </p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight">
              NRL
            </h2>
          </div>
          <span className="hidden text-sm text-muted sm:block">Australia &amp; New Zealand</span>
        </div>

        <Link
          href={COMPETITIONS.nrl.basePath}
          data-competition-card="nrl"
          style={competitionCardStyle(COMPETITIONS.nrl.accentVar)}
          className="competition-card competition-card--wide group relative flex min-h-[150px] flex-col justify-between overflow-hidden rounded-2xl p-5 sm:flex-row sm:items-center sm:p-7"
        >
          <div className="flex items-center gap-4">
            <CompetitionLogo competition="nrl" size={64} />
            <div>
              <p className="competition-card__copy text-label font-bold uppercase tracking-[0.12em]">
                2026 season
              </p>
              <h3 className="mt-1 font-display text-3xl font-extrabold tracking-tight">
                National Rugby League
              </h3>
              <p className="competition-card__copy mt-1 text-sm">
                Round-by-round predictions, ladder and model record.
              </p>
            </div>
          </div>
          <span className="competition-card__arrow mt-5 inline-flex items-center gap-2 self-start font-display text-sm font-bold sm:mt-0 sm:self-auto">
            Open NRL
            <ArrowIcon />
          </span>
        </Link>
      </section>

      <section className="panel-pitch rounded-2xl px-6 py-8 sm:flex sm:items-center sm:justify-between sm:px-8">
        <div className="relative z-10">
          <p className="text-label font-bold uppercase tracking-[0.14em] text-pitch-accent-ink">
            Play
          </p>
          <h2 className="mt-1 max-w-xl font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Think you can beat the model?
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">
            Pick the scorelines, follow your results and compare your calls across
            football and NRL.
          </p>
        </div>
        <Link
          href="/play"
          className="relative z-10 mt-6 inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-win px-5 font-display text-sm font-bold text-action-ink transition hover:brightness-105 sm:mt-0"
        >
          Go to Play
          <ArrowIcon />
        </Link>
      </section>

      {/* Explore -> Play -> Premium -> closing note. Renders nothing at all for
          a subscriber, or when billing is off (it owns its own top margin, so
          the page keeps its rhythm either way). */}
      <PremiumPromo />

      <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>Probabilities are published with their uncertainty—not as promises.</p>
        <Link
          href="/methodology"
          className="font-semibold text-foreground underline-offset-4 hover:text-lime-deep hover:underline"
        >
          See how the models work →
        </Link>
      </div>
    </div>
  );
}
