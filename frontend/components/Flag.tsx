"use client";

import { useState } from "react";
import { Monogram } from "@/components/ClubBadge";
import { localFlag, teamInitials } from "@/lib/flags";
import { cn } from "@/lib/utils";

/** Round flag chip for national teams. Flags are self-hosted PNGs
 *  (`public/flags`) so they stay crisp at every chip size and load from our own
 *  origin. Default `alt` = the team name; pass `decorative` when the name is
 *  printed next to the flag. If a flag is missing (unmapped team or a stray
 *  load error) we show the neutral monogram, never a broken-image icon. */
export function Flag({
  team,
  size = 28,
  className,
  decorative = false,
}: {
  team: string;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const url = localFlag(team);
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <Monogram
        label={team}
        initials={teamInitials(team)}
        size={size}
        shape="round"
        decorative={decorative}
        className={className}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={decorative ? "" : team}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full object-cover ring-1 ring-line", className)}
      style={{ width: size, height: size }}
    />
  );
}
