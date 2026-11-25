"use client";

import { BackLink, Main } from "@/components/ui";
import { eventHref } from "@/lib/ufcDisplay";
import type { UfcBoutDetail } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { BoutPick } from "./BoutPick";
import { FightHero } from "./FightHero";
import { FightStatsCard, JudgesCard } from "./FightStats";
import { TaleOfTheTape } from "./TaleOfTheTape";
import { UfcModelCallCard } from "./UfcModelCallCard";
import { UfcPicksProvider, useUfcPicks } from "./UfcPicksProvider";

/** The model's call sits first in the main column, but only when the payload carries one: the
 *  player's own (revealed once they pick or the fight locks) or the public one. Otherwise nothing. */
function ModelCall({ bout }: { bout: UfcBoutDetail }) {
  const call = useUfcPicks()?.myBout(bout.id)?.model ?? bout.model ?? null;
  return call ? <UfcModelCallCard bout={bout} call={call} /> : null;
}

/** The fight page below the site frame: back to the card, the hero with the pick, then the
 *  model's call (when there is one), the tale of the tape and, once it is over, the stats and
 *  the scorecards. */
export function UfcFightView({ bout }: { bout: UfcBoutDetail }) {
  const { tz } = useTimezone();
  return (
    <UfcPicksProvider eventSlug={bout.event.slug}>
      <nav aria-label="Back" className="pb-5">
        <BackLink href={eventHref(bout.event.slug)}>{bout.event.name}</BackLink>
      </nav>
      <FightHero bout={bout} tz={tz}>
        <BoutPick bout={bout} />
      </FightHero>
      <Main className="mx-auto mt-6 w-full max-w-[900px]">
        <ModelCall bout={bout} />
        <TaleOfTheTape bout={bout} />
        {bout.status === "finished" && <FightStatsCard bout={bout} />}
        {bout.judges && <JudgesCard bout={bout} />}
      </Main>
    </UfcPicksProvider>
  );
}
