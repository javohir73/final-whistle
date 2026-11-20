/** Small, pure helpers shared by the full table, the club page and the rail's
 *  mini table (direction G). No React here. */
import { clubLogoSrc } from "@/components/ClubBadge";

/** "+10", "0", "−3" — signed with a real minus sign (U+2212), never a hyphen. */
export function signedNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

/** Short names for tight spaces (the rail's mini table). Whole words only —
 *  a name is shortened by a known abbreviation or kept in full, never cut
 *  mid-word. Anything not listed is printed as the API sends it. */
const SHORT_NAMES: Record<string, string> = {
  "Manchester City": "Man City",
  "Manchester United": "Man United",
  "Nottingham Forest": "Nott’m Forest",
  "Wolverhampton Wanderers": "Wolves",
  "Tottenham Hotspur": "Tottenham",
  "Brighton & Hove Albion": "Brighton",
  "West Ham United": "West Ham",
  "Newcastle United": "Newcastle",
  "Atletico Madrid": "Atlético",
  "Atlético Madrid": "Atlético",
  "RC Deportivo La Coruña": "Deportivo",
  "Deportivo La Coruna": "Deportivo",
  "Real Racing Club de Santander": "Racing",
  "Racing Santander": "Racing",
  "Rayo Vallecano": "Rayo",
  "Bayern München": "Bayern",
  "Borussia Dortmund": "Dortmund",
  "Bayer Leverkusen": "Leverkusen",
  "Borussia Mönchengladbach": "Gladbach",
  "Eintracht Frankfurt": "Frankfurt",
  "1899 Hoffenheim": "Hoffenheim",
  "SV 07 Elversberg": "Elversberg",
  "SV Elversberg": "Elversberg",
  "SC Paderborn 07": "Paderborn",
  "FSV Mainz 05": "Mainz",
  "FC Schalke 04": "Schalke",
  "Paris Saint Germain": "PSG",
  "Paris Saint-Germain": "PSG",
  "Club Brugge KV": "Club Brugge",
};

export function clubShortName(name: string): string {
  return SHORT_NAMES[name] ?? name;
}

/** The longest single word a phone fixture row can print on one line (about
 *  112px of name column at 390px, 14px semibold). */
const PHONE_WORD_LIMIT = 13;

/** The name a phone fixture row should print: the known short name when the
 *  full one holds a word too long for the column ("Mönchengladbach"), so the
 *  browser never breaks inside a word. Undefined when the full name fits or no
 *  short name is known. */
export function clubPhoneName(name: string): string | undefined {
  const short = SHORT_NAMES[name];
  if (!short || short === name) return undefined;
  return name.split(/\s+/).some((word) => word.length > PHONE_WORD_LIMIT) ? short : undefined;
}

interface DedupeRow {
  team: string;
  played?: number;
}

/** The live league tables sometimes carry a club twice under two spellings
 *  (a ghost row with 0–1 matches, e.g. "SV Elversberg" beside "SV 07
 *  Elversberg"). Two rows are the same club when both names resolve to the
 *  same crest file; keep the one with more matches played, in table order.
 *  Rows without a known crest are never merged. */
export function dedupeStandings<T extends DedupeRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = clubLogoSrc(row.team);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || (row.played ?? 0) > (prev.played ?? 0)) best.set(key, row);
  }
  return rows.filter((row) => {
    const key = clubLogoSrc(row.team);
    return !key || best.get(key) === row;
  });
}

/** English ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st… */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "2026–27" for a season that starts in `year` (club competitions). */
export function seasonLabel(year: number | null | undefined): string | null {
  if (!year || !Number.isFinite(year)) return null;
  return `${year}–${String(year + 1).slice(-2)}`;
}

/** Only the fields the table/club pages read from a fixture — deliberately
 *  WITHOUT the model's numbers, so nothing derived from here can leak an open
 *  fixture's prediction into server HTML. */
export interface FixtureLite {
  match_id: number;
  matchweek?: number | null;
  kickoff_utc: string | null;
  status: string;
  teams: { home: string; away: string };
}

/** The highest matchweek with a finished match ("After 10 matchweeks"). The
 *  live feeds carry a few stale "scheduled" rows in played weeks, so "every
 *  match finished" would undercount. null when nothing has been played. */
export function matchweeksPlayed(matches: FixtureLite[]): number | null {
  let max = 0;
  for (const m of matches) {
    if (m.status === "finished" && m.matchweek && m.matchweek > max) max = m.matchweek;
  }
  return max > 0 ? max : null;
}

/** Each club's next fixture: the earliest not-yet-played match with a kickoff
 *  still in the future (stale scheduled rows in the past are skipped). Keyed by
 *  the club name exactly as the fixtures feed spells it. */
export function nextFixtureByClub(
  matches: FixtureLite[],
  now: Date = new Date(),
): Record<string, { matchId: number; opponent: string; home: boolean; kickoffUtc: string }> {
  const out: Record<string, { matchId: number; opponent: string; home: boolean; kickoffUtc: string }> = {};
  const nowMs = now.getTime();
  const upcoming = matches
    .filter((m) => (m.status === "scheduled" || m.status === "postponed") && m.kickoff_utc)
    .filter((m) => Date.parse(m.kickoff_utc as string) > nowMs)
    .sort((a, b) => (a.kickoff_utc as string).localeCompare(b.kickoff_utc as string));
  for (const m of upcoming) {
    const { home, away } = m.teams;
    if (!out[home]) out[home] = { matchId: m.match_id, opponent: away, home: true, kickoffUtc: m.kickoff_utc as string };
    if (!out[away]) out[away] = { matchId: m.match_id, opponent: home, home: false, kickoffUtc: m.kickoff_utc as string };
  }
  return out;
}
