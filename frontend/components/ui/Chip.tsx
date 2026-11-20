/** Status chips and tags.
 *
 *    <Chip>              neutral (#f2f4f1 / muted)  e.g. "No call", "Full time"
 *    <Chip tone="good">  brand fill, white          e.g. "Exact score"
 *    <Chip tone="ok">    brand-soft, brand text     e.g. "Right result"
 *    <Chip tone="miss">  miss-soft, miss text       e.g. "Missed"
 *    <Tag>               the small neutral tag next to a name, e.g. "Model"
 *
 *  All pairs clear WCAG AA for 13px text (see components/ui/__tests__).
 */
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "good" | "ok" | "miss";

export const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "bg-chip text-muted",
  good: "bg-brand text-white",
  ok: "bg-brand-soft text-brand",
  miss: "bg-miss-soft text-miss",
};

export function Chip({
  tone = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-label font-semibold leading-[18px]",
        CHIP_TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}

export function Tag({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-full bg-chip px-2 py-px align-middle text-label font-semibold leading-[18px] text-muted",
        className,
      )}
      {...rest}
    />
  );
}
