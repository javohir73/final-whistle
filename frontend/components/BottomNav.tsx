"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/NavIcon";
import {
  COMPETITIONS,
  competitionFromPathname,
  isCompetitionHomeHref,
  isPlatformPathname,
  normalizePathname,
} from "@/lib/sports";
import { useTournament } from "@/components/TournamentProvider";
import { cn } from "@/lib/utils";

const PLATFORM_TABS = [
  { href: "/", label: "Home", activePrefixes: [] },
  { href: "/football/epl", label: "Football", activePrefixes: [] },
  { href: "/nrl", label: "NRL", activePrefixes: [] },
  { href: "/play", label: "Play", activePrefixes: [] },
  {
    href: "/leaderboard",
    label: "You",
    activePrefixes: ["/about", "/methodology", "/privacy", "/terms"],
  },
];

function matches(pathname: string, prefixes: string[], href: string): boolean {
  // Competition home links ("/football/wc26", "/nrl") need exact-match
  // semantics — otherwise they prefix-match every sub-page of that
  // competition (e.g. "/nrl" would stay lit on "/nrl/matches") and two tabs
  // end up active at once.
  if (isCompetitionHomeHref(href)) return pathname === href || prefixes.some((p) => hit(pathname, p));
  return hit(pathname, href) || prefixes.some((p) => hit(pathname, p));
}

const hit = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(prefix + "/");

/** Mobile-only sticky bottom tab bar. Exactly five destinations — Home,
 *  Matches, Groups, Play and You — each one tap away, no overflow sheet. */
export function BottomNav() {
  // Through normalizePathname — same hydration contract as SiteNav: the root
  // route revalidates under its "/index" alias and must still render the
  // platform tabs the client computes for "/".
  const pathname = normalizePathname(usePathname());
  const { has_brackets } = useTournament();
  // /embed/[matchId] is a standalone, partner-iframeable widget — it must not
  // carry the full site chrome.
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return null;
  // Floodlight P5 folded the old mutually-exclusive Bracket/Tips slot into one
  // always-on Play tab, so this filter no longer removes anything (no navLink
  // sets requiresBrackets/requiresLeagueFormat now) -- it's kept intact so the
  // gating still works if any future tab reintroduces those flags.
  const tabs =
    isPlatformPathname(pathname)
      ? PLATFORM_TABS
      : COMPETITIONS[competitionFromPathname(pathname)].navLinks.filter(
          (tab) =>
            (!tab.requiresBrackets || has_brackets) &&
            (!tab.requiresLeagueFormat || !has_brackets),
        );

  // lg:hidden, not sm:hidden — paired with SiteNav's link row, which is
  // lg:flex for the same reason. The two must swap at the SAME breakpoint or
  // one width band gets both (clutter) or neither (no primary navigation).
  // The old sm handoff put the header row on screen at 640px, where it did
  // not fit; 640-1023px now keeps this tab bar instead.
  return (
    <nav
      aria-label="Primary"
      className="safe-x safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/90 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((tab) => {
          const active = matches(pathname, tab.activePrefixes, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] flex-1 flex-col items-center gap-1 py-2.5 text-label font-medium transition",
                active ? "text-lime-deep" : "text-muted hover:text-foreground",
              )}
            >
              <NavIcon name={tab.label} active={active} className="h-[23px] w-[23px]" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
