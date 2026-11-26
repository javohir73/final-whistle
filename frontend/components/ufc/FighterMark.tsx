import { Monogram } from "@/components/ClubBadge";
import { fighterInitials, isTba } from "@/lib/ufcDisplay";
import { fighterPhoto } from "@/lib/ufcFighterPhotos";

/** A fighter's round mark: a headshot when `slug` has a licensed photo, else the initials
 *  monogram. Either is exactly `size` square (an inline-sized `span`, which BoutRow's narrow-phone
 *  rules resize). Decorative unless `decorative={false}`, because the row's link already names both. */
export function FighterMark({
  name,
  slug,
  size = 26,
  decorative = true,
}: {
  name: string;
  slug?: string | null;
  size?: number;
  decorative?: boolean;
}) {
  const photo = isTba({ name }) ? null : fighterPhoto(slug);
  if (photo) {
    return (
      <span
        data-fighter-photo={slug ?? undefined}
        className="inline-block shrink-0 select-none overflow-hidden rounded-full border border-line bg-soft"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.src}
          alt={decorative ? "" : name}
          aria-hidden={decorative ? true : undefined}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-full w-full max-w-none object-cover"
          style={{ objectPosition: `center ${photo.focusY ?? 25}%` }}
        />
      </span>
    );
  }
  return <Monogram label={name} initials={fighterInitials(name)} size={size} shape="round" decorative={decorative} />;
}
