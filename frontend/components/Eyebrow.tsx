import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import { cn } from "@/lib/utils";
import { CompetitionLogo } from "@/components/CompetitionLogo";

interface EyebrowProps {
  children: React.ReactNode;
  /** Kept for old callers; direction G eyebrows are always muted. */
  tone?: "lime" | "muted";
}

/** The small line above a heading: direction G's eyebrow (sentence case,
 *  15px/500, muted — the same style PageHead uses). */
export function Eyebrow({ children }: EyebrowProps) {
  return <p className={cn("text-notes font-medium text-muted")}>{children}</p>;
}

/** Competition chip: the real logo plus the short name on the neutral chip
 *  fill. G has one accent; a competition is identified by its logo. */
export function CompEyebrowChip({ comp }: { comp: CompetitionId }) {
  const competition = COMPETITIONS[comp];
  return (
    <span className="inline-flex min-h-[28px] items-center gap-1.5 rounded-full bg-chip py-0.5 pl-1 pr-2.5 text-label font-semibold text-ink">
      <CompetitionLogo competition={comp} size={20} decorative />
      {competition.shortLabel}
    </span>
  );
}
