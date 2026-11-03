"use client";

import { useFavorites } from "@/lib/useFavorites";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** Star toggle for marking a team as a favorite (the team page header).
 *
 *  Never place it inside a link or another control: a <button> nested in an
 *  <a> is invalid HTML, and keyboard and screen-reader users cannot reach one
 *  without the other. Cards that sit inside a link show a static star for a
 *  favourited team instead (MatchCard's FavouriteMark). */
export function FavoriteStar({
  team,
  size = 16,
  className,
}: {
  team: string;
  size?: number;
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(team);

  return (
    <button
      type="button"
      onClick={() => {
        toggle(team);
        trackEvent("favorite_toggle", { team, favorited: !active });
      }}
      aria-pressed={active}
      aria-label={active ? `Remove ${team} from favorites` : `Add ${team} to favorites`}
      title={active ? "Favorited" : "Add to favorites"}
      className={cn(
        "-m-[10px] grid min-h-[44px] min-w-[44px] place-items-center rounded-md p-1 transition hover:bg-surface-2/70",
        active ? "text-gold" : "text-muted/50 hover:text-muted",
        className,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 2l3 6.5 7 .7-5.2 4.8 1.5 6.9L12 17.8 5.7 20.9l1.5-6.9L2 9.2l7-.7z" />
      </svg>
    </button>
  );
}
