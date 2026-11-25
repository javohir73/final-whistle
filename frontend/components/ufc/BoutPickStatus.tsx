"use client";

/** The right-hand side of a fight row on a card: the player's pick, an invitation to make one, or
 *  what the model said. The card is server-rendered for everyone, so this renders only an empty,
 *  fixed-height slot until the picks arrive in the browser (and keeps it empty if they never do). */
import type { ReactNode } from "react";
import { Chip, GhostButton } from "@/components/ui";
import { boutHref, isTba } from "@/lib/ufcDisplay";
import { modelLine, pickLine, pickOpenByClock, pickVerdict } from "@/lib/ufcPicks";
import type { UfcBoutSummary, UfcMyBout, UfcPick } from "@/lib/ufcTypes";
import { useUfcPicks } from "./UfcPicksProvider";

/** A cancelled fight keeps its "Cancelled" chip, and a fight with a placeholder fighter never
 *  offers or shows a pick: neither gets a slot. */
export function hasPickSlot(bout: UfcBoutSummary): boolean {
  return bout.status !== "cancelled" && !isTba(bout.fighter_a) && !isTba(bout.fighter_b);
}

/** Can this player still pick this fight? The server's word, closed early by the viewer's clock
 *  when it is known (the clock may close a control, never open one). A picked fight is never open. */
export function boutIsOpen(bout: UfcBoutSummary, mine: UfcMyBout | undefined, now: Date | null): boolean {
  if (mine?.pick) return false;
  if (!hasPickSlot(bout)) return false;
  // A fight the server did not list is never opened by the client.
  const byServer = mine ? mine.picks_open : false;
  const byClock = now ? pickOpenByClock(bout, now) : bout.status === "scheduled" && bout.scheduled_utc != null;
  return byServer && byClock;
}

// Room is held only where every player who can play will get something: a scheduled fight with a
// time shows the button, or the pick, or "Picks closed". Finished and live rows grow only for a
// player who picked them (as football's graded rows do); and the room is given back when the picks
// cannot be read, so a row never keeps a hole that nothing will fill.
const SLOT = "flex flex-col items-center justify-center min-[900px]:items-end";
const RESERVE = "min-h-[44px]";

const shortVerdict = (pick: UfcPick, label: string) => (pick.state === "void" ? "Void" : (label.split(" · ").pop() ?? label));

const Line = ({ children }: { children: ReactNode }) => (
  <span className="block text-notes leading-[1.4] text-muted">{children}</span>
);

export function BoutPickStatus({ bout, now }: { bout: UfcBoutSummary; now: Date | null }): ReactNode {
  const picks = useUfcPicks();
  const ready = picks != null && picks.status !== "loading" && picks.data != null;
  const mine = ready ? picks.myBout(bout.id) : undefined;
  const failed = picks != null && (picks.status === "error" || picks.status === "no-device");
  const reserve = picks != null && !failed && bout.status === "scheduled" && bout.scheduled_utc != null;
  const slot = (content: ReactNode) => (
    <div data-testid="pick-slot" className={reserve ? `${SLOT} ${RESERVE}` : SLOT}>
      {content}
    </div>
  );
  if (!ready || !hasPickSlot(bout)) return slot(null);

  const versus = `${bout.fighter_a.name} v ${bout.fighter_b.name}`;
  const call = mine?.model ?? bout.model ?? null;
  const pick = mine?.pick ?? null;

  if (pick) {
    const verdict = pickVerdict(pick);
    return slot(
      <>
        <Line>{pickLine(bout, pick)}</Line>
        {verdict ? (
          <Chip tone={verdict.tone} className="mt-1">
            {shortVerdict(pick, verdict.label)}
          </Chip>
        ) : (
          call && <Line>{modelLine(bout, call)}</Line>
        )}
      </>,
    );
  }
  if (boutIsOpen(bout, mine, now)) {
    return slot(
      <GhostButton href={`${boutHref(bout.id)}#pick`} aria-label={`Pick the winner of ${versus}`}>
        Pick winner
      </GhostButton>,
    );
  }
  if (bout.status === "scheduled") {
    // A scheduled fight the server did not list is closed to this player too: the slot is never an empty hole.
    return slot(bout.scheduled_utc ? <Line>Picks closed</Line> : null);
  }
  return slot(call ? <Line>{modelLine(bout, call)}</Line> : null);
}
