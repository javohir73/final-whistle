import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import {
  COMPETITIONS,
  competitionsForSport,
  competitionLinks,
  type Competition,
} from "@/lib/sports";
import { getCompetitionTournament } from "@/lib/tournament";
import type { ActiveTournament } from "@/lib/types";

// Static and evergreen: the registry decides what is listed, and the season
// line comes from the ISR-cached tournament lookups below.
export const revalidate = 300;

export const metadata: Metadata = {
  title: `Football predictions — ${APP_NAME}`,
  description:
    "Premier League, La Liga, Bundesliga and Champions League fixtures, tables and " +
    "explainable match predictions, plus the World Cup 2026 archive.",
  alternates: { canonical: "/football" },
};

/** "2026-27 season" from the backend's "Premier League 2026-27". Honest when
 *  unknown: a competition whose feed isn't loaded yet says so. */
function seasonLine(competition: Competition, tournament: ActiveTournament): string {
  if (competition.archived) return `Past tournament · ${tournament.year}`;
  if (tournament.id === 0) return "Season details unavailable";
  const season = tournament.name.match(/(\d{4}(?:[-–/]\d{2,4})?)\s*$/)?.[1];
  return season ? `${season} season` : tournament.name;
}

function CompetitionCard({
  competition,
  tournament,
}: {
  competition: Competition;
  tournament: ActiveTournament;
}) {
  const links = competitionLinks(competition.id);
  const home = { href: links.home };
  const fixtures = { href: links.fixtures, label: "Fixtures" };
  const table = { href: links.table, label: links.tableLabel };
  return (
    <li className="glass flex flex-col gap-4 rounded-2xl p-5">
      <Link href={home.href} className="group flex items-center gap-4">
        <CompetitionLogo competition={competition.id} size={52} />
        <span className="min-w-0">
          <span className="block font-display text-xl font-extrabold tracking-tight group-hover:text-lime-deep">
            {competition.label}
          </span>
          <span className="mt-0.5 block text-sm text-muted">{seasonLine(competition, tournament)}</span>
        </span>
      </Link>
      <nav aria-label={competition.label} className="flex flex-wrap gap-2 text-sm font-semibold">
        {[
          { href: fixtures.href, label: fixtures.label },
          { href: table.href, label: table.label },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-label={`${competition.label} ${link.label.toLowerCase()}`}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-surface-2 px-3 transition hover:text-lime-deep"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </li>
  );
}

/** The football hub: every football competition in the registry, live ones
 *  first and finished tournaments under "Past tournaments". /football was a
 *  404 -- and the old "Football" tab went straight to the Premier League. */
export default async function FootballHubPage() {
  const football = competitionsForSport("football").filter((c) => c.enabled);
  const tournaments = await Promise.all(football.map((c) => getCompetitionTournament(c.id)));
  const byId = new Map(football.map((c, i) => [c.id, tournaments[i]]));
  const current = football.filter((c) => !c.archived);
  const past = football.filter((c) => c.archived);

  return (
    <div className="space-y-10">
      <header>
        <p className="text-label font-bold uppercase tracking-[0.14em] text-lime-deep">Football</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Choose a competition
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Fixtures, tables and the model&apos;s call on every match — published with its
          uncertainty, graded on a public record.
        </p>
      </header>

      <section aria-labelledby="football-current">
        <h2 id="football-current" className="sr-only">
          Current competitions
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {current.map((c) => (
            <CompetitionCard key={c.id} competition={c} tournament={byId.get(c.id)!} />
          ))}
        </ul>
      </section>

      {past.length > 0 && (
        <section aria-labelledby="football-past">
          <h2
            id="football-past"
            className="mb-3 text-label font-semibold uppercase tracking-[0.08em] text-muted"
          >
            Past tournaments
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {past.map((c) => (
              <CompetitionCard key={c.id} competition={c} tournament={byId.get(c.id)!} />
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-border pt-6 text-sm text-muted">
        Rugby league?{" "}
        <Link
          href={COMPETITIONS.nrl.basePath}
          className="font-semibold text-foreground underline-offset-4 hover:text-lime-deep hover:underline"
        >
          Go to the NRL →
        </Link>
      </p>
    </div>
  );
}
