"use client";

import { useTimezone } from "@/lib/useTimezone";
import { Flag } from "@/components/Flag";
import { isLiveNow, liveLabel } from "@/lib/liveLabel";
import { kickoffTime, tzAbbrev } from "@/lib/datetime";
import type { MatchSummary } from "@/lib/types";
import { stoppedLabel } from "@/lib/matchStatus";
import { canRevealModelPublicly } from "@/lib/reveal";
import { footballMatchHref, type CompetitionId } from "@/lib/sports";
import { FixtureRow, KickoffBox, Note } from "@/components/ui";
import { formatScore } from "@/lib/format";

/** The group's fixtures as centred-spine rows inside the caller's flush card,
 *  in the user's timezone (kickoff time is client-only; the rest of the group
 *  page is server-rendered). Each spine links to the match. The model's
 *  scoreline shows on the right only once the fixture is past the point of
 *  picking (public reveal rule) — never on an open fixture. */
export function GroupFixtureList({
  matches,
  competition = "wc26",
}: {
  matches: MatchSummary[];
  /** Groups only exist where the registry says hasGroups -- the World Cup. */
  competition?: CompetitionId;
}) {
  const { tz } = useTimezone();
  if (matches.length === 0) {
    return <Note className="px-4 py-5 min-[900px]:px-7">Fixtures will appear once the draw is finalised.</Note>;
  }
  return (
    <>
      {matches.map((m) => (
        <GroupFixture key={m.match_id} match={m} tz={tz} competition={competition} />
      ))}
    </>
  );
}

function dayLabel(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", timeZone: tz }).format(
      new Date(iso),
    );
  } catch {
    return "";
  }
}

function GroupFixture({
  match,
  tz,
  competition,
}: {
  match: MatchSummary;
  tz: string;
  competition: CompetitionId;
}) {
  const { teams, predicted_score } = match;
  const live = isLiveNow(match);
  const finished = match.status === "finished" || (match.status === "in_play" && !live);
  const hasScore = match.score_home != null && match.score_away != null;
  const stopped = stoppedLabel(match.status);
  const showModel =
    predicted_score != null && canRevealModelPublicly(competition, match.status, match.kickoff_utc);

  const centre =
    (live || finished) && hasScore ? undefined : stopped ? (
      <KickoffBox>{stopped}</KickoffBox>
    ) : match.kickoff_utc ? (
      <KickoffBox>{kickoffTime(match.kickoff_utc, tz)}</KickoffBox>
    ) : (
      <KickoffBox>TBC</KickoffBox>
    );

  const left = live ? (
    <span className="font-semibold text-ink">{liveLabel(match)}</span>
  ) : match.kickoff_utc ? (
    finished || stopped
      ? dayLabel(match.kickoff_utc, tz)
      : `${dayLabel(match.kickoff_utc, tz)} · ${tzAbbrev(match.kickoff_utc, tz)}`
  ) : (
    "Kick-off to be confirmed"
  );

  const scoreText = hasScore ? formatScore(match.score_home, match.score_away) : "";
  return (
    <FixtureRow
      href={footballMatchHref(competition, match.match_id)}
      label={
        (live || finished) && hasScore
          ? `${teams.home} ${scoreText} ${teams.away}${live ? ", live" : ""}`
          : `${teams.home} v ${teams.away}${stopped ? `, ${stopped}` : ""}`
      }
      left={left}
      home={{ name: teams.home, crest: <Flag team={teams.home} size={26} decorative /> }}
      away={{ name: teams.away, crest: <Flag team={teams.away} size={26} decorative /> }}
      score={(live || finished) && hasScore ? { home: match.score_home!, away: match.score_away! } : undefined}
      centre={centre}
      right={
        showModel && predicted_score ? (
          <span className="text-notes text-muted">
            Model <b className="font-bold text-ink">{formatScore(predicted_score.home, predicted_score.away)}</b>
          </span>
        ) : undefined
      }
    />
  );
}
