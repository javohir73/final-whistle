"use client";

/** "Your picks" in the card's rail: how the player is doing on this card. Until the picks arrive (and
 *  for a visitor who has not played) it reads as the explanation of the game, so the server-rendered
 *  card is the same for everyone and complete without any player data. */
import { useAuth } from "@/components/AuthProvider";
import { useClock } from "@/components/match/clock";
import { Card, CardHead, GhostButton, Note, TextLink } from "@/components/ui";
import { boutHref, isTba } from "@/lib/ufcDisplay";
import { UFC_SCORING } from "@/lib/ufcPicks";
import type { UfcEventDetail } from "@/lib/ufcTypes";
import { boutIsOpen } from "./BoutPickStatus";
import { useUfcPicks } from "./UfcPicksProvider";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function UfcPicksRailCard({ event }: { event: UfcEventDetail }) {
  const picks = useUfcPicks();
  const { user, openSignIn } = useAuth();
  const now = useClock();
  const bouts = (event.segments ?? []).flatMap((s) => s.bouts);
  if (bouts.length === 0 || event.status === "cancelled") return null;

  // Only this card's answer counts (a previous card's data may linger for a moment).
  const data = picks && picks.status !== "loading" && picks.data?.event.slug === event.slug ? picks.data : null;
  let picked = 0;
  let pickable = 0;
  if (data) {
    for (const b of bouts) {
      if (b.status === "cancelled" || isTba(b.fighter_a) || isTba(b.fighter_b)) continue;
      const mine = data.bouts.find((m) => m.bout_id === b.id);
      if (mine?.pick) {
        picked += 1;
        pickable += 1;
      } else if (boutIsOpen(b, mine, now)) pickable += 1;
    }
  }
  const changed = data?.changed_picks ?? [];
  const played = data != null && picked > 0;

  return (
    <Card pad aria-labelledby="ufc-your-picks">
      <CardHead id="ufc-your-picks" title="Your picks" />
      {played ? (
        <>
          <p className="mt-4 font-semibold text-ink">
            {picked} of {plural(pickable, "fight", "fights")} picked.
          </p>
          {data.totals.graded > 0 && (
            <Note className="mt-1">
              {plural(data.totals.points, "point", "points")} from {plural(data.totals.graded, "scored fight", "scored fights")}.
            </Note>
          )}
        </>
      ) : (
        <Note className="mt-4">Pick the winner of each fight, and how they win.</Note>
      )}
      <Note className="mt-1">{UFC_SCORING}</Note>
      {picks?.status === "no-device" && (
        <Note className="mt-3">Picks need your browser&apos;s storage to remember you. Allow site data to play.</Note>
      )}
      {picks?.status === "error" && (
        <div className="mt-3">
          <Note role="status">Your picks did not load.</Note>
          <TextLink onClick={() => picks.retry()} className="min-h-[44px] text-left">
            Try again
          </TextLink>
        </div>
      )}
      {/* Always here, empty until there is something to say, so a screen reader hears it arrive. */}
      <div role="status" className={changed.length > 0 ? "mt-4 space-y-3" : undefined}>
        {changed.map((c) => (
          <div key={c.bout_id}>
            <Note className="text-ink">
              Your pick on {c.fighter_a} v {c.fighter_b} doesn&apos;t count because the fight changed.
            </Note>
            {c.replaced_by_id != null && (
              <TextLink href={`${boutHref(c.replaced_by_id)}#pick`} className="mt-1">
                Pick the new fight
              </TextLink>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <TextLink href="/ufc/picks">My picks</TextLink>
        <TextLink href={`/ufc/leaderboard?event=${event.slug}`}>Leaderboard</TextLink>
      </div>
      {data != null && user == null && (
        <div className="mt-4">
          <Note>A free account keeps your picks across devices.</Note>
          <GhostButton onClick={() => openSignIn()} className="mt-2">
            Sign in
          </GhostButton>
        </div>
      )}
    </Card>
  );
}
