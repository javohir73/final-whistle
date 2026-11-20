"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon } from "@/components/NavIcon";
import { useCompetitionScope } from "@/components/TournamentProvider";
import { isNavTabActive, navTabsFor, normalizePathname } from "@/lib/sports";
import { cn } from "@/lib/utils";

/** Phone/tablet tab bar (below lg): the same tabs as the header row, in the
 *  same order, on every route except /embed — Matches, Table, My picks,
 *  Leaderboard (NRL: Matches, Ladder, My tips, Leaderboard; WC26 adds
 *  Bracket) — scoped to the current competition (lib/sports.ts navTabsFor).
 *  White ground, a line on top, muted labels, brand for the current tab. */
export function BottomNav() {
  return (
    <Suspense fallback={<BottomNavContent queryCompetition={null} />}>
      <BottomNavWithCompetition />
    </Suspense>
  );
}

function BottomNavWithCompetition() {
  return <BottomNavContent queryCompetition={useSearchParams().get("competition")} />;
}

function BottomNavContent({ queryCompetition }: { queryCompetition: string | null }) {
  // Through normalizePathname — same hydration contract as SiteNav: the root
  // route revalidates under its "/index" alias and must render what the
  // client computes for "/".
  const pathname = normalizePathname(usePathname());
  const { competition } = useCompetitionScope(queryCompetition);
  // /embed/[matchId] is a standalone, partner-iframeable widget — it must not
  // carry the full site chrome.
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return null;
  const tabs = navTabsFor(competition);

  // lg:hidden, not sm:hidden — paired with SiteNav's link row, which is
  // lg:flex for the same reason. The two must swap at the SAME breakpoint or
  // one width band gets both (clutter) or neither (no primary navigation).
  // The old sm handoff put the header row on screen at 640px, where it did
  // not fit; 640-1023px now keeps this tab bar instead.
  return (
    <nav
      aria-label="Primary"
      className="safe-x safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ground lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isNavTabActive(tab, pathname);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-tab={tab.id}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-label font-medium leading-tight no-underline transition-colors",
                active ? "font-semibold text-brand" : "text-muted hover:text-ink",
              )}
            >
              <NavIcon id={tab.id} active={active} className="h-[22px] w-[22px]" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
