import { cn } from "@/lib/utils";

/** Tier tones (direction G): HIGH brand on brand-soft, MEDIUM ink on the
 *  neutral chip, LOW muted on the chip. Low is never the miss colour -- a
 *  low-confidence call is not a loss. */
const STYLES: Record<string, string> = {
  High: "text-brand bg-brand-soft",
  Medium: "text-ink bg-chip",
  Low: "text-muted bg-chip",
};

/** High/Medium/Low confidence pill — soft tinted background, small solid dot. */
export function ConfidenceBadge({ level }: { level: string | null }) {
  if (!level) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label font-semibold",
        STYLES[level] ?? "text-muted bg-chip",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {level} confidence
    </span>
  );
}
