/** Competition registry and the one navigation template derived from it.
 *  Adding a competition = adding an entry to COMPETITIONS; SiteNav, BottomNav,
 *  the switcher, the sitemap and the /football hub all derive from it. */
export type SportId = "football" | "nrl";

/* ============================================================================
 * Competition registry (Floodlight P1 slice p1-s2): terminology, standings
 * zones, surface gating (bracket/groups/tips) and a per-comp accent color all
 * live on one Competition record. The nav tabs are NOT hand-written per
 * competition any more -- navTabsFor() below generates them from one template.
 * ========================================================================= */

/** One entry per football league/tournament, plus NRL as its own "competition"
 *  so nav/gating code can treat them uniformly. WC26 is the only
 *  knockout-format entry (hasBracket/hasGroups). UCL currently exposes its
 *  league-phase standings, fixtures, and tips; a knockout bracket stays hidden
 *  until the backend has a real bracket tree to serve. */
export type CompetitionId = "epl" | "laliga" | "bundesliga" | "ucl" | "wc26" | "nrl";

/** A contiguous rank band on a standings/ladder table, e.g. "positions 1-4
 *  qualify for the Champions League." Consumed by the P2 StandingsTable to
 *  paint zone stripes/labels; data only in this slice -- zones don't render
 *  anywhere yet. `tone` is a closed palette key, not a raw color, so the
 *  component owns the actual hues. */
export interface StandingsZone {
  from: number; // 1-indexed inclusive rank
  to: number; // inclusive
  label: string; // 'Champions League', 'Relegation', 'Top 8'...
  tone: "cl" | "europa" | "releg" | "promo" | "finals" | "none";
}

/** Full per-competition config. A Competition is a display+gating record, not
 *  a live data source -- fixtures/standings still come from their existing
 *  APIs, keyed by `id`/`basePath`. */
export interface Competition {
  id: CompetitionId;
  sport: SportId;
  label: string; // 'Premier League', 'World Cup 2026', 'NRL'
  shortLabel: string; // 'EPL', 'LaLiga', 'BUN', 'WC26', 'NRL' (eyebrow chip)
  logoSrc: string; // self-hosted competition identity used by switchers, filters, and hubs
  basePath: string; // '/football/epl', '/football/wc26', '/nrl'
  accentVar: string; // '--accent-epl' etc. (globals.css, Floodlight P1 tokens)
  format: "league" | "knockout";
  hasBracket: boolean; // wc26 only
  hasGroups: boolean; // wc26 only
  hasTips: boolean; // league comps + wc26's Tips slot + nrl
  /** Gates the CompetitionOverlay and route wrappers. A competition can be
   *  navigable here even when its prediction pipeline is not active: those
   *  routes show a competition-specific empty state and never borrow another
   *  league's teams. ACTIVE_LEAGUES remains the separate prediction safety
   *  gate in lib/leagueConfig.ts. */
  enabled: boolean;
  /** A finished tournament kept as an archive (WC26 since July 2026): listed
   *  under "Past tournaments" in the switcher and the /football hub, and never
   *  chosen as anyone's default competition. Its URLs keep resolving. */
  archived: boolean;
  /** The model's graded record for this competition, where a page exists:
   *  NRL's own ledger, and /record (the World Cup record) for WC26. Club
   *  leagues get /football/{comp}/record in Phase 2; null until then. */
  recordPath: string | null;
  terms: { fixtures: string; standings: string }; // page-heading vocabulary (nav labels come from navTabsFor)
  zones: StandingsZone[]; // StandingsTable input; [] where N/A
}

/** Reasonable default zone banding for a 20-team European league table:
 *  1-4 Champions League, 5 Europa League, 18-20 relegation. Real qualification
 *  spots (Europa Conference, a league's exact CL count) vary by season and
 *  competition. EPL and La Liga use this 20-team default; Bundesliga has its
 *  own 18-team relegation bands below. */
const EUROPEAN_LEAGUE_ZONES: StandingsZone[] = [
  { from: 1, to: 4, label: "Champions League", tone: "cl" },
  { from: 5, to: 5, label: "Europa League", tone: "europa" },
  { from: 18, to: 20, label: "Relegation", tone: "releg" },
];

const BUNDESLIGA_ZONES: StandingsZone[] = [
  { from: 1, to: 4, label: "Champions League", tone: "cl" },
  { from: 5, to: 5, label: "Europa League", tone: "europa" },
  { from: 16, to: 16, label: "Relegation playoff", tone: "releg" },
  { from: 17, to: 18, label: "Relegation", tone: "releg" },
];

export const COMPETITIONS: Record<CompetitionId, Competition> = {
  epl: {
    id: "epl",
    sport: "football",
    label: "Premier League",
    shortLabel: "EPL",
    logoSrc: "/competitions/epl.svg",
    basePath: "/football/epl",
    accentVar: "--accent-epl",
    format: "league",
    hasBracket: false,
    hasGroups: false,
    hasTips: true,
    enabled: true,
    archived: false,
    recordPath: null,
    terms: { fixtures: "Fixtures", standings: "Standings" },
    zones: EUROPEAN_LEAGUE_ZONES,
  },
  laliga: {
    id: "laliga",
    sport: "football",
    label: "La Liga",
    shortLabel: "LaLiga",
    logoSrc: "/competitions/laliga.png",
    basePath: "/football/laliga",
    accentVar: "--accent-laliga",
    format: "league",
    hasBracket: false,
    hasGroups: false,
    hasTips: true,
    enabled: true,
    archived: false,
    recordPath: null,
    terms: { fixtures: "Fixtures", standings: "Standings" },
    zones: EUROPEAN_LEAGUE_ZONES,
  },
  bundesliga: {
    id: "bundesliga",
    sport: "football",
    label: "Bundesliga",
    shortLabel: "BUN",
    logoSrc: "/competitions/bundesliga.svg",
    basePath: "/football/bundesliga",
    accentVar: "--accent-bundesliga",
    format: "league",
    hasBracket: false,
    hasGroups: false,
    hasTips: true,
    enabled: true,
    archived: false,
    recordPath: null,
    terms: { fixtures: "Fixtures", standings: "Standings" },
    zones: BUNDESLIGA_ZONES,
  },
  ucl: {
    id: "ucl",
    sport: "football",
    label: "UEFA Champions League",
    shortLabel: "UCL",
    logoSrc: "/competitions/ucl.svg",
    basePath: "/football/ucl",
    accentVar: "--accent-ucl",
    // The current surface covers the league phase. Knockout fixtures can
    // continue to render on the fixture/detail pages, but no projected bracket
    // is advertised until a competition-scoped tree is available.
    format: "league",
    hasBracket: false,
    hasGroups: false,
    // Qualifying fixtures have no league-stage matchweek. Enable score tips
    // only once real league-stage rounds exist; match model predictions remain
    // available on fixture and match pages throughout qualifying.
    hasTips: false,
    enabled: true,
    archived: false,
    recordPath: null,
    terms: { fixtures: "Fixtures", standings: "League phase" },
    zones: [
      { from: 1, to: 8, label: "Round of 16", tone: "cl" },
      { from: 9, to: 24, label: "Knockout phase play-offs", tone: "europa" },
    ],
  },
  wc26: {
    id: "wc26",
    sport: "football",
    label: "World Cup 2026",
    shortLabel: "WC26",
    logoSrc: "/competitions/wc26-20260821.png",
    basePath: "/football/wc26",
    accentVar: "--accent-wc26",
    format: "knockout",
    hasBracket: true,
    hasGroups: true,
    hasTips: true, // tips still offered, now folded into the Play hub (P5)
    enabled: true,
    archived: true,
    recordPath: "/record",
    terms: { fixtures: "Fixtures", standings: "Standings" },
    zones: [], // World Cup standings use group tables.
  },
  nrl: {
    id: "nrl",
    sport: "nrl",
    label: "NRL",
    shortLabel: "NRL",
    logoSrc: "/competitions/nrl.svg",
    basePath: "/nrl",
    accentVar: "--accent-nrl",
    format: "league",
    hasBracket: false,
    hasGroups: false,
    hasTips: true,
    enabled: true,
    archived: false,
    recordPath: "/nrl/record",
    terms: { fixtures: "Matches", standings: "Ladder" },
    // The NRL top 8 make the finals, but the top 4 get the double chance --
    // the structural line a single "Finals" band would hide, leaving positions
    // 4 and 5 pixel-identical (design/Floodlight Prototype.dc.html, the NRL
    // ladder surface). Top 4 keeps the finals (lime) tone; 5-8 drops to europa
    // (gold) so the double-chance cutoff reads and the legend shows both bands.
    zones: [
      { from: 1, to: 4, label: "Top 4", tone: "finals" },
      { from: 5, to: 8, label: "Finals (5–8)", tone: "europa" },
    ],
  },
};

/** The competition every unscoped surface falls back to when nothing better
 *  is known (no competition in the URL, no fw_comp cookie, no AU/NZ geo hint
 *  -- see lib/competitionPrefs.ts resolveCompetition). Never WC26: the World
 *  Cup ended in July 2026 and is an archive (`archived: true`). */
export const DEFAULT_COMPETITION: CompetitionId = "epl";

const FOOTBALL_IDS = (Object.keys(COMPETITIONS) as CompetitionId[]).filter(
  (id) => COMPETITIONS[id].sport === "football",
);

/** The competition the URL itself names, or null for unscoped routes ("/",
 *  "/play", "/leaderboard", "/football", "/methodology", ...). NRL is checked
 *  first (its own space, never nested under /football/); then football
 *  competitions by their /football/<comp> basePath, picking the longest
 *  matching basePath so a future prefix collision resolves to the more
 *  specific competition. Pure -- no cookies, no storage -- so it is safe in
 *  render, SSR and middleware alike. */
export function competitionInPathname(pathname: string): CompetitionId | null {
  if (pathname === "/nrl" || pathname.startsWith("/nrl/")) return "nrl";
  let best: CompetitionId | null = null;
  for (const id of FOOTBALL_IDS) {
    const base = COMPETITIONS[id].basePath;
    if (pathname === base || pathname.startsWith(base + "/")) {
      if (!best || base.length > COMPETITIONS[best].basePath.length) best = id;
    }
  }
  return best;
}

/** competitionInPathname with a non-null answer: unscoped routes resolve to
 *  DEFAULT_COMPETITION. For the shell's scope on unscoped routes use the
 *  cookie-aware useCompetitionScope (components/TournamentProvider.tsx). */
export function competitionFromPathname(pathname: string): CompetitionId {
  return competitionInPathname(pathname) ?? DEFAULT_COMPETITION;
}

/* ----------------------------------------------------------------------------
 * The shell (direction G): one tab template, scoped to the current
 * competition, on every route except /embed. Football: Matches, Table,
 * My picks, Leaderboard. NRL: Matches, Ladder, My tips, Leaderboard. A
 * competition with a knockout bracket (WC26) adds Bracket after its table
 * slot (which reads "Groups" there). SiteNav shows these from lg (1024px);
 * BottomNav shows the same list below lg.
 * ------------------------------------------------------------------------- */

/** Stable tab identity. NavIcon and tests key on this, never on label text. */
export type NavTabId = "matches" | "table" | "bracket" | "mypicks" | "leaderboard";

export interface NavTab {
  id: NavTabId;
  label: string;
  href: string;
  /** Pathname prefixes that light this tab (segment-aware: "/play" lights
   *  "/play" and "/play/x", never "/playoffs"). */
  activePrefixes: readonly string[];
  /** Also lit when the pathname equals this exactly (the competition home,
   *  which as a prefix would light on every sub-page). */
  activeExact?: string;
}

/** Every real destination a competition has, for callers that need one link
 *  rather than the tab list (hub cards, CTAs, search). */
export interface CompetitionLinks {
  home: string;
  fixtures: string;
  table: string;
  tableLabel: "Table" | "Ladder" | "Groups";
  picks: string;
  picksLabel: "My picks" | "My tips";
  leaderboard: string;
  bracket: string | null;
}

/** The Table slot's word: "Ladder" in rugby league, "Groups" where the
 *  competition's table IS its group tables (WC26), "Table" everywhere else.
 *  Page headings keep their own vocabulary (UCL's "League phase"). */
export function tableTabLabel(id: CompetitionId): "Table" | "Ladder" | "Groups" {
  const c = COMPETITIONS[id];
  if (c.sport === "nrl") return "Ladder";
  return c.hasGroups ? "Groups" : "Table";
}

export function competitionLinks(id: CompetitionId): CompetitionLinks {
  const c = COMPETITIONS[id];
  const base = c.basePath;
  // NRL keeps its own slugs (/nrl/matches, /nrl/ladder) and its own tips
  // and leaderboard pages.
  const nrl = c.sport === "nrl";
  return {
    home: base,
    fixtures: nrl ? `${base}/matches` : `${base}/fixtures`,
    table: nrl ? `${base}/ladder` : c.hasGroups ? `${base}/groups` : `${base}/standings`,
    tableLabel: tableTabLabel(id),
    picks: nrl ? `${base}/tips` : `/play?competition=${id}`,
    picksLabel: nrl ? "My tips" : "My picks",
    leaderboard: nrl ? `${base}/leaderboard` : `/leaderboard?competition=${id}`,
    bracket: c.hasBracket ? `${base}/bracket` : null,
  };
}

function buildNavTabs(id: CompetitionId): readonly NavTab[] {
  const c = COMPETITIONS[id];
  const base = c.basePath;
  const nrl = c.sport === "nrl";
  const links = competitionLinks(id);
  const tabs: NavTab[] = [
    {
      id: "matches",
      label: "Matches",
      href: links.home,
      activeExact: links.home,
      // Fixtures, match pages, NRL rounds, and the NRL model-record and
      // State of Origin pages all belong to Matches.
      activePrefixes: nrl
        ? [links.fixtures, `${base}/match`, `${base}/round`, `${base}/record`, `${base}/origin`]
        : [links.fixtures, `${base}/match`],
    },
    {
      id: "table",
      label: links.tableLabel,
      href: links.table,
      // Club pages belong to the table, as in the prototype.
      activePrefixes: nrl
        ? [links.table, `${base}/run-home`, `${base}/team`]
        : [`${base}/standings`, `${base}/groups`, `${base}/team`],
    },
  ];
  if (links.bracket) {
    tabs.push({ id: "bracket", label: "Bracket", href: links.bracket, activePrefixes: [links.bracket] });
  }
  tabs.push(
    {
      id: "mypicks",
      label: links.picksLabel,
      href: links.picks,
      activePrefixes: nrl ? [links.picks] : ["/play", "/tips"],
    },
    {
      id: "leaderboard",
      label: "Leaderboard",
      href: links.leaderboard,
      activePrefixes: nrl ? [links.leaderboard] : ["/leaderboard"],
    },
  );
  return tabs;
}

const NAV_TABS = Object.fromEntries(
  (Object.keys(COMPETITIONS) as CompetitionId[]).map((id) => [id, buildNavTabs(id)]),
) as Record<CompetitionId, readonly NavTab[]>;

/** The tabs for a competition scope -- the only nav-link source SiteNav
 *  and BottomNav read. Stable references (built once at module load). */
export function navTabsFor(id: CompetitionId): readonly NavTab[] {
  return NAV_TABS[id];
}

const hitPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

/** Active-state rule shared by both nav surfaces: the tab's exact path, or
 *  any of its prefixes. A route that belongs to no tab ("/" and
 *  "/about") lights none. */
export function isNavTabActive(tab: NavTab, pathname: string): boolean {
  if (tab.activeExact !== undefined && pathname === tab.activeExact) return true;
  return tab.activePrefixes.some((prefix) => hitPrefix(pathname, prefix));
}

/** Collapse the root route's internal aliases to its public pathname.
 *
 *  While a statically-regenerated page is rendered server-side, usePathname()
 *  can surface the route's filesystem name instead of its URL — on Vercel the
 *  root route revalidates as "/index" (empty string is the same family). The
 *  client always computes "/", so any nav branch fed the raw value renders a
 *  different tree server-side and hydration fails site-wide (React #418).
 *  Every layout component that branches on usePathname() must read it through
 *  this. Only the root route has an alias; real routes pass through untouched. */
export function normalizePathname(pathname: string | null): string {
  return !pathname || pathname === "/index" ? "/" : pathname;
}

/** True iff `comp` is both a known CompetitionId and enabled. Used by the
 *  route wrappers to reject unknown or deliberately hidden competitions. */
export function isWiredCompetition(comp: string): comp is CompetitionId {
  return isCompetitionId(comp) && COMPETITIONS[comp].enabled;
}

/** True iff `comp` is a wired competition AND lives in the football
 *  namespace. isWiredCompetition alone isn't enough for the /football/[comp]/...
 *  route wrappers: nrl is a wired competition (enabled: true) but its
 *  basePath is /nrl, not /football/nrl -- so isWiredCompetition("nrl") would
 *  let the wrappers render WC26/football content at /football/nrl instead of
 *  404ing, serving crawlable duplicate content under NRL's own space (see
 *  COMPETITIONS.nrl's comment). Use this in place of isWiredCompetition
 *  wherever the guard is scoped to /football/<comp>. */
export function isWiredFootballCompetition(comp: string): comp is CompetitionId {
  return isWiredCompetition(comp) && COMPETITIONS[comp].sport === "football";
}

/** Competitions for one sport, in stable display order (insertion order of
 *  COMPETITIONS above) -- reused by the CompetitionOverlay (slice 5) and the
 *  sport toggle to list "which competitions does this sport have". */
export function competitionsForSport(sport: SportId): Competition[] {
  return Object.values(COMPETITIONS).filter((c) => c.sport === sport);
}

/** The CSS variable a competition's chip LABEL should be painted in
 *  (`--accent-{id}-ink`). In direction G every competition accent and ink is
 *  the brand green (globals.css), so chips read the same everywhere and the
 *  competition's identity comes from its real logo. Kept as one function so
 *  the chip renderers cannot drift. */
export function accentInkVar(comp: CompetitionId): string {
  return `${COMPETITIONS[comp].accentVar}-ink`;
}

/** True iff `v` is a key of COMPETITIONS -- the validation every untrusted
 *  competition string needs before it is used as a CompetitionId: the fw_comp
 *  cookie, a `?competition=` query value, a backend `competition` field.
 *  Own-property check, not `in`: `"toString" in COMPETITIONS` is true via the
 *  prototype, so `?competition=toString` used to pass and crash the render. */
export function isCompetitionId(v: string): v is CompetitionId {
  return Object.prototype.hasOwnProperty.call(COMPETITIONS, v);
}

/** Canonical, competition-scoped hrefs for football content. Build every
 *  match/team link from the competition when it is known: the unscoped
 *  /match/:id and /team/:id routes only exist as lookups for old links
 *  (embeds, shares since June) and cost a server round trip plus a 308.
 *  NRL matches use a composite (season/round/no) key and are not covered here. */
export function footballMatchHref(comp: CompetitionId, matchId: number | string): string {
  return `${COMPETITIONS[comp].basePath}/match/${matchId}`;
}

export function footballTeamHref(comp: CompetitionId, teamId: number | string): string {
  return `${COMPETITIONS[comp].basePath}/team/${teamId}`;
}

/** Reads an untrusted competition value (an optional backend field, a query
 *  string) as a wired football competition, or null. */
export function asFootballCompetition(value: unknown): CompetitionId | null {
  return typeof value === "string" && isWiredFootballCompetition(value) ? value : null;
}

/** For callers that may not know the match's competition: the scoped page
 *  when they do, else the /match/:id lookup route (app/match/[id]), which asks
 *  the backend for the competition and 308s to the scoped page. Never guesses
 *  a competition -- guessing WC26 is what soft-404'd every club match. */
export function footballMatchHrefOrLookup(
  matchId: number | string,
  competition?: unknown,
): string {
  const comp = asFootballCompetition(competition);
  return comp ? footballMatchHref(comp, matchId) : `/match/${matchId}`;
}
