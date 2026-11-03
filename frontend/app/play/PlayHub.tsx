"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { LeagueTipsPlaySection } from "@/components/leagueTips/LeagueTipsPlaySection";
import { NrlTipsPlaySection } from "@/components/nrl/NrlTipsPlaySection";
import { PlayBracketCard, type BracketChampion } from "@/components/play/PlayBracketCard";
import { PlayLeaderboard } from "@/components/play/PlayLeaderboard";
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import type { NrlTipsheet } from "@/lib/types";

/** "open": a round with something left to tip; "between-rounds": nothing to
 *  tip until the next round's draw; "complete": the season is over. */
export type NrlSeasonState = "open" | "between-rounds" | "complete";

interface PlayHubProps {
  /** Competition requested by `?competition=`: listed first and opened on
   *  arrival. Other sections open on tap, any number at a time. */
  selectedCompetition: CompetitionId;
  /** Current-round NRL tipsheet, server-fetched to seed the NRL section's
   *  season/round. Null when the endpoint has no data -- the section still
   *  renders, just as an honest empty state. */
  nrlTipsheet: NrlTipsheet | null;
  /** Where the NRL season stands (see app/play/page.tsx); null without a
   *  tipsheet. */
  nrlState: NrlSeasonState | null;
  /** Whether the World Cup has a knockout bracket to link to. */
  hasBrackets: boolean;
  /** Predicted champion surfaced on the bracket card, or null (plain link). */
  champion: BracketChampion | null;
}

/** Sections the hub can show: live football leagues, the NRL, and the World
 *  Cup under "Past tournaments". A competition without a live tips loop (the
 *  Champions League until its league-phase tips switch on) gets no row. */
type SectionId = CompetitionId;

function isLeague(id: CompetitionId): boolean {
  return ACTIVE_LEAGUES.includes(id) && COMPETITIONS[id].hasTips;
}

function hasSection(id: CompetitionId): boolean {
  return isLeague(id) || id === "nrl" || id === "wc26";
}

/** "Beat the model": every competition you can play against the model, the
 *  one you came for first, then the live leagues, then the NRL, with the
 *  finished World Cup collapsed under "Past tournaments". Every football
 *  league owns its picker and resolved matchweek; no league can borrow
 *  another competition's state. */
export function PlayHub({
  selectedCompetition,
  nrlTipsheet,
  nrlState,
  hasBrackets,
  champion,
}: PlayHubProps) {
  const [footballMatchweeks, setFootballMatchweeks] = useState<
    Partial<Record<string, number | null>>
  >({});
  const [open, setOpen] = useState<ReadonlySet<SectionId>>(
    () => new Set(hasSection(selectedCompetition) ? [selectedCompetition] : []),
  );

  // A leaderboard chip (a link back here with a new ?competition=) opens that
  // section too, so its picker can resolve the matchweek the board needs.
  useEffect(() => {
    if (!hasSection(selectedCompetition)) return;
    setOpen((prev) => (prev.has(selectedCompetition) ? prev : new Set(prev).add(selectedCompetition)));
  }, [selectedCompetition]);

  function toggle(id: SectionId) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setLeagueMatchweek(league: string, matchweek: number | null) {
    setFootballMatchweeks((current) => ({ ...current, [league]: matchweek }));
  }

  const leagues = ACTIVE_LEAGUES.filter((id) => isLeague(id as CompetitionId)) as CompetitionId[];
  const live: SectionId[] = [...leagues, "nrl"];
  const first = hasSection(selectedCompetition) ? selectedCompetition : null;
  const liveOrder = live.filter((id) => id !== first);
  const pastOrder: SectionId[] = first === "wc26" ? [] : ["wc26"];
  const unplayable = first == null ? COMPETITIONS[selectedCompetition] : null;

  function renderSection(id: SectionId) {
    const isOpen = open.has(id);
    if (isLeague(id)) {
      return (
        <PlayCompetitionSection
          key={id}
          competition={id}
          subtitle="Score predictions · 5 pts exact, 2 pts result"
          open={isOpen}
          onToggle={() => toggle(id)}
        >
          <div className="-mt-5">
            <LeagueTipsPlaySection
              defaultLeague={id}
              showLeaderboard={false}
              showLeagueSwitcher={false}
              onMatchweekResolved={(matchweek) => setLeagueMatchweek(id, matchweek)}
            />
          </div>
        </PlayCompetitionSection>
      );
    }
    if (id === "nrl") {
      const season = nrlTipsheet?.season;
      const subtitle =
        nrlState === "complete" && season != null
          ? `Season complete · back March ${season + 1}`
          : nrlTipsheet
            ? `Round ${nrlTipsheet.round} · ${nrlTipsheet.season}`
            : "Round tips";
      return (
        <PlayCompetitionSection
          key={id}
          competition="nrl"
          subtitle={subtitle}
          open={isOpen}
          onToggle={() => toggle(id)}
        >
          {/* Reused whole: the /nrl/tips beat-the-model loop (play the round,
              you vs the model), seeded with the same server-fetched
              season/round. Its weekly board is hoisted into the unified one
              below. Off-season it's one honest card instead; without a
              tipsheet we never invent a season/round. */}
          {nrlTipsheet == null ? (
            <div className="glass mt-3 rounded-2xl p-4">
              <p className="text-body text-muted">No NRL round is open for picks right now.</p>
            </div>
          ) : nrlState === "complete" ? (
            <NrlOffSeasonCard season={nrlTipsheet.season} />
          ) : (
            <NrlTipsPlaySection
              season={nrlTipsheet.season}
              round={nrlTipsheet.round}
              showLeaderboard={false}
              showConfidence
            />
          )}
        </PlayCompetitionSection>
      );
    }
    return (
      <PlayCompetitionSection
        key={id}
        competition="wc26"
        subtitle="Past tournament · knockout bracket"
        open={isOpen}
        onToggle={() => toggle(id)}
      >
        {hasBrackets ? (
          <PlayBracketCard champion={champion} className="mt-3" />
        ) : (
          <div className="glass mt-3 rounded-2xl p-4 text-body text-muted">
            The knockout bracket is not available.
          </div>
        )}
      </PlayCompetitionSection>
    );
  }

  return (
    <div>
      <p className="font-display text-label uppercase tracking-wider text-muted">Play</p>
      <h1 className="mt-1 font-display text-3xl font-extrabold">Beat the model</h1>
      <p className="mt-1.5 text-body text-muted">
        Pick the scores before kickoff, then see how you stack up against the model and everyone else.
      </p>

      {unplayable ? (
        <p role="status" className="glass mt-5 rounded-2xl p-4 text-body text-muted">
          {unplayable.label} picks aren&apos;t open yet.{" "}
          <Link href={`${unplayable.basePath}/fixtures`} className="font-semibold text-lime-deep hover:underline">
            See its fixtures and the model&apos;s predictions →
          </Link>
        </p>
      ) : null}

      {first ? renderSection(first) : null}
      {liveOrder.map(renderSection)}

      {pastOrder.length > 0 ? (
        <>
          <h2 className="mt-10 font-display text-label font-semibold uppercase tracking-wider text-muted">
            Past tournaments
          </h2>
          {pastOrder.map(renderSection)}
        </>
      ) : null}

      {/* One board for every competition (p5-s4). It reuses the same shipped
          LeagueTipsLeaderboard / NrlTipsLeaderboard the sections used to render
          inline -- filtered by competition, seeded with the NRL season/round and
          the per-league football matchweeks resolved above. NRL off-season and
          football pre-resolution each show their own honest state. */}
      <PlayLeaderboard
        nrlSeason={nrlTipsheet?.season ?? null}
        nrlRound={nrlTipsheet?.round ?? null}
        footballLeagues={ACTIVE_LEAGUES}
        footballMatchweeks={footballMatchweeks}
        initialCompetition={selectedCompetition}
      />
    </div>
  );
}

function NrlOffSeasonCard({ season }: { season: number }) {
  return (
    <div className="glass mt-3 rounded-2xl p-4">
      <p className="font-display text-lg font-extrabold">{season} season complete</p>
      <p className="mt-1 text-body text-muted">
        Round tips are back for Round 1 in March {season + 1}. Your season is on the NRL leaderboard below.
      </p>
      <Link href="/nrl/record" className="mt-3 inline-flex text-sm font-semibold text-lime-deep hover:underline">
        The model&apos;s {season} record →
      </Link>
    </div>
  );
}

/** One accordion row: a heading-wrapped toggle (WAI-ARIA accordion pattern)
 *  and, only while open, its panel -- the fetch-bearing pickers mount when a
 *  player opens them, never all at once. */
function PlayCompetitionSection({
  competition,
  subtitle,
  open,
  onToggle,
  children,
}: {
  competition: CompetitionId;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const config = COMPETITIONS[competition];
  const buttonId = `play-competition-${competition}`;
  const panelId = `play-panel-${competition}`;

  return (
    <section className="mt-5" data-play-section={competition}>
      <h2 className="font-display text-xl font-extrabold">
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="-mx-4 flex min-h-[56px] w-[calc(100%+2rem)] items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-surface-2/50"
        >
          <CompetitionLogo competition={competition} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block">{config.label}</span>
            <span className="block font-sans text-label font-normal text-muted">{subtitle}</span>
          </span>
          <span aria-hidden className="text-muted">{open ? "−" : "+"}</span>
        </button>
      </h2>

      {open ? (
        <div id={panelId} role="region" aria-labelledby={buttonId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
