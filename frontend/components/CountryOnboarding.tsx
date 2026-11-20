"use client";

import { useMemo } from "react";
import { Flag } from "@/components/Flag";
import { CountrySearch } from "@/components/CountrySearch";
import type { SelectedCountry } from "@/lib/useSelectedCountry";
import type { Team } from "@/lib/types";
import { COMPETITIONS } from "@/lib/sports";
import { Button, Card, H1_CLASS, PageHead, Tag, TextLink } from "@/components/ui";

const WC26_BASE = COMPETITIONS.wc26.basePath;

/** Quick-pick chips: the three hosts, then the strongest sides by Elo. */
function suggestions(teams: Team[]): Team[] {
  const hosts = teams.filter((t) => t.is_host);
  const hostIds = new Set(hosts.map((t) => t.id));
  const top = [...teams]
    .filter((t) => !hostIds.has(t.id))
    .sort((a, b) => (b.elo_rating ?? 0) - (a.elo_rating ?? 0))
    .slice(0, 6);
  return [...hosts, ...top];
}

/**
 * Country-first entry point for the World Cup hub (a past tournament). With no
 * selection it shows the chooser; once a country is picked it shows a focused
 * preview whose CTA (`onPredict`) opens that team's dashboard straight away —
 * the model's numbers are precomputed, so there is no progress theatre.
 * Fully anonymous.
 */
export function CountryOnboarding({
  teams,
  selection,
  onSelect,
  onPredict,
  onChangeCountry,
}: {
  teams: Team[];
  selection: SelectedCountry | null;
  onSelect: (team: Team) => void;
  onPredict: () => void;
  onChangeCountry: () => void;
}) {
  const selectedTeam = useMemo(
    () => (selection ? teams.find((t) => t.id === selection.team_id) ?? null : null),
    [teams, selection],
  );
  const picks = useMemo(() => suggestions(teams), [teams]);

  // ---- Selected: focused preview + Predict CTA ----
  if (selection) {
    const name = selectedTeam?.name ?? selection.team;
    return (
      <section className="mx-auto flex max-w-prose flex-col items-center py-12 text-center min-[900px]:py-16">
        <p className="text-notes font-medium text-muted">Your team</p>
        <div className="mt-6 flex flex-col items-center gap-4">
          <Flag team={name} size={72} decorative />
          <h1 className={H1_CLASS}>{name}</h1>
          {selectedTeam && (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-notes text-muted">
              {selectedTeam.fifa_rank != null && (
                <span>FIFA rank <span className="font-semibold text-ink">{selectedTeam.fifa_rank}</span></span>
              )}
              {selectedTeam.elo_rating != null && (
                <span>Elo <span className="font-semibold text-ink">{Math.round(selectedTeam.elo_rating)}</span></span>
              )}
              {selectedTeam.confederation && <span>{selectedTeam.confederation}</span>}
            </div>
          )}
        </div>

        <p className="mt-6 max-w-[46ch] text-muted">
          {name}&rsquo;s World Cup: matches, results and how the FinalWhistle model called them.
        </p>

        <div className="mt-8 flex flex-col items-center gap-2">
          <Button onClick={onPredict}>Show my team</Button>
          <button
            type="button"
            onClick={onChangeCountry}
            className="min-h-[44px] px-3 font-medium text-muted underline-offset-[3px] hover:text-ink hover:underline"
          >
            Choose a different country
          </button>
        </div>
      </section>
    );
  }

  // ---- No selection: the chooser ----
  return (
    <section>
      <PageHead
        eyebrow="World Cup 2026 · Past tournament"
        title={
          <>
            Choose your <span>World Cup team</span>
          </>
        }
        sub="Their matches, the model’s calls, and how those calls held up."
      />

      <Card pad className="max-w-[900px]">
        <CountrySearch teams={teams} onSelect={onSelect} />
      </Card>

      {picks.length > 0 && (
        <div className="mt-8 max-w-[900px]">
          <h2 className="text-notes font-medium text-muted">Popular picks</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {picks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-ground px-4 font-medium text-ink transition-colors hover:border-line-strong"
              >
                <Flag team={t.name} size={20} decorative />
                {t.name}
                {t.is_host && <Tag>Host</Tag>}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-notes text-muted">
        <span>Just browsing?</span>
        <TextLink href={`${WC26_BASE}/fixtures`}>Explore all matches</TextLink>
        <TextLink href={`${WC26_BASE}/bracket`}>Road to the final</TextLink>
      </p>
    </section>
  );
}
