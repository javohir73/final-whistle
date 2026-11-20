"use client";

import { useTimezone } from "@/lib/useTimezone";
import { kickoffDate, kickoffTime, tzAbbrev } from "@/lib/datetime";

/** The embed's kick-off in the reader's own timezone (client island; the
 *  server pass renders UTC and the browser swaps in the local zone).
 *  `part="time"` → "5:30 pm"; `part="day"` → "Sat 21 Nov · GMT". */
export function EmbedKickoff({ iso, part }: { iso: string; part: "time" | "day" }) {
  const { tz } = useTimezone();
  return <>{part === "time" ? kickoffTime(iso, tz) : `${kickoffDate(iso, tz)} · ${tzAbbrev(iso, tz)}`}</>;
}
