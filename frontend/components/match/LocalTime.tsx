"use client";

import { useTimezone } from "@/lib/useTimezone";
import { kickoffTime, tzAbbrev } from "@/lib/datetime";

/** Backend timestamps are UTC but some serializers emit them naive (no
 *  offset); tag those as UTC so they never shift by the reader's offset. */
export function asUtcIso(iso: string): string {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
}

/** "2 Nov, 2:05 PM AEDT" in the reader's zone: a timestamp always names its
 *  zone. Falls back to the raw date when the string does not parse. */
export function formatLocalStamp(iso: string, tz: string): string {
  const utc = asUtcIso(iso);
  if (Number.isNaN(Date.parse(utc))) return iso.slice(0, 10);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(
    new Date(utc),
  );
  return `${day}, ${kickoffTime(utc, tz)} ${tzAbbrev(utc, tz)}`.trim();
}

/** Client island for a timestamp in the user's chosen timezone (the rest of
 *  the match page is server-rendered; the zone is client-only). */
export function LocalTime({ iso }: { iso: string }) {
  const { tz } = useTimezone();
  return <time dateTime={asUtcIso(iso)}>{formatLocalStamp(iso, tz)}</time>;
}
