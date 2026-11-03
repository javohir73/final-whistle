"use client";

import Link from "next/link";
import type { StandingRow } from "@/lib/types";
import type { StandingsZone } from "@/lib/sports";
import { zoneForRank, zoneToneClasses } from "@/lib/standingsZones";
import { cn } from "@/lib/utils";
import { QualificationBar } from "./QualificationBar";
import { ClubBadge } from "./ClubBadge";
import { TeamBadge } from "./TeamBadge";

/** Solid swatch color per zone tone, for the legend dots. The rows wear the
 *  faint tints from zoneToneClasses; the legend needs the full-strength hue.
 *  Same tone->color families as zoneToneClasses (cl/promo/finals lime, europa
 *  gold, releg rose) -- kept local so lib/standingsZones.ts's tested shape is
 *  untouched. `none` never reaches the legend (every zone carries a label). */
const ZONE_SWATCH: Record<StandingsZone["tone"], string> = {
  cl: "bg-win",
  promo: "bg-win",
  finals: "bg-win",
  europa: "bg-gold",
  releg: "bg-loss",
  none: "bg-muted",
};

/** The qualification column has to fit QualificationBar's own fixed widths
 *  (bar + printed %), which grow at sm -- pin the header label and the cell to
 *  the same width so the Pts/GD columns stay aligned between the two. */
const QUAL_COL = "w-[5.5rem] shrink-0 sm:w-36";

/** Rank numeral slot, shared by the header spacer and every row so the club
 *  column starts at the same x in both. Narrower below sm (see below), where
 *  the numeral also steps down a size to fit it. */
const RANK_COL = "w-5 shrink-0 sm:w-7";

/** The optional numeric columns a caller can slot between the team cell and the
 *  qualification column. Football uses the GD/Pts default (`columns` omitted);
 *  the NRL ladder passes W-L / Diff / Pts / Top-8% (design/Floodlight
 *  Prototype.dc.html, the NRL ladder surface). */
export type StandingsColumn =
  | "gd"
  | "pts"
  | "wl"
  | "diff"
  | "played"
  | "top8"
  | "won"
  | "drawn"
  | "lost"
  | "gf"
  | "ga";

/** The conventional football league table, in the order every reader expects.
 *  The backend computed all of these in one pass and then dropped five of them
 *  at the schema boundary, so a standings page could show points and goal
 *  difference but not played, won, drawn, lost or goals against. */
export const FULL_LEAGUE_COLUMNS: StandingsColumn[] = [
  "played",
  "won",
  "drawn",
  "lost",
  "gf",
  "ga",
  "gd",
  "pts",
];

/** Header label + width for each numeric column. All right-aligned; the widths
 *  keep the header row and the body cells in the same grid. `gloss` expands a
 *  format-knowledge label for first-time fans (title tooltip + accessible
 *  name); columns whose label says it all omit it.
 *
 *  Phone geometry (the 390px overlap bug): every numeric column is a FIXED box
 *  (`shrink-0`, see colClass). As plain flex items they used to shrink -- by a
 *  different amount in the header (whose "Team" label won't shrink past its
 *  text) than in each body row (whose `min-w-0` rowheader collapses), which
 *  slid the header a column off the numbers, and the crest + name then spilled
 *  out of the squeezed rowheader over P/W/D. Now the club column is the only
 *  flexible one and truncates instead. Widths step down below sm so a 360px
 *  phone still has room for a club name, and `wideOnly` columns (GF/GA -- GD
 *  already nets them) drop out below sm. Below 360px (320px phones) the
 *  `xsHidden` tiebreak columns go too -- GD, the ladder's Diff -- which takes
 *  the club name from ~3 characters to 8+. sm and up keep the original
 *  widths. */
const NUMERIC_HEADERS: Record<
  StandingsColumn,
  { label: string; width: string; gloss?: string; wideOnly?: boolean; xsHidden?: boolean }
> = {
  gd: { label: "GD", width: "w-7 sm:w-10", gloss: "Goal difference", xsHidden: true },
  pts: { label: "Pts", width: "w-7 sm:w-10", gloss: "Points" },
  wl: { label: "W–L", width: "w-11 sm:w-12", gloss: "Wins–losses" },
  diff: { label: "Diff", width: "w-9 sm:w-10", gloss: "Points difference", xsHidden: true },
  played: { label: "P", width: "w-6 sm:w-10", gloss: "Games played" },
  won: { label: "W", width: "w-5 sm:w-8", gloss: "Won" },
  drawn: { label: "D", width: "w-5 sm:w-8", gloss: "Drawn" },
  lost: { label: "L", width: "w-5 sm:w-8", gloss: "Lost" },
  gf: { label: "GF", width: "w-10", gloss: "Goals for", wideOnly: true },
  ga: { label: "GA", width: "w-10", gloss: "Goals against", wideOnly: true },
  top8: {
    label: "Top 8%",
    width: "w-12 sm:w-14",
    gloss: "Projected chance of finishing in the top 8 and making the finals",
  },
};

/** The box a numeric column occupies -- identical for its header cell and
 *  every body cell, which is what keeps the two rows on one grid. */
function colClass(key: StandingsColumn): string {
  const { width, wideOnly, xsHidden } = NUMERIC_HEADERS[key];
  return cn("shrink-0", width, wideOnly && "hidden sm:block", xsHidden && "max-[359px]:hidden");
}

/** Shared right-aligned value-cell class (matches the existing GD cell). */
const VALUE_CELL = "text-right text-body tabular-nums text-foreground";

/** Row shape the table accepts: a superset of StandingRow (football) plus the
 *  NRL ladder metrics, every metric optional so a StandingRow[] stays
 *  assignable (arrays skip excess-property checks). Football callers pass
 *  StandingRow[] unchanged; the NRL ladder passes rows carrying
 *  wins/losses/diff/projected_points/projection_pct. `team_id`/`team` are the
 *  only required fields -- they drive the row key, link, crest, and name. */
export interface StandingsTableRow {
  team_id: number;
  team: string;
  // The row's real ladder/table position. Omitted by the full, pre-sorted
  // tables (football + full NRL ladder) where array index+1 already equals the
  // rank; carried explicitly when the caller passes a filtered, non-contiguous
  // subset (match-detail's two clubs) so the numeral and zone reflect the true
  // position, not the array index.
  rank?: number;
  projected_points?: number;
  projected_goals_for?: number;
  projected_goal_diff?: number;
  qualification_prob?: number | null;
  played?: number;
  // Two spellings on purpose. The football API returns won/drawn/lost (mirroring
  // the Standing model's columns); the NRL ladder rows carry wins/losses. Rather
  // than rename either side, the W/D/L cells below read whichever is present.
  wins?: number;
  draws?: number;
  losses?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  /** Football league tables only; the NRL ladder carries `diff` instead. */
  goals_against?: number;
  points?: number;
  diff?: number;
  projection_pct?: number | null;
}

/** Signed integer the way the GD/Diff columns print it: "+5", "-3", "0"; blank
 *  when the value is missing so a partial row degrades to an empty cell rather
 *  than "NaN". Mirrors the football GD cell's existing +N / N formatting. */
function signed(n: number | undefined): string {
  if (n == null) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

/** One numeric body cell for the generic `columns` path (the NRL ladder and any
 *  future caller that passes `columns`). The football default path renders its
 *  GD/Pts cells inline (see StandingsTable) to stay byte-identical. */
function renderCell(key: StandingsColumn, row: StandingsTableRow) {
  switch (key) {
    case "gd":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {signed(row.projected_goal_diff)}
        </span>
      );
    case "pts":
      return (
        <span key={key} role="cell" className={cn(colClass(key), "text-right font-display text-sm font-bold tabular-nums")}>
          {row.projected_points}
        </span>
      );
    case "wl":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.wins}–{row.losses}
        </span>
      );
    case "diff":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {signed(row.diff)}
        </span>
      );
    case "played":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.played}
        </span>
      );
    // A blank cell, never a 0, when the value is absent: a response from a
    // backend that predates these fields must not read as "played nothing".
    case "won":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.won ?? row.wins ?? ""}
        </span>
      );
    case "drawn":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.drawn ?? row.draws ?? ""}
        </span>
      );
    case "lost":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.lost ?? row.losses ?? ""}
        </span>
      );
    case "gf":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.projected_goals_for ?? ""}
        </span>
      );
    case "ga":
      return (
        <span key={key} role="cell" className={cn(colClass(key), VALUE_CELL)}>
          {row.goals_against ?? ""}
        </span>
      );
    case "top8": {
      // projColor from the prototype, simplified to the closed lime/muted pair:
      // a live top-8 chance (>=50%) reads lime, everything else (incl. the "—"
      // placeholder) reads muted. The printed % carries the signal, not colour.
      const p = row.projection_pct;
      return (
        <span
          key={key}
          role="cell"
          className={cn(
            colClass(key),
            "text-right text-body tabular-nums",
            p != null && p >= 0.5 ? "text-lime-deep" : "text-muted",
          )}
        >
          {p != null ? `${Math.round(p * 100)}%` : "—"}
        </span>
      );
    }
  }
}

/** The football GD + Pts body cells, rendered as the pre-NRL component did
 *  (on the shared fixed column boxes). The default (no `columns`) path is the
 *  football surface, so the one documented narrowing to StandingRow is safe --
 *  projected_* are required there. */
function footballNumericCells(row: StandingsTableRow) {
  const s = row as StandingRow;
  return (
    <>
      <span role="cell" className={cn(colClass("gd"), VALUE_CELL)}>
        {s.projected_goal_diff > 0 ? `+${s.projected_goal_diff}` : s.projected_goal_diff}
      </span>
      <span role="cell" className={cn(colClass("pts"), "text-right font-display text-sm font-bold tabular-nums")}>
        {s.projected_points}
      </span>
    </>
  );
}

/** Floodlight standings table (design/Floodlight Prototype.dc.html, Recon 3
 *  Screen 4): a flex table with a Hanken micro-label header over rows that each
 *  wear a `border-l-[3px]` zone stripe, a faint zone tint, and a big Bricolage
 *  rank numeral tinted to the zone. `zones` drives the CL/Europa/relegation
 *  bands for league comps; pass `[]` for group/knockout tables that have no
 *  finish lines (WC26), where the Top-2 QualificationBar column carries the
 *  story instead (`showQualification`). Generalises the old GroupTable so both
 *  surfaces share one styling source; `badge`/`teamBasePath`/`teamHeader`/
 *  `columns` additionally paint the NRL ladder (club crests, /nrl/team links,
 *  W-L / Diff / Pts / Top-8% columns) off the same component. The flex layout
 *  carries ARIA table roles (table/rowgroup/row/columnheader/rowheader/cell) so
 *  it still reads as a table to screen readers -- header-to-cell association
 *  and table navigation survive the move off semantic `<table>` markup. */
export function StandingsTable({
  standings,
  zones,
  highlightTeamId,
  showQualification = false,
  badge = "flag",
  teamBasePath = "/team",
  teamHeader = "Team",
  columns,
}: {
  standings: StandingsTableRow[];
  zones: StandingsZone[];
  highlightTeamId?: number;
  showQualification?: boolean;
  badge?: "flag" | "club";
  teamBasePath?: string;
  teamHeader?: string;
  columns?: StandingsColumn[];
}) {
  return (
    // Auto-width rows would let a long name ("Bosnia and Herzegovina") wrap; the
    // scroll guard keeps 390px viewports overflow-free either way.
    <div className="overflow-x-auto">
      <div role="table" aria-label="Standings">
        <div role="rowgroup">
          <div
            role="row"
            className="flex items-center border-b border-border border-l-[3px] border-l-transparent py-1.5 pl-1.5 text-mini font-medium uppercase tracking-[0.1em] text-muted"
          >
            <span className={RANK_COL} aria-hidden />
            <span role="columnheader" className="min-w-0 flex-1 truncate">{teamHeader}</span>
            {columns ? (
              columns.map((key) => (
                <span
                  key={key}
                  role="columnheader"
                  title={NUMERIC_HEADERS[key].gloss}
                  aria-label={NUMERIC_HEADERS[key].gloss}
                  className={cn(colClass(key), "text-right")}
                >
                  {NUMERIC_HEADERS[key].label}
                </span>
              ))
            ) : (
              <>
                <span role="columnheader" title="Goal difference" aria-label="Goal difference" className={cn(colClass("gd"), "text-right")}>GD</span>
                <span role="columnheader" title="Points" aria-label="Points" className={cn(colClass("pts"), "text-right")}>Pts</span>
              </>
            )}
            {showQualification && (
              <span
                role="columnheader"
                title="Chance of finishing in the top two and qualifying"
                aria-label="Chance of finishing in the top two and qualifying"
                className={cn(QUAL_COL, "text-right")}
              >
                Top 2
              </span>
            )}
          </div>
        </div>

        <div role="rowgroup">
          {standings.map((row, i) => {
            // Real rank when the row carries it (a filtered subset), else the
            // array position — index+1 === rank for the full, pre-sorted tables.
            const rank = row.rank ?? i + 1;
            const zone = zoneForRank(zones, rank);
            const { stripe, bg, rankText } = zoneToneClasses(zone?.tone ?? "none");
            const highlighted = row.team_id === highlightTeamId;
            return (
              <div
                key={row.team_id}
                role="row"
                className={cn(
                  "flex items-center border-b border-border border-l-[3px] pl-1.5",
                  stripe || "border-l-transparent",
                  highlighted ? "bg-win/10" : bg,
                )}
              >
                {/* rank + crest + name is the tap target (>=44px via py-3) and
                    the row header, so AT announces the team alongside each cell */}
                <div role="rowheader" className="min-w-0 flex-1">
                  <Link
                    href={`${teamBasePath}/${row.team_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex min-w-0 items-center gap-1.5 py-3 hover:text-lime-deep sm:gap-2.5"
                  >
                    <span className={cn("text-rank text-center max-sm:text-lg", RANK_COL, rankText === "text-gold" ? "text-gold-ink" : rankText || "text-muted")}>
                      {rank}
                    </span>
                    <span className="shrink-0">
                      {badge === "club" ? (
                        <ClubBadge
                          name={row.team}
                          size={30}
                          className="rounded-lg border border-border/70 bg-surface-2/70"
                        />
                      ) : (
                        <TeamBadge team={row.team} size={22} />
                      )}
                    </span>
                    {/* Phones: one line, ellipsis, never over the numbers
                        (the full name stays in the link's accessible name).
                        sm and up wrap as before. */}
                    <span
                      className={cn(
                        "min-w-0 font-display font-bold leading-tight max-sm:truncate max-sm:text-sm",
                        highlighted && "text-lime-deep",
                      )}
                    >
                      {row.team}
                    </span>
                  </Link>
                </div>
                {columns
                  ? columns.map((key) => renderCell(key, row))
                  : footballNumericCells(row)}
                {showQualification && (
                  <div role="cell" className={cn(QUAL_COL, "flex justify-end")}>
                    <QualificationBar prob={row.qualification_prob ?? null} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Zone legend only makes sense above rows it can point at — an empty
          table with an orphan legend reads as broken, not pre-draw. */}
      {zones.length > 0 && standings.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {zones.map((z) => (
            <span
              key={z.label}
              className="inline-flex items-center gap-1.5 text-mini text-muted"
            >
              <i className={cn("h-2 w-2 rounded-[2px]", ZONE_SWATCH[z.tone])} aria-hidden />
              {z.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
