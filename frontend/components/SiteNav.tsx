"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandMark, Wordmark } from "@/components/Logo";
import { AuthButton } from "@/components/AuthButton";
import { CompetitionOverlay } from "@/components/CompetitionOverlay";
import { SiteSearch } from "@/components/SiteSearch";
import { useAuth } from "@/components/AuthProvider";
import { useCompetitionScope } from "@/components/TournamentProvider";
import { BILLING_ENABLED } from "@/lib/constants";
import {
  competitionInPathname,
  isNavTabActive,
  navTabsFor,
  normalizePathname,
} from "@/lib/sports";
import { cn } from "@/lib/utils";

/** The one persistent route to /premium. Deliberately outside the tab
 *  template (lib/sports.ts navTabsFor), so Premium lives in the header next
 *  to the account control. Rendered on phones too (never `hidden`): the
 *  bottom tab bar carries only the competition tabs, so the header is what
 *  covers small screens. Nothing renders mid session-check or when billing
 *  is off. */
function PremiumNavLink({
  competition,
  returnTo,
}: {
  competition?: string;
  returnTo?: string;
}) {
  const { user, loading } = useAuth();
  if (!BILLING_ENABLED || loading) return null;

  // Subscribers get the link too, as a member badge rather than a pitch.
  //
  // This used to return null for them, which left /premium unreachable from
  // navigation for the only people paying for it. Their sole route to
  // cancelling or changing a card was one item inside the avatar dropdown —
  // and, worse, /premium is where the past_due "there's a payment issue"
  // banner renders, so a subscriber whose card had just failed was shown that
  // warning on a page they could no longer navigate to.
  const subscribed = Boolean(user?.premium);
  const query = new URLSearchParams();
  if (competition) query.set("competition", competition);
  if (returnTo) query.set("returnTo", returnTo);
  const premiumHref = query.toString() ? `/premium?${query}` : "/premium";

  return (
    <Link
      href={premiumHref}
      // Accessible name stays "Premium" in both states — the destination is the
      // same page and an aria-label that varies by entitlement would just make
      // the control harder to refer to. Membership is marked visually (a ring)
      // and exposed to tests via data-member.
      data-member={subscribed ? "true" : "false"}
      title={subscribed ? "Your Premium membership and billing" : "About FinalWhistle Premium"}
      className={cn(
        "inline-flex min-h-[44px] shrink-0 items-center rounded-full px-2 font-semibold text-brand no-underline underline-offset-[3px] hover:underline sm:px-3",
        subscribed && "border border-brand-soft",
      )}
    >
      Premium
    </Link>
  );
}

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
  const { competition, fromUrl } = useCompetitionScope(queryCompetition);
  // /embed/[matchId] is a standalone, partner-iframeable widget — it must not
  // carry the full site chrome.
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return null;
  const tabs = navTabsFor(competition);
  const onCompetitionRoute = competitionInPathname(pathname) !== null;

  return (
    <header className="border-b border-line bg-ground">
      <div className="fw-wrap flex min-h-[64px] items-center gap-3 lg:min-h-[72px] lg:gap-6 xl:gap-10">
        <Link
          href="/"
          aria-label="FinalWhistle home"
          className="flex shrink-0 items-center gap-2.5 text-ink no-underline"
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
          {/* Premium carries the competition only when the URL names one (a
              remembered preference is not context the visitor gave this
              page), and a way back only from a competition page. */}
          <PremiumNavLink
            competition={fromUrl ? competition : undefined}
            returnTo={onCompetitionRoute ? pathname : undefined}
          />
          <CompetitionOverlay competition={competition} compact={BILLING_ENABLED} />
          <SiteSearch competition={competition} />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
