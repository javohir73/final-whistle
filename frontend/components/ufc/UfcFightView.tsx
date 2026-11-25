"use client";

import { BackLink, Main } from "@/components/ui";
import { eventHref } from "@/lib/ufcDisplay";
import type { UfcBoutDetail } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { FightHero } from "./FightHero";
import { FightStatsCard, JudgesCard } from "./FightStats";
import { TaleOfTheTape } from "./TaleOfTheTape";

/** The fight page below the site frame: back to the card, the hero, then the
 *  tale of the tape and, once it is over, the stats and the scorecards. */
export function UfcFightView({ bout }: { bout: UfcBoutDetail }) {
  const { tz } = useTimezone();
  return (
    <>
      <nav aria-label="Back" className="pb-5">
        <BackLink href={eventHref(bout.event.slug)}>{bout.event.name}</BackLink>
      </nav>
      <FightHero bout={bout} tz={tz} />
      <Main className="mx-auto mt-6 w-full max-w-[900px]">
        <TaleOfTheTape bout={bout} />
        {bout.status === "finished" && <FightStatsCard bout={bout} />}
        {bout.judges && <JudgesCard bout={bout} />}
      </Main>
    </>
  );
}
