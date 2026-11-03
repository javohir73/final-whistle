"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon } from "@/components/NavIcon";
import { useCompetitionScope } from "@/components/TournamentProvider";
import { isNavTabActive, navTabsFor, normalizePathname } from "@/lib/sports";
import { cn } from "@/lib/utils";

/** Mobile-only sticky bottom tab bar: the same five tabs in the same order on
 *  every route except /embed — Home, Fixtures, Table, Play, My picks — scoped
 *  to the current competition (lib/sports.ts navTabsFor). Only the
 *  destinations and the Table slot's word ("Ladder", "Groups") change. */
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
      className="safe-x safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/90 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isNavTabActive(tab, pathname);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-tab={tab.id}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[44px] flex-1 flex-col items-center gap-1 py-2.5 text-label font-medium transition",
                active ? "text-lime-deep" : "text-muted hover:text-foreground",
              )}
            >
              <NavIcon id={tab.id} active={active} className="h-[23px] w-[23px]" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
