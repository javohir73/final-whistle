import { CompetitionLogo } from "@/components/CompetitionLogo";
import { Card, Note, TextLink } from "@/components/ui";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The model's predicted champion, hoisted from the top-`win_title` team in the
 *  knockout odds by app/play/page.tsx. Only built when a real probability
 *  exists -- when the simulation hasn't run (every win_title null) or the odds
 *  fetch fails, the card degrades to a plain link rather than print a fabricated
 *  number. `winTitle` is a 0-1 probability (pct() renders the %). */
export interface BracketChampion {
  team: string;
  winTitle: number;
}

/** The World Cup archive's way into the knockout bracket. It does not
 *  re-implement the bracket: it links to /football/wc26/bracket, where the
 *  real projection lives. Surfaces the model's champion when the server page
 *  resolved the knockout odds, else just the link. */
export function PlayBracketCard({
  champion,
  className,
}: {
  champion: BracketChampion | null;
  className?: string;
}) {
  return (
    <Card pad className={cn("flex items-center gap-4", className)}>
      <CompetitionLogo competition="wc26" size={44} decorative />
      <div className="min-w-0 flex-1">
        <h2 className="text-h2 font-semibold text-ink">Knockout bracket</h2>
        {champion && champion.winTitle >= 0.999 ? (
          <Note className="mt-1">
            Champions: <span className="font-semibold text-ink">{champion.team}</span>.
          </Note>
        ) : champion ? (
          <Note className="mt-1">
            The model’s champion: <span className="font-semibold text-ink">{champion.team}</span>,{" "}
            <span className="tabular-nums">{pct(champion.winTitle)}</span> to lift the trophy.
          </Note>
        ) : (
          <Note className="mt-1">The model’s path through the knockouts.</Note>
        )}
        <p className="mt-3">
          <TextLink href="/football/wc26/bracket">See the bracket</TextLink>
        </p>
      </div>
    </Card>
  );
}
