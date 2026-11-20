"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readCompetitionCookie } from "@/lib/competitionPrefs";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

/** `/` is prerendered (ISR) on the Premier League's matchweek, because
 *  reading the fw_comp cookie on the server would make it dynamic. A visitor
 *  whose remembered competition is another one (chosen in the switcher, or
 *  seeded from their country by middleware) is sent to that competition's
 *  home -- the NRL to /nrl -- right after the first paint. Archives are never
 *  a default. */
export function HomeCompetitionSwitch({ shown }: { shown: CompetitionId }) {
  const router = useRouter();
  useEffect(() => {
    const stored = readCompetitionCookie();
    if (!stored || stored === shown) return;
    const c = COMPETITIONS[stored];
    if (!c.enabled || c.archived) return;
    router.replace(c.basePath);
  }, [router, shown]);
  return null;
}
