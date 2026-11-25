"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandMark, Wordmark } from "@/components/Logo";
import { AuthButton } from "@/components/AuthButton";
import { CompetitionOverlay } from "@/components/CompetitionOverlay";
import { SiteSearch } from "@/components/SiteSearch";
import { useCompetitionScope } from "@/components/TournamentProvider";
import {
  isNavTabActive,
  navTabsFor,
  normalizePathname,
} from "@/lib/sports";
import { cn } from "@/lib/utils";

/** Top bar (direction G): the FinalWhistle mark + wordmark, the main tabs
 *  for the current competition with an underline on the current one
 *  (Matches, Table, My picks, Leaderboard; NRL: Matches, Ladder, My tips,
 *  Leaderboard), then the competition pill, search and the sign-in button or
 *  account pill. The tab row shows from lg (1024px); below that the same
 *  tabs live in the bottom tab bar (BottomNav, lg:hidden), so navigation is
 *  reachable exactly once at every width. */
export function SiteNav() {
  return (
    <Suspense fallback={<SiteNavContent queryCompetition={null} />}>
      <SiteNavWithCompetition />
    </Suspense>
  );
}

function SiteNavWithCompetition() {
  return <SiteNavContent queryCompetition={useSearchParams().get("competition")} />;
}

function SiteNavContent({ queryCompetition }: { queryCompetition: string | null }) {
  // Through normalizePathname: the raw value is "/index" during the root
  // route's ISR revalidation, and the server must render exactly what the
  // client computes for "/" or hydration fails site-wide.
  const pathname = normalizePathname(usePathname());
  const { competition } = useCompetitionScope(queryCompetition);
  // /embed/[matchId] is a standalone, partner-iframeable widget — it must not
  // carry the full site chrome.
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return null;
  const tabs = navTabsFor(competition);

  return (
    <header className="border-b border-line bg-ground">
      <div className="fw-wrap flex min-h-[64px] items-center gap-3 lg:min-h-[72px] lg:gap-6 xl:gap-10">
        <Link
          href="/"
          aria-label="FinalWhistle home"
          // 44×44 hit area round the 30×27 mark; the negative margin cancels the
          // padding so the mark and the bar's layout do not move.
          className="-mx-[7px] flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2.5 rounded-lg px-[7px] text-ink no-underline"
        >
          <BrandMark className="h-[27px] w-[30px] shrink-0 text-brand" />
          {/* Below sm the mark stands alone: the bar also has to fit the
              competition pill, search and Sign in inside 360px. The link's
              aria-label keeps the accessible name. */}
          <Wordmark className="hidden text-[22px] font-bold tracking-[-0.02em] sm:inline" />
        </Link>

        <nav aria-label="Main" className="hidden gap-6 self-stretch lg:flex xl:gap-8">
          {tabs.map((tab) => {
            const active = isNavTabActive(tab, pathname);
            return (
              <Link
                key={tab.id}
                href={tab.href}
                data-tab={tab.id}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center whitespace-nowrap border-b-2 pb-5 pt-[22px] text-[17px] no-underline transition-colors",
                  active
                    ? "border-brand font-semibold text-ink"
                    : "border-transparent font-medium text-muted hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <CompetitionOverlay competition={competition} />
          <SiteSearch competition={competition} />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
