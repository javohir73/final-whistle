"use client";

/** Global search (the header's magnifier): one field, "Search clubs, matches
 *  and pages", grouped results that are plain links.
 *
 *  Built only from data the app already serves — no search endpoint:
 *    - clubs: GET /api/teams?competition=… for each live football competition,
 *      and the NRL clubs named in GET /api/nrl/matches;
 *    - matches: the current competition's upcoming fixtures
 *      (GET /api/matches/upcoming, or the NRL draw for NRL);
 *    - pages: a static list built from the competition registry.
 *  Nothing is fetched until the dialog is first opened; results are kept for
 *  the rest of the visit. A failed request just leaves its group empty. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClubBadge } from "@/components/ClubBadge";
import { IconButton, Modal, SearchIcon, CloseIcon } from "@/components/ui";
import { getNrlMatches, getTeams, getUpcomingMatches } from "@/lib/api";
import {
  COMPETITIONS,
  competitionLinks,
  footballMatchHref,
  footballTeamHref,
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
};

type Loaded = { clubs: SearchItem[]; matches: Partial<Record<CompetitionId, SearchItem[]>> };

const LIVE_FOOTBALL = (Object.values(COMPETITIONS) as Array<(typeof COMPETITIONS)[CompetitionId]>).filter(
  (c) => c.sport === "football" && c.enabled && !c.archived,
);

/** Static pages: the competition's own tabs first, then every other
 *  competition's home, then the about pages. */
export function pageItems(current: CompetitionId): SearchItem[] {
  const c = COMPETITIONS[current];
  const links = competitionLinks(current);
  const own: SearchItem[] = [
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

const dayFormat = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" })
    .format(d)
    .replace(/,/g, "");
};

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
  if (c.sport === "nrl") {
    const data = await getNrlMatches();
    const now = Date.now();
    return data.rounds.flatMap((round) =>
      round.matches
        .filter((m) => m.home && m.away && m.kickoff_utc && Date.parse(m.kickoff_utc) > now && round.round != null)
        .map<SearchItem>((m) => ({
          kind: "match",
          label: `${m.home} v ${m.away}`,
          context: [`Round ${round.round}`, dayFormat(m.kickoff_utc)].filter(Boolean).join(" · "),
          href: `/nrl/match/${data.season}/${round.round}/${m.match_no}`,
        })),
    );
  }
  const list = await getUpcomingMatches(comp);
  return list.map<SearchItem>((m) => ({
    kind: "match",
    label: `${m.teams.home} v ${m.teams.away}`,
    context: [m.matchweek ? `Matchweek ${m.matchweek}` : c.label, dayFormat(m.kickoff_utc)]
      .filter(Boolean)
      .join(" · "),
    href: footballMatchHref(comp, m.match_id),
  }));
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

export function searchGroups(
  query: string,
  current: CompetitionId,
  data: Loaded,
): Array<{ heading: string; items: SearchItem[] }> {
  const q = query.trim().toLowerCase();
  const pages = pageItems(current);
  if (!q) return [{ heading: "Go to", items: pages.slice(0, 8) }];
  const clubs = rank(data.clubs, q).slice(0, 6);
  const matches = rank(data.matches[current] ?? [], q).slice(0, 4);
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
  const groups = useMemo(() => searchGroups(query, competition, data), [query, competition, data]);

  // A result navigates; close on the route change it causes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = () => {
    setOpen(false);
    setQuery("");
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
            className="h-[52px] min-w-0 flex-1 rounded-input border border-line bg-ground px-4 text-[17px] text-ink placeholder:text-muted focus-visible:border-brand [&::-webkit-search-cancel-button]:appearance-none"
          />
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
                        className={cn(
                          "flex min-h-[48px] items-center justify-between gap-4 rounded-[10px] px-3.5 py-2.5 font-semibold text-ink no-underline hover:bg-soft focus-visible:bg-soft",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          {item.crest && <ClubBadge name={item.crest} size={22} decorative />}
                          <span className="min-w-0 truncate">{item.label}</span>
                        </span>
                        <small className="shrink-0 text-right text-sm font-normal text-muted">{item.context}</small>
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
