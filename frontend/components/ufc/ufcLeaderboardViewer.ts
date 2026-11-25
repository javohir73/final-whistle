import type { UfcLeaderboardEntry, UfcPicksSummaryResponse } from "@/lib/ufcTypes";

type Scope = { kind: "card"; slug: string } | { kind: "year"; year: number };

/** The row that is certainly this visitor's, or null. Handles are not unique and the board
 *  carries no player id, so a row counts only when it is not the model's, has the visitor's
 *  handle, has exactly the totals the visitor's own summary holds for this card or year, and
 *  is the only such row. Anything doubtful names nobody, so a stranger is never tagged "You". */
export function findViewerRow(
  entries: UfcLeaderboardEntry[],
  scope: Scope,
  summary: UfcPicksSummaryResponse | null,
): UfcLeaderboardEntry | null {
  if (!summary || !summary.handle) return null;
  const cards =
    scope.kind === "card"
      ? summary.cards.filter((c) => c.slug === scope.slug)
      : summary.cards.filter(
          (c) => c.first_bout_utc != null && new Date(c.first_bout_utc).getUTCFullYear() === scope.year,
        );
  if (cards.length === 0) return null;
  const points = cards.reduce((n, c) => n + c.points, 0);
  const winnerMethod = cards.reduce((n, c) => n + c.winner_method, 0);
  const hits = entries.filter(
    (e) => !e.is_model && e.handle === summary.handle && e.points === points && e.winner_method === winnerMethod,
  );
  return hits.length === 1 ? hits[0] : null;
}
