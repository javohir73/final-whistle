import Link from "next/link";
import type { StandingsZone } from "@/lib/sports";
import { signedNumber } from "@/lib/standingsRows";
import { cn } from "@/lib/utils";
import { ClubCell, Legend, Table, TableScroll, Td, Th, zoneForPosition, zoneForTone, type Zone } from "@/components/ui";
import { QualificationBar } from "./QualificationBar";
import { ClubBadge } from "./ClubBadge";
import { TeamBadge } from "./TeamBadge";

/** The optional numeric columns a caller can slot after the club cell.
 *  Football uses the GD/Pts default (`columns` omitted) or FULL_LEAGUE_COLUMNS;
 *  the NRL ladder passes W–L / Diff / Pts / Top-8%. */
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

/** The conventional football league table, in the order every reader expects. */
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

/** Header label per numeric column. `gloss` is the spoken name (and tooltip)
 *  for abbreviations. Phone policy (direction G): below 640px the table keeps
 *  position, club, P, GD and Pts and drops the detail columns (`phoneHidden`),
 *  so a 390px phone reads the table without sideways scrolling; below 360px the
 *  tiebreak column (GD / Diff) goes too (`xsHidden`). The same classes go on
 *  the header cell and every body cell, so the columns always line up. */
const NUMERIC_HEADERS: Record<
  StandingsColumn,
  { label: string; gloss?: string; phoneHidden?: boolean; xsHidden?: boolean }
> = {
  gd: { label: "GD", gloss: "Goal difference", xsHidden: true },
  pts: { label: "Pts", gloss: "Points" },
  wl: { label: "W–L", gloss: "Wins–losses" },
  diff: { label: "Diff", gloss: "Points difference", xsHidden: true },
  played: { label: "P", gloss: "Games played" },
  won: { label: "W", gloss: "Won", phoneHidden: true },
  drawn: { label: "D", gloss: "Drawn", phoneHidden: true },
  lost: { label: "L", gloss: "Lost", phoneHidden: true },
  gf: { label: "GF", gloss: "Goals for", phoneHidden: true },
  ga: { label: "GA", gloss: "Goals against", phoneHidden: true },
  top8: {
    label: "Top 8%",
    gloss: "Projected chance of finishing in the top 8 and making the finals",
  },
};

/** Visibility classes for a column — identical on its header and body cells. */
export function columnVisibility(key: StandingsColumn): string {
  const { phoneHidden, xsHidden } = NUMERIC_HEADERS[key];
  return cn(phoneHidden && "max-sm:hidden", xsHidden && "max-[359px]:hidden");
}

/** Row shape the table accepts: a superset of StandingRow (football) plus the
 *  NRL ladder metrics, every metric optional so a StandingRow[] stays
 *  assignable. `team_id`/`team` drive the row key, link, crest and name. */
export interface StandingsTableRow {
  team_id: number;
  team: string;
  /** Real position when the caller passes a filtered, non-contiguous subset;
   *  omitted by full pre-sorted tables, where index+1 is the position. */
  rank?: number;
  projected_points?: number;
  projected_goals_for?: number;
  projected_goal_diff?: number;
  qualification_prob?: number | null;
  played?: number;
  // The football API spells these won/drawn/lost; the NRL ladder wins/losses.
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

/** A club's next fixture for the optional "Next" column ("v Fulham (H)"). */
export interface StandingsNext {
  label: string;
  href: string;
  /** Spoken form, e.g. "Next: Fulham at home". */
  ariaLabel?: string;
}

/** The value of one numeric cell. Blank (never 0) when the value is absent: a
 *  response from an older backend must not read as "played nothing". */
function cellValue(key: StandingsColumn, row: StandingsTableRow): string | number {
  switch (key) {
    case "gd":
      return signedNumber(row.projected_goal_diff);
    case "pts":
      return row.projected_points ?? "";
    case "wl":
      return row.wins != null && row.losses != null ? `${row.wins}–${row.losses}` : "";
    case "diff":
      return signedNumber(row.diff);
    case "played":
      return row.played ?? "";
    case "won":
      return row.won ?? row.wins ?? "";
    case "drawn":
      return row.drawn ?? row.draws ?? "";
    case "lost":
      return row.lost ?? row.losses ?? "";
    case "gf":
      return row.projected_goals_for ?? "";
    case "ga":
      return row.goals_against ?? "";
    case "top8": {
      const p = row.projection_pct;
      return p != null ? `${Math.round(p * 100)}%` : "—";
    }
  }
}

/** Legend items from a competition's zones. Two bands that share a marker
 *  (Bundesliga's play-off place and its relegation places) read as one item. */
function legendItems(zones: StandingsZone[]): Array<{ zone: Zone; label: string }> {
  const out: Array<{ zone: Zone; label: string }> = [];
  for (const z of zones) {
    const zone = zoneForTone(z.tone);
    if (!zone) continue;
    const same = out.find((item) => item.zone === zone);
    if (same) same.label = `${same.label} and ${z.label.toLowerCase()}`;
    else out.push({ zone, label: z.label });
  }
  return out;
}

/** The shared standings table (direction G): semantic <table> on the ui table
 *  primitives — muted position with the 3px zone marker, crest + club as the
 *  row header (a link to the club page), right-aligned tabular numbers, bold
 *  points, and a legend for the zones under it. Used by the football table,
 *  the NRL ladder, the World Cup group cards and the competition home.
 *  `zones=[]` for tables without finish lines; `showQualification` adds the
 *  World Cup groups' Top-2 bar; `next` adds the "Next" fixture column. */
export function StandingsTable({
  standings,
  zones,
  highlightTeamId,
  showQualification = false,
  badge = "flag",
  teamBasePath = "/team",
  teamHeader = "Team",
  columns,
  next,
  caption,
}: {
  standings: StandingsTableRow[];
  zones: StandingsZone[];
  highlightTeamId?: number;
  showQualification?: boolean;
  badge?: "flag" | "club";
  teamBasePath?: string;
  teamHeader?: string;
  columns?: StandingsColumn[];
  /** Next fixture per team id; adds a "Next" column (hidden under 768px). */
  next?: Record<number, StandingsNext | undefined>;
  /** Accessible table name; "Standings" by default. */
  caption?: string;
}) {
  const cols = columns ?? ["gd", "pts"];
  const legend = standings.length > 0 ? legendItems(zones) : [];

  return (
    <div>
      <TableScroll>
        <Table aria-label={caption ?? "Standings"}>
          <thead>
            <tr>
              <Th align="left" className="w-9">
                <span className="sr-only">Position</span>
              </Th>
              <Th align="left">{teamHeader}</Th>
              {cols.map((key) => (
                <Th
                  key={key}
                  title={NUMERIC_HEADERS[key].gloss}
                  aria-label={NUMERIC_HEADERS[key].gloss}
                  className={cn("min-w-10", columnVisibility(key))}
                >
                  {NUMERIC_HEADERS[key].label}
                </Th>
              ))}
              {showQualification && (
                <Th
                  title="Chance of finishing in the top two and qualifying"
                  aria-label="Chance of finishing in the top two and qualifying"
                >
                  Top 2
                </Th>
              )}
              {next && (
                <Th align="left" className="pl-8 max-md:hidden">
                  Next
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const rank = row.rank ?? i + 1;
              const zone = zoneForPosition(rank, zones);
              const highlighted = row.team_id === highlightTeamId;
              const nx = next?.[row.team_id];
              return (
                <tr
                  key={row.team_id}
                  className={cn(highlighted && "bg-soft")}
                  aria-current={highlighted ? "true" : undefined}
                  data-zone={zone}
                >
                  <Td pos zone={zone} className="tabular-nums">
                    {rank}
                  </Td>
                  <th
                    scope="row"
                    className="border-t border-line-soft px-2 py-3 text-left font-normal max-sm:whitespace-normal sm:whitespace-nowrap"
                  >
                    <ClubCell
                      href={`${teamBasePath}/${row.team_id}`}
                      className="flex max-sm:gap-2.5"
                      crest={
                        badge === "club" ? (
                          <ClubBadge name={row.team} size={22} decorative className="shrink-0" />
                        ) : (
                          <TeamBadge team={row.team} size={22} decorative className="shrink-0" />
                        )
                      }
                      name={row.team}
                    />
                  </th>
                  {cols.map((key) => (
                    <Td
                      key={key}
                      pts={key === "pts"}
                      className={cn(
                        "tabular-nums",
                        key === "top8" && "text-muted",
                        columnVisibility(key),
                      )}
                    >
                      {cellValue(key, row)}
                    </Td>
                  ))}
                  {showQualification && (
                    <Td>
                      <div className="flex justify-end">
                        <QualificationBar prob={row.qualification_prob ?? null} />
                      </div>
                    </Td>
                  )}
                  {next && (
                    <Td align="left" className="pl-8 max-md:hidden">
                      {nx ? (
                        <Link
                          href={nx.href}
                          aria-label={nx.ariaLabel}
                          className="font-semibold text-brand underline-offset-[3px] hover:underline"
                        >
                          {nx.label}
                        </Link>
                      ) : null}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
      <Legend items={legend} />
    </div>
  );
}
