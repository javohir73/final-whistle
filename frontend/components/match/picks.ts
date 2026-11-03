import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import type { CompetitionId } from "@/lib/sports";

/** Competitions whose match pages host the scored scoreline game. One source
 *  of truth with /play (lib/leagueConfig ACTIVE_LEAGUES): a league joins here
 *  the moment it joins there, so a pick made on a match page always shows up in
 *  /play and on the leaderboard. Kept free of React so link builders (the home
 *  hero) can ask without pulling the pick card into their bundle. */
export function isLeagueTipsCompetition(competition: CompetitionId): boolean {
  return ACTIVE_LEAGUES.includes(competition);
}

/** Does this competition's match page have a pick control at all? The scored
 *  league game, or the World Cup's W/D/L pick. */
export function hasMatchPagePick(competition: CompetitionId): boolean {
  return isLeagueTipsCompetition(competition) || competition === "wc26";
}
