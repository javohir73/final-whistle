import { ClubBadge } from "@/components/ClubBadge";
import { Flag } from "@/components/Flag";
import { localFlag } from "@/lib/flags";

/**
 * Chooses the right visual identity for a football team name: national teams
 * keep their flag, while clubs use their real crest (neutral monogram if none
 * is on file). Same props as ClubBadge/Flag: `decorative` when the name is
 * printed next to it.
 */
export function TeamBadge({
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
  return localFlag(team) ? (
    <Flag team={team} size={size} className={className} decorative={decorative} />
  ) : (
    <ClubBadge name={team} size={size} className={className} decorative={decorative} />
  );
}
