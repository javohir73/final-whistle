import { Chip } from "@/components/ui";
import { nrlDayMonth, nrlModelCall, wholePct } from "@/lib/nrlDisplay";
import type { NrlMatch } from "@/lib/types";

/** The right side of a finished NRL fixture (prototype `finalRow`): "Called it"
 *  / "Missed" + "Roosters 64%", or "No call" where the model made none. Only
 *  for FINISHED matches -- an open match never gets the model's numbers here. */
export function NrlCallVerdict({ match }: { match: NrlMatch }) {
  const call = nrlModelCall(match);
  if (!call || call.called == null) return <Chip>No call</Chip>;
  return (
    <span className="flex flex-col items-center gap-1 min-[900px]:items-end">
      <Chip tone={call.called ? "good" : "miss"}>{call.called ? "Called it" : "Missed"}</Chip>
      <span className="text-notes text-muted">
        {call.team} <b className="font-bold text-ink">{wholePct(call.probability)}</b>
      </span>
    </span>
  );
}

/** "4 October" over the venue, for the left of a finals/club row. */
export function DateVenue({ match }: { match: NrlMatch }) {
  return (
    <>
      {nrlDayMonth(match.kickoff_utc)}
      {match.venue ? (
        <>
          <br />
          {match.venue}
        </>
      ) : null}
    </>
  );
}
