/** Match-status semantics for the UI, mirroring backend/app/match_status.py.
 *
 *  Every football surface used to classify exactly three states — scheduled,
 *  in_play, finished — and treat "not live and not finished" as "upcoming".
 *  That was safe only while both ingest paths flattened the provider's
 *  postponed / cancelled / suspended into "scheduled". They no longer do (a
 *  flattened postponement made the freshness monitor fire forever), so any
 *  surface still assuming three states will render a cancelled fixture as an
 *  ordinary upcoming one: counting down to a kickoff that will not happen,
 *  offering an editable prediction on a match that has already been abandoned.
 *
 *  Import these rather than comparing strings, so the next status the provider
 *  invents is a one-line change here instead of a hunt through the components.
 */
import type { MatchStatus, MatchSummary } from "@/lib/types";
import { isLiveNow } from "@/lib/liveLabel";

export const STATUS_LABELS: Record<string, string> = {
  postponed: "Postponed",
  cancelled: "Cancelled",
  suspended: "Suspended",
};

const DELIBERATE_STOPS = new Set(["postponed", "cancelled", "suspended"]);

/** The provider told us this fixture is not proceeding as listed. */
export function isDeliberateStop(status: string | null | undefined): boolean {
  return !!status && DELIBERATE_STOPS.has(status);
}

/** Reader-facing label for a stopped fixture, or null when it is proceeding. */
export function stoppedLabel(status: string | null | undefined): string | null {
  return isDeliberateStop(status) ? STATUS_LABELS[status as string] ?? null : null;
}

/** Is a kickoff countdown / "starts in" treatment truthful for this fixture?
 *
 *  Only ``scheduled``. A postponed fixture keeps its ORIGINAL kickoff in the
 *  database, so counting down to it is actively wrong. */
export function showsKickoffCountdown(status: string | null | undefined): boolean {
  return status === "scheduled";
}

/** May the reader still enter or change a prediction?
 *
 *  Mirrors the backend's OPEN_FOR_PICKS exactly — the server is the authority
 *  (it returns 422 on a locked match) and this only decides whether to show
 *  the control. Postponed stays open: the fixture has not kicked off, so a
 *  pick is still meaningful once it is rescheduled. Anything unrecognised
 *  fails CLOSED, matching the backend. */
export function isPickable(status: string | null | undefined): boolean {
  return status === "scheduled" || status === "postponed";
}

/** Does this fixture have, or will it have, a result worth showing? A
 *  cancelled match never will. */
export function willBePlayed(status: string | null | undefined): boolean {
  return (
    status === "scheduled" ||
    status === "postponed" ||
    status === "in_play" ||
    status === "finished"
  );
}

/** Where a fixture is in its life, as a reader should be told it.
 *
 *  - `upcoming`  scheduled and not yet overdue.
 *  - `live`      in_play inside the live window (isLiveNow).
 *  - `stale`     the feed has stopped telling the truth: `in_play` stranded
 *                past the live window, or still `scheduled` long after its
 *                kickoff. Render "Result pending" with the last known score
 *                and NO verdict -- full time is never inferred.
 *  - `finished`  the feed confirmed full time.
 *  - `postponed` / `cancelled` / `suspended`  deliberate stops, passed through
 *                so pickability and copy can differ (postponed stays open).
 */
export type MatchPhase =
  | "upcoming"
  | "live"
  | "stale"
  | "finished"
  | "postponed"
  | "cancelled"
  | "suspended";

/** Reader-facing copy for the `stale` phase, shared by every surface (the
 *  scorebug prints it upper-case like FULL TIME). */
export const RESULT_PENDING = "Result pending";

/** How long after kickoff a still-`scheduled` fixture is presumed overdue:
 *  90' + half-time + stoppage with a generous margin. Inside this window a
 *  lagging feed is only lagging; past it the result is pending, not upcoming. */
export const STALE_AFTER_MINUTES = 150;

/** The one place a surface classifies a fixture. Prefer this to comparing
 *  `status` strings: the stale bucket only exists here. `now` is injectable
 *  for tests and for clients that tick a shared clock.
 *
 *  `now === null` means the clock is not known yet: a client component
 *  hydrating cached server HTML must classify exactly as the server did, so
 *  until the browser clock takes over the feed's own status decides (in_play
 *  is live, scheduled is upcoming) and the clock-based bounds apply one commit
 *  later. */
export function matchPhase(
  m: Pick<MatchSummary, "status" | "kickoff_utc">,
  now: Date | null = new Date(),
): MatchPhase {
  switch (m.status) {
    case "finished":
    case "postponed":
    case "cancelled":
    case "suspended":
      return m.status;
    case "in_play":
      if (!now) return "live";
      return isLiveNow(m, now) ? "live" : "stale";
    default: {
      if (!now) return "upcoming";
      // "scheduled", and anything the provider invents later: a fixture whose
      // kickoff is long past without a confirmed result is pending, never
      // upcoming (fails closed for an unknown status, like isPickable).
      if (!m.kickoff_utc) return "upcoming";
      const elapsedMin = (now.getTime() - new Date(m.kickoff_utc).getTime()) / 60_000;
      return elapsedMin > STALE_AFTER_MINUTES ? "stale" : "upcoming";
    }
  }
}

/** schema.org eventStatus, or null when no valid value exists.
 *
 *  schema.org models Scheduled / Postponed / Cancelled / Rescheduled /
 *  MovedOnline. There is NO term for a match that kicked off and was
 *  abandoned, so "suspended" returns null and the caller omits the markup
 *  entirely rather than asserting EventScheduled, which would tell crawlers
 *  the match is going ahead as planned. */
export function schemaEventStatus(status: string | null | undefined): string | null {
  switch (status) {
    case null:
    case undefined:
    case "scheduled":
    case "in_play":
    case "finished":
      return "https://schema.org/EventScheduled";
    case "postponed":
      return "https://schema.org/EventPostponed";
    case "cancelled":
      return "https://schema.org/EventCancelled";
    case "suspended":
      return null;
    default:
      return null;
  }
}

export type { MatchStatus };
