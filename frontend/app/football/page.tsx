import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { Card, PageHead, TextLink } from "@/components/ui";
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

function CompetitionRow({
  competition,
  tournament,
}: {
  competition: Competition;
  tournament: ActiveTournament;
}) {
  const links = competitionLinks(competition.id);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line-soft px-4 py-4 first:border-t-0 min-[900px]:px-7">
      <Link href={links.home} className="group flex min-h-[44px] min-w-0 items-center gap-4 no-underline">
        <CompetitionLogo competition={competition.id} size={40} decorative />
        <span className="min-w-0">
          <span className="block font-semibold text-ink underline-offset-[3px] group-hover:underline">
            {competition.label}
          </span>
          <span className="block text-notes text-muted">{seasonLine(competition, tournament)}</span>
        </span>
      </Link>
      <nav aria-label={competition.label} className="flex flex-wrap gap-x-6 gap-y-1">
        {[
          { href: links.fixtures, label: "Fixtures" },
          { href: links.table, label: links.tableLabel },
        ].map((link) => (
          <TextLink
            key={link.href}
            href={link.href}
            aria-label={`${competition.label} ${link.label.toLowerCase()}`}
            className="inline-flex min-h-[44px] items-center"
          >
            {link.label}
          </TextLink>
        ))}
      </nav>
    </li>
  );
}

/** The football index: every football competition in the registry, live ones
 *  first and finished tournaments under "Past tournaments", each with its
 *  real logo. Calm list, no tiles. */
export default async function FootballHubPage() {
  const football = competitionsForSport("football").filter((c) => c.enabled);
  const tournaments = await Promise.all(football.map((c) => getCompetitionTournament(c.id)));
  const byId = new Map(football.map((c, i) => [c.id, tournaments[i]]));
  const current = football.filter((c) => !c.archived);
  const past = football.filter((c) => c.archived);

  return (
    <>
      <PageHead
        eyebrow="Football"
        title="Choose a competition"
        sub="Fixtures, tables and the model’s call on every match, published with its uncertainty."
      />
      <div className="flex max-w-[880px] flex-col gap-8">
        <section aria-labelledby="football-current">
          <h2 id="football-current" className="sr-only">
            Current competitions
          </h2>
          <Card as="div" flush>
            <ul>
              {current.map((c) => (
                <CompetitionRow key={c.id} competition={c} tournament={byId.get(c.id)!} />
              ))}
            </ul>
          </Card>
        </section>

        {past.length > 0 && (
          <section aria-labelledby="football-past">
            <h2 id="football-past" className="mb-3 text-h2 font-semibold text-ink">
              Past tournaments
            </h2>
            <ul className="rounded-card border border-line bg-ground">
              {past.map((c) => (
                <CompetitionRow key={c.id} competition={c} tournament={byId.get(c.id)!} />
              ))}
            </ul>
          </section>
        )}

        <p className="text-muted">
          Rugby league? <TextLink href={COMPETITIONS.nrl.basePath}>Go to the NRL</TextLink>
        </p>
      </div>
    </>
  );
}
