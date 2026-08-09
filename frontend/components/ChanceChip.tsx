import { cn } from "@/lib/utils";

/** Market-style probability chip: bold % plus an optional daily delta. */
export function ChanceChip({
  prob,
  deltaText,
  tone,
  surface = "default",
}: {
  prob: number;
  deltaText: string | null;
  tone: "up" | "down" | "muted";
  surface?: "default" | "pitch";
}) {
  return (
    <span
      className={cn(
        "min-w-[58px] rounded-lg px-2 py-1 text-right text-sm font-extrabold tabular-nums",
        tone === "up" && cn("bg-win/10 ring-1 ring-win/20", surface === "pitch" ? "text-pitch-accent-ink" : "text-lime-deep"),
        tone === "down" && cn("bg-loss/10 ring-1 ring-loss/20", surface === "pitch" ? "text-pitch-loss-ink" : "text-loss"),
        tone === "muted" && (surface === "pitch" ? "bg-pitch-chip text-pitch-muted-ink" : "bg-surface-2 text-muted"),
      )}
    >
      {Math.round(prob * 100)}%
      {deltaText ? <small className="block text-mini font-bold">{deltaText}</small> : null}
    </span>
  );
}
