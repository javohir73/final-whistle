"use client";

import { useEffect, useMemo, useState } from "react";
import { getNrlMatches } from "@/lib/api";
import { finishedRounds, liveNow, upcomingRounds } from "@/lib/nrlLive";
import type { NrlMatchesResponse } from "@/lib/types";
import Link from "next/link";
import { Card, DayBand, Note, PageHead, Segmented } from "@/components/ui";
import { NrlFixtureRow, NrlRoundCard } from "@/components/nrl/NrlRoundCard";

type Filter = "Upcoming" | "Live" | "Finished";
const FILTERS: Filter[] = ["Upcoming", "Live", "Finished"];

const EMPTY: Record<Filter, string> = {
  Upcoming: "No upcoming fixtures yet.",
  Live: "No matches are live right now.",
  Finished: "No finished fixtures yet.",
};

/** Client island: segmented Upcoming/Live/Finished over the SSR-seeded fixtures.
 *  A 30s local clock tick runs unconditionally so a match self-promotes into the
 *  live strip at kickoff even if none was live on first paint; the 30s data
 *  refetch stays gated on ≥1 live match. */
export function MatchesClient({ initial }: { initial: NrlMatchesResponse }) {
  const [fixtures, setFixtures] = useState(initial);
  // Off-season nothing is upcoming: open on the results instead of an empty tab.
  const [filter, setFilter] = useState<Filter>(() =>
    upcomingRounds(initial.rounds).length === 0 &&
    liveNow(initial.rounds).length === 0 &&
    finishedRounds(initial.rounds).length > 0
      ? "Finished"
      : "Upcoming",
  );
  const [now, setNow] = useState(() => new Date());

  const live = useMemo(() => liveNow(fixtures.rounds, now), [fixtures, now]);

  // Clock tick: local only, always on — this is what detects a match entering or
  // leaving its live window, so it can't be gated behind `live.length` or a fixture
  // that kicks off after first paint would never flip the strip on.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, []);

  // Always refresh once on mount (and when liveness changes), because the SSR
  // seed can be up to 5m old even after a just-finished match has left the live
  // window. Repeated network polling remains gated to live matches only.
  useEffect(() => {
    const refresh = () => {
      Promise.resolve(getNrlMatches()).then(setFixtures).catch(() => {});
    };
    refresh();
    if (live.length === 0) return;
    const tick = setInterval(refresh, 30_000);
    return () => clearInterval(tick);
  }, [live.length]);

  const groups = useMemo(
    () => (filter === "Finished" ? finishedRounds(fixtures.rounds) : upcomingRounds(fixtures.rounds, now)),
    [fixtures, filter, now],
  );

  const showStrip = filter !== "Finished" && live.length > 0;
  const empty =
    (filter === "Live" && live.length === 0) ||
    (filter !== "Live" && groups.length === 0 && !showStrip);

  return (
    <>
      <PageHead
        eyebrow={`NRL · ${fixtures.season} season`}
        title="Fixtures"
        actions={
          <Segmented
            label="Show"
            items={FILTERS.map((f) => ({ label: f, current: f === filter, onSelect: () => setFilter(f) }))}
          />
        }
      />
      <div className="flex max-w-[1100px] flex-col gap-6">
        {/* Live strip: every in-window match, pinned above the rounds. */}
        {showStrip ? (
          <Card flush aria-label="Live now">
            <DayBand as="h2" className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-miss motion-reduce:animate-none" aria-hidden />
              Live now
            </DayBand>
            {live.map(({ round, match }) => (
              <NrlFixtureRow
                key={`${round}-${match.match_no}`}
                match={match.score_home != null && match.score_away != null ? { ...match, status: "in_play" } : match}
                season={fixtures.season}
                round={round}
                tipping={false}
              />
            ))}
          </Card>
        ) : null}

        {filter !== "Live"
          ? groups.map((g) => (
              <section key={`round-${g.round ?? "tbc"}`} aria-labelledby={`nrl-round-${g.round ?? "tbc"}`}>
                <h2 id={`nrl-round-${g.round ?? "tbc"}`} className="mb-3 text-h2 font-semibold text-ink">
                  {g.round != null ? (
                    <Link href={`/nrl/round/${g.round}`} className="no-underline hover:underline">
                      Round {g.round}
                    </Link>
                  ) : (
                    "Round TBC"
                  )}
                </h2>
                <NrlRoundCard
                  season={fixtures.season}
                  round={g.round}
                  matches={g.matches}
                  label={`Round ${g.round ?? "TBC"}`}
                  tipping={filter === "Upcoming"}
                />
              </section>
            ))
          : null}

        {empty ? <Note>{EMPTY[filter]}</Note> : null}
      </div>
    </>
  );
}
