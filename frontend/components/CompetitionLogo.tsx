import { Monogram } from "@/components/ClubBadge";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { cn } from "@/lib/utils";

/** Official vector marks sourced 20 Nov 2026 (premierleague.com,
 *  bundesliga.com, uefa.com). Overrides `COMPETITIONS[id].logoSrc` until
 *  `lib/sports.ts` points at these files directly. */
const COMPETITION_LOGO_SRC: Partial<Record<CompetitionId, string>> = {
  epl: "/competitions/epl.svg",
  bundesliga: "/competitions/bundesliga.svg",
  ucl: "/competitions/ucl.svg",
};

/** The self-hosted logo path rendered for a competition, or null when it has
 *  no logo file (UFC), in which case CompetitionLogo draws a text mark. */
export function competitionLogoSrc(competition: CompetitionId): string | null {
  return COMPETITION_LOGO_SRC[competition] ?? COMPETITIONS[competition].logoSrc;
}

/**
 * Self-hosted competition logo in a fixed box (`size × size`, or
 * `width × height`), `object-fit: contain`, centred, straight on the white
 * ground: no plate, no border, no shadow.
 * - Default: `alt` = the competition name (e.g. "Premier League").
 * - `decorative`: the name is printed next to the logo → `alt=""` + aria-hidden.
 * `labelled` is the legacy opt-in for a named alt; naming is now the default.
 */
export function CompetitionLogo({
  competition,
  size = 28,
  width,
  height,
  fit,
  className,
  imageClassName,
  decorative = false,
  labelled,
}: {
  competition: CompetitionId;
  size?: number;
  width?: number;
  height?: number;
  fit?: "contain" | "cover";
  className?: string;
  imageClassName?: string;
  decorative?: boolean;
  /** @deprecated Named alt is the default now; pass `decorative` to hide it. */
  labelled?: boolean;
}) {
  const config = COMPETITIONS[competition];
  const src = competitionLogoSrc(competition);
  const canvasWidth = width ?? size;
  const canvasHeight = height ?? size;
  // No logo file (UFC): the same round monogram as a fighter, in the same box.
  if (src === null) {
    return (
      <span
        data-competition-logo={competition}
        className={cn("inline-grid shrink-0 place-items-center", className)}
        style={{ width: canvasWidth, height: canvasHeight }}
      >
        <Monogram label={config.label} initials="UFC" size={Math.min(canvasWidth, canvasHeight)} shape="round" decorative={decorative} />
      </span>
    );
  }
  const hidden = decorative && !labelled;
  // WC26: the only file on hand is the owner-supplied mark on a black field
  // (FIFA's own transparent version is white-on-transparent and vanishes on
  // white), so it keeps its centred square crop until a positive version is
  // supplied. Every other logo is `contain`.
  const imageFit = fit ?? (competition === "wc26" ? "cover" : "contain");
  return (
    <span
      data-competition-logo={competition}
      className={cn("inline-grid shrink-0 place-items-center", className)}
      style={{ width: canvasWidth, height: canvasHeight }}
    >
      {/* Self-hosted on purpose: no remote logo URLs (CSP, hotlink blocking). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={hidden ? "" : config.label}
        aria-hidden={hidden ? true : undefined}
        width={canvasWidth}
        height={canvasHeight}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{ width: canvasWidth, height: canvasHeight }}
        className={cn(
          "block max-w-none object-center",
          imageFit === "cover" ? "object-cover" : "object-contain",
          imageClassName,
        )}
      />
    </span>
  );
}
