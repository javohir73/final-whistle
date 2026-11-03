import { cn } from "@/lib/utils";

/** Tier tones match ConfidenceRing and the Floodlight spec: HIGH lime, MEDIUM
 *  amber, LOW muted. Low is never rose -- a low-confidence call is not a loss,
 *  and rose on its own wash measured 4.39:1 (dark) / 2.94:1 (Daylight). */
const STYLES: Record<string, string> = {
  High: "text-lime-deep bg-win/15",
  Medium: "text-amber-ink bg-draw/15",
  Low: "text-muted bg-surface-2",
};

/** High/Medium/Low confidence pill — soft tinted background, small solid dot. */
export function ConfidenceBadge({ level }: { level: string | null }) {
  if (!level) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label font-semibold uppercase tracking-wide",
        STYLES[level] ?? "text-muted bg-surface-2",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {level} confidence
    </span>
  );
}
