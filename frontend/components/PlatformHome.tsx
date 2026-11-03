import Link from "next/link";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { PremiumPromo } from "@/components/PremiumPromo";
import { PlatformHero } from "@/components/play/PlatformHero";
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import { isNrlOffSeasonDate, nrlReturnYear } from "@/lib/nrlTips";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

/** Derived from the date (this page is static, re-evaluated on every deploy)
 *  so the line can't rot the way the hard-coded "2026 season" card did. */
export function nrlStatusLine(now: Date = new Date()): string {
  if (!isNrlOffSeasonDate(now)) return "Round-by-round predictions, ladder and tips";
  return `Season complete · back March ${nrlReturnYear(now)}`;
}

function footballStatusLine(id: CompetitionId): string {
  return ACTIVE_LEAGUES.includes(id)
    ? "Score picks open · fixtures & table"
    : "League phase · fixtures & table";
}

/** Live football competitions, in registry order (the World Cup is past). */
const LIVE_FOOTBALL: CompetitionId[] = (["epl", "laliga", "bundesliga", "ucl"] as CompetitionId[]).filter(
  (id) => COMPETITIONS[id].enabled,
);

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

/** One competition as a compact branded row: crest, name, a status line and a
 *  chevron. Rows (not 300 px cards) keep the whole list near one mobile
 *  screen; the branded `.competition-card` treatment carries over unchanged. */
function CompetitionRow({
  id,
  name,
  status,
}: {
  id: CompetitionId;
  name: string;
  status: string;
}) {
  const competition = COMPETITIONS[id];
  return (
    <Link
      href={competition.basePath}
      data-competition-card={id}
      className="competition-card competition-card--wide group relative flex min-h-[72px] items-center gap-3 overflow-hidden rounded-2xl py-3 pl-3 pr-4"
    >
      <span className="grid w-[72px] shrink-0 place-items-center">
        <CompetitionLogo
          competition={id}
          size={40}
          imageClassName={id === "wc26" ? "competition-card__wc26-mark" : undefined}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-lg font-extrabold leading-tight tracking-tight">
          {name}
        </span>
        <span className="competition-card__copy block truncate text-xs">{status}</span>
      </span>
      <span className="competition-card__arrow">
        <ArrowIcon />
      </span>
    </Link>
  );
}

/** The platform-level front door. Competition pages keep their own dense,
 * matchday-focused surfaces; this page answers the first-visit questions: the
 * game (beat the model at your competition) and the next fixtures to pick on
 * the first screen, then where else to go. The World Cup sits under "Past
 * tournaments", below everything live. */
export function PlatformHome({ now }: { now?: Date } = {}) {
  return (
    <div className="-mt-8">
      <PlatformHero now={now} />

      <section id="competitions" className="scroll-mt-32 py-10 sm:py-14">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-label font-bold uppercase tracking-[0.14em] text-lime-deep">
              Explore
            </p>
            <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Choose your competition
            </h2>
          </div>
        </div>

        <h3 className="mb-2.5 text-label font-bold uppercase tracking-[0.12em] text-muted">Football</h3>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" data-competition-group="football">
          {LIVE_FOOTBALL.map((id) => (
            <CompetitionRow key={id} id={id} name={COMPETITIONS[id].label} status={footballStatusLine(id)} />
          ))}
        </div>

        <h3 className="mb-2.5 mt-6 text-label font-bold uppercase tracking-[0.12em] text-muted">
          Rugby league
        </h3>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" data-competition-group="rugby-league">
          <CompetitionRow id="nrl" name="National Rugby League" status={nrlStatusLine(now)} />
        </div>

        <h3 className="mb-2.5 mt-6 text-label font-bold uppercase tracking-[0.12em] text-muted">
          Past tournaments
        </h3>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" data-competition-group="past">
          <CompetitionRow id="wc26" name={COMPETITIONS.wc26.label} status="Results, bracket and the model's record" />
        </div>
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
