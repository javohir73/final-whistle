import { cn } from "@/lib/utils";

/** Market-style probability chip: bold % plus an optional daily delta. */
export function ChanceChip({
  prob,
  deltaText,
  tone,
  surface: _surface = "default",
}: {
  prob: number;
  deltaText: string | null;
  tone: "up" | "down" | "muted";
  surface?: "default" | "pitch";
}) {
  return (
    <span
      className={cn(
        "min-w-[58px] rounded-[10px] px-2 py-1 text-right text-notes font-semibold tabular-nums",
        tone === "up" && "bg-brand-soft text-brand",
        tone === "down" && "bg-miss-soft text-miss",
        tone === "muted" && "bg-chip text-muted",
      )}
    >
      {Math.round(prob * 100)}%
      {deltaText ? <small className="block text-label font-semibold">{deltaText}</small> : null}
    </span>
  );
}
