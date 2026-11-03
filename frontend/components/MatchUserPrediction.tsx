"use client";

import { UserPredictionCard } from "@/components/UserPredictionCard";
import { useMatchPicks } from "@/lib/useMatchPicks";
import { useTimezone } from "@/lib/useTimezone";
import type { MatchSummary } from "@/lib/types";

/** World Cup (knockout) adapter for the match page's pick: the anonymous,
 *  locally-stored W/D/L pick. Club-league match pages use the scored scoreline
 *  game instead (components/match/MatchPick), so this browser-only path now
 *  serves only the archived tournament. Orients the card around the home team
 *  (the detail page has no single followed country). `now` is the page's
 *  shared ticking clock, so the buttons lock at kickoff on an open tab. */
export function MatchUserPrediction({ match, now }: { match: MatchSummary; now?: Date }) {
  const { picks, setPick } = useMatchPicks();
  const { tz } = useTimezone();

  return (
    <UserPredictionCard
      match={match}
      country={match.teams.home}
      pick={picks[match.match_id]}
      onPick={(p) => setPick(match.match_id, p)}
      tz={tz}
      now={now}
    />
  );
}
