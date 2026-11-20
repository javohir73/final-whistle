/** The reveal rule: may this viewer see the model's call for this fixture now?
 *
 *  On an OPEN fixture the model's score, its win/draw/loss chances, its
 *  confidence, its reasons and its goal chances stay hidden until the viewer
 *  has LOCKED a pick for that fixture. Once the fixture has kicked off (or is
 *  finished, stopped mid-match or cancelled) nobody can pick it any more, so
 *  the call is shown to everyone.
 *
 *  This file is the ONE place the rule lives. It is pure (no React, no
 *  storage, no fetch) so server components, client hooks and tests all ask the
 *  same question. The client hooks that find the viewer's locked pick live in
 *  lib/useModelReveal.ts. See notes/REVEAL.md in the redesign scratch folder
 *  for usage. */
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import type { CompetitionId } from "@/lib/sports";

export type RevealReason =
  /** The feed confirmed full time. */
  | "finished"
  /** In play, suspended mid-match, or a scheduled fixture whose kickoff has
   *  passed by the clock (the feed lags): picks are closed. */
  | "kicked_off"
  /** Cancelled: it will never be played or picked. */
  | "closed"
  /** Open, and the viewer has a locked pick for it. */
  | "locked_pick"
  /** Open, but the competition has no pick game (nothing to protect). */
  | "no_pick_game"
  /** Open and not picked (or the pick is not known yet): hide the model. */
  | "hidden";

export interface RevealDecision {
  revealed: boolean;
  reason: RevealReason;
}

/** Which pick game a competition's fixtures belong to, or null for none. */
export type PickGame = "league_tips" | "nrl_tips" | "wc_outcome";

/** One source of truth with /play and the match page (ACTIVE_LEAGUES): the
 *  scored scoreline game for club leagues, NRL winner tips, the World Cup's
 *  archived W/D/L pick. The Champions League has no game until its league
 *  stage is loaded into /tips (lib/leagueConfig). */
export function pickGameFor(competition: CompetitionId | string): PickGame | null {
  if (ACTIVE_LEAGUES.includes(competition)) return "league_tips";
  if (competition === "nrl") return "nrl_tips";
  if (competition === "wc26") return "wc_outcome";
  return null;
}

export interface RevealInput {
  /** The fixture's feed status (scheduled, in_play, finished, postponed,
   *  cancelled, suspended, or anything newer). */
  status: string | null | undefined;
  /** Kickoff, UTC ISO. */
  kickoff: string | null | undefined;
  /** The clock. `null` = not known yet (a client component hydrating cached
   *  server HTML): decide by status alone, so the first client pass matches
   *  the server. The kickoff-by-clock check applies once a clock exists. */
  now: Date | null;
  /** The viewer has a LOCKED (server-accepted) pick for this fixture. A draft
   *  never counts. Pass false while the pick is still loading. */
  hasLockedPick: boolean;
  /** Does this fixture's competition have a pick game? Default true: when in
   *  doubt, hide. Pass `pickGameFor(competition) != null`. */
  pickGame?: boolean;
  /** "picker" (default): the person on the page, whose own pick unlocks it.
   *  "public": someone else's eyes (embeds, share pages, OG images, page
   *  metadata, JSON-LD): a pick never unlocks an open fixture. */
  viewer?: "picker" | "public";
}

/** The rule. Order matters: a fixture past the point of picking is revealed
 *  whatever the pick state; an open one only for its own locked picker. */
export function revealDecision({
  status,
  kickoff,
  now,
  hasLockedPick,
  pickGame = true,
  viewer = "picker",
}: RevealInput): RevealDecision {
  switch (status) {
    case "finished":
      return { revealed: true, reason: "finished" };
    case "in_play":
    case "suspended":
      return { revealed: true, reason: "kicked_off" };
    case "cancelled":
      return { revealed: true, reason: "closed" };
    case "postponed":
      // Still open for picks (backend OPEN_FOR_PICKS), and it keeps its
      // ORIGINAL kickoff, so the clock must not unlock it.
      break;
    default: {
      // "scheduled", missing, or a status the provider invents later: the
      // clock closes it at kickoff, before the feed flips.
      if (now && kickoff) {
        const t = Date.parse(kickoff);
        if (Number.isFinite(t) && now.getTime() >= t) return { revealed: true, reason: "kicked_off" };
      }
    }
  }
  if (!pickGame) return { revealed: true, reason: "no_pick_game" };
  if (viewer === "picker" && hasLockedPick) return { revealed: true, reason: "locked_pick" };
  return { revealed: false, reason: "hidden" };
}

/** Boolean shorthand for revealDecision. */
export function canRevealModel(input: RevealInput): boolean {
  return revealDecision(input).revealed;
}

/** For server-rendered text read by people who are not the picker (page
 *  <title>, meta description, openGraph, OG images, JSON-LD, embeds, share
 *  cards): true only when the fixture is past the point of picking, or its
 *  competition has no pick game. Pass the server's render time as `now`
 *  (ISR: the text is only as fresh as the render). */
export function canRevealModelPublicly(
  competition: CompetitionId | string,
  status: string | null | undefined,
  kickoff: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return revealDecision({
    status,
    kickoff,
    now,
    hasLockedPick: false,
    pickGame: pickGameFor(competition) != null,
    viewer: "public",
  }).revealed;
}

/** One line for the hidden state, so every screen says the same thing. */
export const MODEL_HIDDEN_NOTE = "The model’s call for a match appears once you lock yours.";
