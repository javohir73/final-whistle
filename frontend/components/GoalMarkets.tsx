import { Card } from "@/components/ui";
import { pct } from "@/lib/format";
import type { GoalMarkets as GoalMarketsData } from "@/lib/types";

/** "Goal chances" (direction G): four rows from the same Poisson
 *  distribution as the model's score -- over 2.5 goals, both teams score,
 *  and each team scoring. The per-team 2+/3+/4+ bands and over 1.5/3.5 were
 *  cut to keep the page calm (DECISIONS). Model numbers: render it only where
 *  the reveal rule allows. */
export function GoalMarkets({
  home,
  away,
  markets,
  id = "goals",
}: {
  home: string;
  away: string;
  markets: GoalMarketsData;
  id?: string;
}) {
  const rows: [string, number][] = [
    ["Over 2.5 goals", markets.total.over_2_5],
    ["Both teams score", markets.btts],
    [`${home} score`, markets.home.to_score],
    [`${away} score`, markets.away.to_score],
  ];
  return (
    <Card pad id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
      <h2 id={`${id}-heading`} className="text-h2 font-semibold text-ink">
        Goal chances
      </h2>
      <ul className="mt-4 list-none p-0">
        {rows.map(([label, value]) => (
          <li key={label} className="flex items-center justify-between gap-4 border-t border-line-soft py-3.5">
            <span className="font-medium text-ink">{label}</span>
            <b className="font-bold tabular-nums text-ink">{pct(value)}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}
