"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getMatchSummary } from "@/lib/api";
import { kickoffDate, kickoffTime } from "@/lib/datetime";
import { stoppedLabel } from "@/lib/matchStatus";
import { pickGameFor } from "@/lib/reveal";
import { asFootballCompetition, footballMatchHrefOrLookup, type CompetitionId } from "@/lib/sports";
import { useModelRevealMap, type ModelReveal, type RevealFixture } from "@/lib/useModelReveal";
import { useTimezone } from "@/lib/useTimezone";
import { scoreVerdict } from "@/components/play/pickVerdict";
import { hasScore, selectTeamFixtures, type TeamFixture } from "@/lib/teamFixtures";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { Chip, FixturePair, FixtureRow, GhostButton } from "@/components/ui";

type Score = { home: number; away: number };
export type { TeamFixture };
export { selectTeamFixtures };

const STAGE_LABEL: Record<string, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  third_place: "Third place",
  final: "Final",
};

/** The club page's fixture list (prototype `clubMatches`): FixtureRows with
 *  real crests, the score or kick-off, and on the right the matchweek home's
 *  reveal rule — an open fixture you have not picked offers "Pick score"; once
 *  your pick is locked it shows You / Model; a finished match shows how the
 *  model's call went. Rows link to the match page under `matchBasePath`, else
 *  the fixture's own competition, else the /match/:id lookup. */
export function TeamFixtures({
  matches,
  teamName,
  matchBasePath,
  badge = "flag",
  competition,
  all = false,
  upcoming = 2,
  now: nowIso,
}: {
  matches: TeamFixture[];
  teamName: string;
  matchBasePath?: string;
  badge?: "flag" | "club";
  /** The page's competition (drives the pick game and the reveal). */
  competition?: CompetitionId;
  /** List every fixture in date order instead of last result + next ones. */
  all?: boolean;
  upcoming?: number;
  /** The server's clock (ISO) so server and client pick the same rows. */
  now?: string;
}) {
  void teamName;
  const { tz } = useTimezone();
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const rows = useMemo(
    () => selectTeamFixtures(matches, { now, upcoming, all }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matches, nowIso, upcoming, all],
  );

  const compOf = (m: TeamFixture): CompetitionId | null =>
    competition ?? asFootballCompetition(m.competition);

  const fixtures = useMemo<RevealFixture[]>(
    () =>
      rows.flatMap((m) => {
        const c = competition ?? asFootballCompetition(m.competition);
        return c
          ? [{ competition: c, matchId: m.match_id, status: m.status, kickoffUtc: m.kickoff_utc, matchweek: m.matchweek ?? null }]
          : [];
      }),
    [rows, competition],
  );
  const reveals = useModelRevealMap(fixtures);

  // The model's score for an OPEN fixture is fetched only after the reveal
  // says this viewer may see it (their pick is locked).
  const [fetched, setFetched] = useState<Record<number, Score | null>>({});
  const revealKey = rows
    .map((m) => `${m.match_id}:${reveals.get(m.match_id).revealed ? 1 : 0}`)
    .join(",");
  useEffect(() => {
    for (const m of rows) {
      if (m.model || m.match_id in fetched) continue;
      if (!reveals.get(m.match_id).revealed) continue;
      const c = compOf(m);
      setFetched((prev) => ({ ...prev, [m.match_id]: null }));
      getMatchSummary(m.match_id, c ?? undefined)
        .then((s) => {
          const home = s.predicted_score?.home;
          const away = s.predicted_score?.away;
          if (home != null && away != null) {
            setFetched((prev) => ({ ...prev, [m.match_id]: { home, away } }));
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-notes text-muted min-[900px]:px-7">No fixtures scheduled yet.</p>;
  }

  return (
    <>
      {rows.map((m) => {
        const c = compOf(m);
        const href = matchBasePath ? `${matchBasePath}/${m.match_id}` : footballMatchHrefOrLookup(m.match_id, m.competition);
        const reveal = reveals.get(m.match_id);
        // m.model is only ever set where the server judged it public.
        const model = m.model ?? (reveal.revealed ? fetched[m.match_id] ?? null : null);
        const crest = (name: string) =>
          badge === "club" ? (
            <ClubBadge name={name} size={26} decorative />
          ) : (
            <TeamBadge team={name} size={26} decorative />
          );
        const time = m.kickoff_utc ? kickoffTime(m.kickoff_utc, tz).toLowerCase() : "TBC";
        const date = m.kickoff_utc ? kickoffDate(m.kickoff_utc, tz) : null;
        const label =
          m.matchweek != null
            ? `Matchweek ${m.matchweek}`
            : m.stage && STAGE_LABEL[m.stage]
              ? STAGE_LABEL[m.stage]
              : m.group ?? null;
        const scored = hasScore(m) && (m.status === "finished" || m.status === "in_play");
        return (
          <FixtureRow
            key={m.match_id}
            href={href}
            leftOnPhone
            left={
              <>
                {label && <span className="block">{label}</span>}
                {date && <span className="block">{date}</span>}
              </>
            }
            home={{ name: m.teams.home, crest: crest(m.teams.home) }}
            away={{ name: m.teams.away, crest: crest(m.teams.away) }}
            kickoff={time}
            score={scored ? { home: m.score_home as number, away: m.score_away as number } : undefined}
            right={rightSide(m, reveal, model, c, href)}
          />
        );
      })}
    </>
  );
}

function rightSide(
  m: TeamFixture,
  reveal: ModelReveal,
  model: Score | null,
  comp: CompetitionId | null,
  href: string,
): ReactNode {
  const pick = reveal.pick?.kind === "score" ? reveal.pick : null;
  if (m.status === "finished" && hasScore(m)) {
    const final = { home: m.score_home as number, away: m.score_away as number };
    if (!model) return <Chip>Full time</Chip>;
    const v = scoreVerdict(model, final);
    return (
      <FixturePair
        rows={[
          { label: <Chip tone={v.tone}>{v.label}</Chip>, value: null },
          { label: "Model", value: `${model.home}–${model.away}` },
        ]}
      />
    );
  }
  if (m.status === "in_play") {
    return model ? <FixturePair rows={[{ label: "Live · Model", value: `${model.home}–${model.away}` }]} /> : <Chip>Live</Chip>;
  }
  const stopped = stoppedLabel(m.status);
  if (stopped && m.status !== "postponed") return <Chip>{stopped}</Chip>;
  if (reveal.revealed) {
    const rows = [
      ...(pick ? [{ label: "You", value: `${pick.home}–${pick.away}`, you: true }] : []),
      ...(model ? [{ label: "Model", value: `${model.home}–${model.away}` }] : []),
    ];
    return rows.length ? <FixturePair rows={rows} /> : null;
  }
  if (pick) return <FixturePair rows={[{ label: "You", value: `${pick.home}–${pick.away}`, you: true }]} />;
  if (stopped) return <Chip>{stopped}</Chip>;
  if (comp && pickGameFor(comp) === "league_tips") {
    return (
      <GhostButton href={href} aria-label={`Pick the score for ${m.teams.home} v ${m.teams.away}`}>
        Pick score
      </GhostButton>
    );
  }
  return null;
}
