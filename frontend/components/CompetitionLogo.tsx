import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { cn } from "@/lib/utils";

/**
 * Self-hosted competition identity. A fixed transparent canvas keeps every
 * mark aligned without introducing a white tile around the artwork.
 */
export function CompetitionLogo({
  competition,
  size = 28,
  width,
  height,
  fit,
  className,
  imageClassName,
  labelled = false,
}: {
  competition: CompetitionId;
  size?: number;
  width?: number;
  height?: number;
  fit?: "contain" | "cover";
  className?: string;
  imageClassName?: string;
  labelled?: boolean;
}) {
  const config = COMPETITIONS[competition];
  const canvasWidth = width ?? size;
  const canvasHeight = height ?? size;
  const imageFit = fit ?? (competition === "wc26" ? "cover" : "contain");
  return (
    <span
      data-competition-logo={competition}
      className={cn("grid shrink-0 place-items-center", className)}
      style={{ width: canvasWidth, height: canvasHeight }}
    >
      {/* The assets are deliberately self-hosted: the prototype's remote logo
          URLs are vulnerable to CSP and hotlink blocking. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={config.logoSrc}
        alt={labelled ? `${config.label} logo` : ""}
        aria-hidden={labelled ? undefined : true}
        width={canvasWidth}
        height={canvasHeight}
        loading="lazy"
        decoding="async"
        className={cn(
          "h-full w-full drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]",
          imageFit === "cover" ? "object-cover" : "object-contain",
          competition === "wc26" ? "object-center p-0" : "p-[4%]",
          imageClassName,
        )}
      />
    </span>
  );
}
