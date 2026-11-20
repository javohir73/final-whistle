import type { FormResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  W: "bg-brand-soft text-brand",
  D: "bg-chip text-muted",
  L: "bg-miss-soft text-miss",
};

const WORD: Record<string, string> = { W: "Won", D: "Drew", L: "Lost" };

/** A team's recent results as small W/D/L chips (most recent first), with the
 *  opponent and score spoken to screen readers. `limit` trims to the latest N. */
export function FormStrip({ form, limit }: { form: FormResult[]; limit?: number }) {
  const items = limit != null ? form.slice(0, limit) : form;
  if (!items.length) {
    return <p className="text-notes text-muted">No recent matches.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Recent form, latest first">
      {items.map((f, i) => {
        const text = `${WORD[f.result] ?? f.result} ${f.score_for}–${f.score_against} v ${f.opponent}`;
        return (
          <li
            key={i}
            title={text}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-full text-label font-semibold",
              TONE[f.result] ?? "bg-chip text-muted",
            )}
          >
            <span aria-hidden="true">{f.result}</span>
            <span className="sr-only">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
