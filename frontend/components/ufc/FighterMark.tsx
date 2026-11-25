import { Monogram } from "@/components/ClubBadge";
import { fighterInitials } from "@/lib/ufcDisplay";

/** A fighter's round monogram: initials only, no photo. Decorative unless
 *  `decorative={false}`, because the row's link already names both fighters. */
export function FighterMark({
  name,
  size = 26,
  decorative = true,
}: {
  name: string;
  size?: number;
  decorative?: boolean;
}) {
  return <Monogram label={name} initials={fighterInitials(name)} size={size} shape="round" decorative={decorative} />;
}
