"use client";

/** Global search (the header's magnifier): one field, "Search clubs, matches
 *  and pages", grouped results that are plain links.
 *
 *  Built only from data the app already serves — no search endpoint:
 *    - clubs: GET /api/teams?competition=… for each live football competition,
 *      and the NRL clubs named in GET /api/nrl/matches;
 *    - matches: the current competition's season list
 *      (GET /api/matches/upcoming — fixtures and results — or the NRL draw),
 *      ordered by how near kick-off is to now: upcoming first, then the most
 *      recent results. Never a model score or percentage: an open fixture
 *      shows its kick-off, a finished one its final score;
 *    - pages: a static list built from the competition registry.
 *  Nothing is fetched until the dialog is first opened; results are kept for
 *  the rest of the visit. A failed request just leaves its group empty. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClubBadge } from "@/components/ClubBadge";
import { IconButton, Modal, SearchIcon, CloseIcon } from "@/components/ui";
import { getNrlMatches, getTeams, getUpcomingMatches } from "@/lib/api";
import { kickoffTime } from "@/lib/datetime";
import { useTimezone } from "@/lib/useTimezone";
import {
  COMPETITIONS,
  competitionLinks,
  footballMatchHref,
  footballTeamHref,
  navTabsFor,
  type CompetitionId,
} from "@/lib/sports";
import { cn } from "@/lib/utils";

export type SearchItem = {
  kind: "club" | "match" | "page";
  label: string;
  context: string;
  href: string;
  /** Club name for the crest (clubs only). */
  crest?: string;
  /** Matches only: kick-off (ms since epoch) and the real final score once
   *  the match is finished. Never the model's call. */
  kickoff?: number;
  final?: { home: number; away: number } | null;
  /** Matches only: in play right now. */
  live?: boolean;
};

type Loaded = { clubs: SearchItem[]; matches: Partial<Record<CompetitionId, SearchItem[]>> };

const LIVE_FOOTBALL = (Object.values(COMPETITIONS) as Array<(typeof COMPETITIONS)[CompetitionId]>).filter(
  (c) => c.sport === "football" && c.enabled && !c.archived,
);

/** UFC's own pages, straight from its nav tabs (Card, Events): it has no
 *  picks, leaderboard, bracket or model record to offer. */
function ufcOwnPages(current: CompetitionId): SearchItem[] {
  return navTabsFor(current).map((t) => ({
    kind: "page" as const,
    label: t.label,
    context: COMPETITIONS[current].label,
    href: t.href,
  }));
}

/** Static pages: the competition's own tabs first, then every other
 *  competition's home, then the about pages. */
export function pageItems(current: CompetitionId): SearchItem[] {
  const c = COMPETITIONS[current];
  const links = competitionLinks(current);
  const own: SearchItem[] =
    c.sport === "ufc"
      ? ufcOwnPages(current)
      : [
          { kind: "page", label: "Matches", context: c.label, href: links.home },
          { kind: "page", label: links.tableLabel, context: c.label, href: links.table },
          { kind: "page", label: links.picksLabel, context: c.label, href: links.picks },
          { kind: "page", label: "Leaderboard", context: c.label, href: links.leaderboard },
        ];
  if (links.bracket) own.push({ kind: "page", label: "Bracket", context: c.label, href: links.bracket });
  const others: SearchItem[] = (Object.values(COMPETITIONS) as Array<(typeof COMPETITIONS)[CompetitionId]>)
    .filter((x) => x.enabled && x.id !== current)
    .map((x) => ({
      kind: "page" as const,
      label: x.label,
      context: x.archived ? "Past tournament" : "Competition",
      href: x.basePath,
    }));
  const extra: SearchItem[] = [];
  for (const x of Object.values(COMPETITIONS)) {
    if (x.recordPath) {
      extra.push({
        kind: "page",
        label: x.sport === "nrl" ? "The model's NRL record" : `The model's ${x.label} record`,
        context: "Record",
        href: x.recordPath,
      });
    }
  }
  extra.push(
    { kind: "page", label: "State of Origin", context: "NRL", href: "/nrl/origin" },
    { kind: "page", label: "How the model works", context: "About", href: "/about" },
    { kind: "page", label: "Methodology", context: "About", href: "/methodology" },
    { kind: "page", label: "Privacy", context: "About", href: "/privacy" },
    { kind: "page", label: "Terms", context: "About", href: "/terms" },
  );
  return [...own, ...others, ...extra];
}

/** What the dialog shows before anything is typed (prototype "Go to"):
 *  the current competition's own pages, the other sport's home, the model's
 *  record where one exists, and how the model works. Real links only. */
export function goToItems(current: CompetitionId): SearchItem[] {
  const c = COMPETITIONS[current];
  const links = competitionLinks(current);
  const items: SearchItem[] =
    c.sport === "ufc"
      ? ufcOwnPages(current)
      : [
          { kind: "page", label: "Matches", context: c.label, href: links.home },
          { kind: "page", label: links.tableLabel, context: c.label, href: links.table },
        ];
  if (links.bracket) items.push({ kind: "page", label: "Bracket", context: c.label, href: links.bracket });
  if (c.sport !== "ufc") {
    items.push(
      { kind: "page", label: "Leaderboard", context: c.label, href: links.leaderboard },
      { kind: "page", label: links.picksLabel, context: c.label, href: links.picks },
    );
  }
  const other = c.sport === "nrl" ? COMPETITIONS.epl : COMPETITIONS.nrl;
  if (other.enabled) items.push({ kind: "page", label: other.label, context: "Competition", href: other.basePath });
  const record = c.recordPath ?? (other.recordPath && !other.archived ? other.recordPath : null);
  if (record) {
    const owner = c.recordPath ? c : other;
    items.push({
      kind: "page",
      label: owner.sport === "nrl" ? "The model's NRL record" : `The model's ${owner.label} record`,
      context: "Record",
      href: record,
    });
  }
  items.push({ kind: "page", label: "How the model works", context: "About", href: "/about" });
  return items;
}

/** "Sunday 22 November · 4:30 pm" in the viewer's timezone. */
function kickoffText(ms: number, tz: string): string {
  const d = new Date(ms);
  const iso = d.toISOString();
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })
    .format(d)
    .replace(/,/g, "");
  return `${day} · ${kickoffTime(iso, tz).toLowerCase()}`;
}

/** The right-hand line of a result. For a match: where it sits, then the
 *  kick-off (open fixture), "Live" or the final score — never the model's. */
export function contextFor(item: SearchItem, tz: string): string {
  if (item.kind !== "match") return item.context;
  if (item.final) return `${item.context} · Full time ${item.final.home}–${item.final.away}`;
  if (item.live) return `${item.context} · Live`;
  if (item.kickoff != null && Number.isFinite(item.kickoff)) return `${item.context} · ${kickoffText(item.kickoff, tz)}`;
  return item.context;
}

/** A match from the season list, or null when it has nothing worth listing
 *  (no kick-off, called off, or "open" with a kick-off long gone). */
function matchItem(
  m: { home: string; away: string; kickoff: string | null; status: string; scoreHome: number | null; scoreAway: number | null },
  context: string,
  href: string,
): SearchItem | null {
  const kickoff = m.kickoff ? Date.parse(m.kickoff) : NaN;
  if (!Number.isFinite(kickoff)) return null;
  const finished = m.status === "finished";
  if (!finished && m.status !== "scheduled" && m.status !== "in_play") return null;
  return {
    kind: "match",
    label: `${m.home} v ${m.away}`,
    context,
    href,
    kickoff,
    final: finished && m.scoreHome != null && m.scoreAway != null ? { home: m.scoreHome, away: m.scoreAway } : null,
    live: m.status === "in_play",
  };
}

let cache: Promise<Loaded> | null = null;
const matchCache = new Map<CompetitionId, Promise<SearchItem[]>>();

async function loadClubs(): Promise<SearchItem[]> {
  const football = await Promise.allSettled(
    LIVE_FOOTBALL.map(async (c) =>
      (await getTeams(c.id)).map<SearchItem>((t) => ({
        kind: "club",
        label: t.name,
        context: c.label,
        href: footballTeamHref(c.id, t.id),
        crest: t.name,
      })),
    ),
  );
  const clubs = football.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  try {
    const nrl = await getNrlMatches();
    const seen = new Map<number, string>();
    for (const round of nrl.rounds) {
      for (const m of round.matches) {
        if (m.home && m.home_team_id != null) seen.set(m.home_team_id, m.home);
        if (m.away && m.away_team_id != null) seen.set(m.away_team_id, m.away);
      }
    }
    for (const [id, name] of seen) {
      clubs.push({ kind: "club", label: name, context: "NRL", href: `/nrl/team/${id}`, crest: name });
    }
  } catch {
    /* NRL clubs just go missing from the results */
  }
  return clubs;
}

async function loadMatches(comp: CompetitionId): Promise<SearchItem[]> {
  const c = COMPETITIONS[comp];
  const out: SearchItem[] = [];
  // UFC has no match list to search; resolve empty without a request.
  if (c.sport === "ufc") return out;
  if (c.sport === "nrl") {
    const data = await getNrlMatches();
    for (const round of data.rounds) {
      if (round.round == null) continue;
      for (const m of round.matches) {
        if (!m.home || !m.away) continue;
        const item = matchItem(
          { home: m.home, away: m.away, kickoff: m.kickoff_utc, status: m.status, scoreHome: m.score_home, scoreAway: m.score_away },
          `Round ${round.round}`,
          `/nrl/match/${data.season}/${round.round}/${m.match_no}`,
        );
        if (item) out.push(item);
      }
    }
    return out;
  }
  const list = await getUpcomingMatches(comp);
  for (const m of list) {
    const item = matchItem(
      {
        home: m.teams.home,
        away: m.teams.away,
        kickoff: m.kickoff_utc,
        status: m.status,
        scoreHome: m.score_home ?? null,
        scoreAway: m.score_away ?? null,
      },
      m.matchweek ? `Matchweek ${m.matchweek}` : c.label,
      footballMatchHref(comp, m.match_id),
    );
    if (item) out.push(item);
  }
  return out;
}

function useSearchData(open: boolean, competition: CompetitionId) {
  const [data, setData] = useState<Loaded>({ clubs: [], matches: {} });
  useEffect(() => {
    if (!open) return;
    let live = true;
    if (!cache) cache = loadClubs().then((clubs) => ({ clubs, matches: {} }));
    cache.then((d) => live && setData((prev) => ({ ...prev, clubs: d.clubs })));
    const c = COMPETITIONS[competition];
    if (!c.archived) {
      if (!matchCache.has(competition)) {
        matchCache.set(competition, loadMatches(competition).catch(() => []));
      }
      matchCache.get(competition)!.then(
        (items) => live && setData((prev) => ({ ...prev, matches: { ...prev.matches, [competition]: items } })),
      );
    }
    return () => {
      live = false;
    };
  }, [open, competition]);
  return data;
}

/** Rank by "starts with" before "contains", then alphabetically. */
function rank(items: SearchItem[], q: string): SearchItem[] {
  return items
    .filter((i) => i.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.label.localeCompare(b.label);
    });
}

/** How many matches the "Matches" group lists, and how many of those are
 *  upcoming fixtures when there are results to show too. */
const MATCH_CAP = 4;
const UPCOMING_CAP = 3;
/** An unfinished match whose kick-off is this long gone is stale data, not "now". */
const STALE_MS = 6 * 60 * 60 * 1000;

/** Matches around now: upcoming fixtures (and live ones) in kick-off order,
 *  then the most recent results, newest first. Up to UPCOMING_CAP fixtures
 *  so the latest result still shows; either side fills the other's gap. */
export function nearestMatches(items: SearchItem[], now: number, cap = MATCH_CAP): SearchItem[] {
  const upcoming = items
    .filter((m) => !m.final && m.kickoff != null && (m.live || m.kickoff >= now - STALE_MS))
    .sort((a, b) => a.kickoff! - b.kickoff!);
  const results = items.filter((m) => m.final && m.kickoff != null).sort((a, b) => b.kickoff! - a.kickoff!);
  const up = upcoming.slice(0, results.length ? Math.min(UPCOMING_CAP, cap) : cap);
  return [...up, ...results.slice(0, cap - up.length)];
}

export function searchGroups(
  query: string,
  current: CompetitionId,
  data: Loaded,
  now: number = Date.now(),
): Array<{ heading: string; items: SearchItem[] }> {
  const q = query.trim().toLowerCase();
  const pages = pageItems(current);
  if (!q) return [{ heading: "Go to", items: goToItems(current) }];
  const clubs = rank(data.clubs, q).slice(0, 6);
  const matches = nearestMatches(
    (data.matches[current] ?? []).filter((m) => m.label.toLowerCase().includes(q)),
    now,
  );
  const pageHits = rank(pages, q).slice(0, 4);
  return [
    { heading: "Clubs", items: clubs },
    { heading: "Matches", items: matches },
    { heading: "Pages", items: pageHits },
  ].filter((g) => g.items.length > 0);
}

export function SiteSearch({ competition }: { competition: CompetitionId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const data = useSearchData(open, competition);
  const { tz } = useTimezone();
  const groups = useMemo(() => searchGroups(query, competition, data), [query, competition, data]);

  // A result navigates; close on the route change it causes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const clear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const links = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("a") ?? []);
  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      links()[0]?.focus();
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = links();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[Math.min(at + 1, list.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (at <= 0) inputRef.current?.focus();
      else list[at - 1]?.focus();
    }
  };

  const q = query.trim();
  return (
    <>
      <IconButton ref={triggerRef} label="Search" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <SearchIcon />
      </IconButton>
      <Modal
        open={open}
        onClose={close}
        label="Search"
        size="search"
        initialFocus={inputRef}
        returnFocus={triggerRef}
      >
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search clubs, matches and pages"
              aria-label="Search clubs, matches and pages"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "h-[52px] w-full rounded-input border border-line bg-ground px-4 text-[17px] text-ink placeholder:text-muted focus-visible:border-brand [&::-webkit-search-cancel-button]:appearance-none",
                query && "pr-12",
              )}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clear}
                className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-soft"
              >
                <CloseIcon size={16} />
              </button>
            ) : null}
          </div>
          <IconButton label="Close" onClick={close} className="mt-1">
            <CloseIcon />
          </IconButton>
        </div>
        <div
          ref={listRef}
          onKeyDown={onListKey}
          className="flex max-h-[52vh] flex-col overflow-y-auto pt-2"
        >
          {groups.length === 0 ? (
            <p className="px-3.5 py-4 text-muted">
              Nothing matches “{q}”. Try a club, such as Arsenal or Roosters.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.heading} aria-label={g.heading}>
                <h3 className="px-3.5 pb-1 pt-2.5 text-label font-medium text-muted">{g.heading}</h3>
                <ul>
                  {g.items.map((item) => (
                    <li key={`${item.kind}:${item.href}`}>
                      <Link
                        href={item.href}
                        onClick={close}
                        className="flex min-h-[48px] items-center justify-between gap-4 rounded-[10px] px-3.5 py-2.5 font-semibold text-ink no-underline hover:bg-soft focus-visible:bg-soft"
                      >
                        {/* Both sides wrap (prototype): a long fixture name
                            takes two lines rather than being cut. */}
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          {item.crest && <ClubBadge name={item.crest} size={22} decorative className="shrink-0" />}
                          <span className="min-w-0 break-words">{item.label}</span>
                        </span>
                        <small className="max-w-[55%] shrink-0 text-right text-sm font-normal text-muted">
                          {contextFor(item, tz)}
                        </small>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
