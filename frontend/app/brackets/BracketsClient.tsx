"use client";

import { getGroups, getKnockoutOdds, getOfficialBracket } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { pct } from "@/lib/format";
import { Flag } from "@/components/Flag";
import { ErrorState } from "@/components/States";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { buildTree } from "@/lib/officialBracket";
import { COMPETITIONS } from "@/lib/sports";
import OfficialBracket from "@/components/OfficialBracket";
import { Card, Note, PageHead } from "@/components/ui";
import type { Group, TournamentOdds, KnockoutBracket } from "@/lib/types";
import Link from "next/link";
import { useState } from "react";

const WC26_BASE = COMPETITIONS.wc26.basePath;

/** Segmented-control look (".seg") with tab semantics: the two views are
 *  panels of one page, not separate URLs. */
const SEG_ITEM =
  "inline-flex min-h-[40px] items-center rounded-full px-5 font-medium text-muted transition-colors hover:text-ink";
const SEG_ON = "bg-ground font-semibold text-ink shadow-seg";

export function BracketsClient({
  initialOdds,
  initialGroups,
  initialBracket,
}: {
  initialOdds?: TournamentOdds[];
  initialGroups?: Group[];
  initialBracket?: KnockoutBracket;
}) {
  const [view, setView] = useState<"official" | "ai">("official");
  // getGroups is still fetched so the simulation pipeline stays warm and the
  // route's data contract is unchanged, even though the model view now reads
  // only the knockout odds.
  const oddsState = useFetch(getKnockoutOdds, [], undefined, initialOdds);
  useFetch(() => getGroups("wc26"), [], undefined, initialGroups);
  const bracketState = useFetch(getOfficialBracket, [], 30_000, initialBracket);

  return (
    <div>
      <PageHead
        eyebrow="World Cup 2026"
        title={view === "official" ? "Official bracket" : "The model's bracket"}
        sub={
          view === "official"
            ? "Every knockout tie from the Round of 32 to the final. Choose a tie for the match."
            : "The model's most likely path, from thousands of tournament simulations."
        }
        actions={
          <div role="tablist" aria-label="Bracket views" className="inline-flex rounded-full bg-chip p-1">
            <button
              type="button"
              role="tab"
              aria-selected={view === "official"}
              onClick={() => setView("official")}
              className={cn(SEG_ITEM, view === "official" && SEG_ON)}
            >
              Official
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "ai"}
              onClick={() => setView("ai")}
              className={cn(SEG_ITEM, view === "ai" && SEG_ON)}
            >
              Model bracket
            </button>
          </div>
        }
      />

      <div role="tabpanel">
        {view === "ai" ? (
          <>
            {oddsState.status === "error" && <ErrorState message={oddsState.message} onRetry={oddsState.retry} />}
            {oddsState.status === "loading" && <SkeletonRounds />}
            {oddsState.status === "success" &&
              (oddsState.data.length === 0 ? <NotReady /> : <AIBracket odds={oddsState.data} />)}
          </>
        ) : (
          // Always render the static-topology tree; results overlay once loaded.
          // buildTree(null) produces a label-only tree so the Official tab is
          // useful even before the API responds or if it errors.
          <Card pad>
            <OfficialBracket
              ties={buildTree(bracketState.status === "success" ? bracketState.data : null)}
            />
          </Card>
        )}
      </div>

      {view === "ai" && (
        <Note className="mt-6 max-w-prose">
          Each run simulates all 72 group matches, ranks the qualifiers, seeds the official
          Round-of-32 bracket and plays every knockout tie (level ties go to a penalty model).
          A probability is the share of runs in which a team reaches that stage. Knockout
          matches are treated as neutral-venue.
        </Note>
      )}
    </div>
  );
}

const ROUND_DEFS: { key: keyof TournamentOdds; label: string; take: number; final?: boolean }[] = [
  { key: "reach_r16", label: "Round of 16", take: 16 },
  { key: "reach_qf", label: "Quarter-finals", take: 8 },
  { key: "reach_sf", label: "Semi-finals", take: 4 },
  { key: "win_title", label: "Final", take: 2, final: true },
];

/** The model's most-likely path: for each round, the teams most likely to reach
 *  it, ending in the Final and the predicted champion line. */
function AIBracket({ odds }: { odds: TournamentOdds[] }) {
  const champion = [...odds].sort((a, b) => (b.win_title ?? 0) - (a.win_title ?? 0))[0];

  const teamsFor = (key: keyof TournamentOdds, take: number) =>
    [...odds]
      .sort((a, b) => ((b[key] as number) ?? 0) - ((a[key] as number) ?? 0))
      .slice(0, take);

  return (
    <div className="flex flex-col gap-6">
      {ROUND_DEFS.map((round) => (
        <Card pad key={round.label} aria-labelledby={`ai-${round.key}`}>
          <h2 id={`ai-${round.key}`} className="text-h2 font-semibold text-ink">
            {round.label}
          </h2>
          <ul
            className={cn(
              "mt-4 grid gap-3",
              round.final ? "min-[640px]:grid-cols-2" : "min-[640px]:grid-cols-2 min-[1024px]:grid-cols-4",
            )}
          >
            {teamsFor(round.key, round.take).map((t) => (
              <li key={t.team_id}>
                <Link
                  href={`${WC26_BASE}/team/${t.team_id}`}
                  onClick={() => trackEvent("bracket_team_click", { team: t.team, from: round.label })}
                  className={cn(
                    "flex min-h-[48px] items-center gap-3 rounded-[12px] border px-3.5 py-2.5 font-semibold text-ink no-underline transition-colors",
                    round.final ? "border-ink" : "border-line hover:border-line-strong",
                  )}
                >
                  <Flag team={t.team} size={22} decorative />
                  <span className="min-w-0 flex-1 truncate">{t.team}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {champion && (
        <p className="text-muted">
          Predicted champion:{" "}
          <Link
            href={`${WC26_BASE}/team/${champion.team_id}`}
            className="font-semibold text-brand no-underline underline-offset-[3px] hover:underline"
          >
            {champion.team}
          </Link>
          , with a {pct(champion.win_title)} chance of the title.
        </p>
      )}
    </div>
  );
}

function NotReady() {
  return (
    <Card pad>
      <Note>The tournament simulation has not run yet.</Note>
    </Card>
  );
}

function SkeletonRounds() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading the model's bracket">
      {[16, 8, 4, 2].map((count, r) => (
        <Card pad key={r}>
          <div className="h-5 w-32 rounded-full bg-line-soft" />
          <div className="mt-4 grid gap-3 min-[640px]:grid-cols-2">
            {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
              <div key={i} className="h-12 rounded-[12px] bg-line-soft" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
