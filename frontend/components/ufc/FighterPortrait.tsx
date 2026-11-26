import { fighterInitials, isTba } from "@/lib/ufcDisplay";
import { fighterPhoto, photoCredit } from "@/lib/ufcFighterPhotos";

/** Colours of the dark band the portraits sit on (ink-green; the hex values live in tailwind.config.ts as `ufc.*`).
 *  Muted text is the lightest tint that still reads as secondary: 4.5:1+ on the band and the tile,
 *  including the 11px credit lines. */
export const BAND = {
  bg: "bg-ufc-band",
  text: "text-ufc-ink",
  muted: "text-ufc-muted",
  lime: "text-ufc-lime",
  tile: "bg-ufc-tile",
} as const;

type Size = "hero" | "banner";

/** Fixed 4:5 boxes, so a photo loading never moves the page. Phone: about 170px (hero) / 104px
 *  (banner); desktop (≥900px): 240x300 / 150x188. */
const WIDTH: Record<Size, string> = {
  hero: "max-w-[170px] min-[900px]:max-w-[240px]",
  banner: "max-w-[104px] min-[900px]:max-w-[150px]",
};
const INITIALS: Record<Size, string> = {
  hero: "text-[56px] min-[900px]:text-[80px]",
  banner: "text-[34px] min-[900px]:text-[48px]",
};

/** A tall portrait panel: the fighter's licensed photo (with its credit line underneath) or,
 *  without one (and always for a TBA fighter), the initials tile. The name sits beside it on every
 *  page that uses this, so the tile is hidden from assistive tech and the photo's alt is the name. */
export function FighterPortrait({
  fighter,
  weightClass,
  size = "hero",
  priority = false,
}: {
  fighter: { slug?: string | null; name: string };
  weightClass?: string | null;
  size?: Size;
  /** Above the fold: load now rather than lazily. */
  priority?: boolean;
}) {
  const photo = isTba(fighter) ? null : fighterPhoto(fighter.slug);
  return (
    <figure data-portrait={photo ? "photo" : "tile"} className={`m-0 w-full ${WIDTH[size]}`}>
      <div
        className={`relative aspect-[4/5] w-full overflow-hidden rounded-[14px] min-[900px]:rounded-[18px] ${BAND.tile}`}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.src}
            alt={fighter.name}
            width={640}
            height={800}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            className="absolute inset-0 block h-full w-full max-w-none object-cover"
            style={{ objectPosition: `center ${photo.focusY ?? 25}%` }}
          />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center gap-1 pb-1">
            <span className={`font-display font-bold leading-none tracking-[-0.03em] ${BAND.text} ${INITIALS[size]}`}>
              {fighterInitials(fighter.name)}
            </span>
            {weightClass && (
              <span className={`px-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] ${BAND.muted}`}>
                {weightClass}
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 h-1 bg-ufc-lime" />
          </div>
        )}
      </div>
      {photo && (
        <figcaption className="text-center">
          <a
            href={photo.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-[44px] items-center justify-center px-1 text-[11px] leading-tight underline underline-offset-2 ${BAND.muted}`}
          >
            {photoCredit(photo)}
          </a>
        </figcaption>
      )}
    </figure>
  );
}
