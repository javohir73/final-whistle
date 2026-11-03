"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrandMark, Wordmark } from "@/components/Logo";
import { NavIcon } from "@/components/NavIcon";
import { AuthButton } from "@/components/AuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompetitionOverlay } from "@/components/CompetitionOverlay";
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

/** The one persistent route to /premium. Deliberately outside the five-tab
 *  template (lib/sports.ts navTabsFor): the tabs are the same five on every
 *  route by design, so Premium lives in the header next to the account
 *  control. Rendered on mobile too (never `hidden`): BottomNav's five tabs
 *  are capped by design, so the header is what covers small screens.
 *  Nothing renders mid session-check or when billing is off — which is why
 *  the overflow this element contributes only ever appeared on a configured
 *  production deploy, and never locally with billing off. */
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
        "ml-auto mr-0.5 inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-lime-deep transition hover:bg-win/10 lg:ml-0 lg:mr-1 lg:px-3",
        subscribed && "ring-1 ring-win/30",
      )}
    >
      Premium
    </Link>
  );
}

/** Top bar (Daylight): brand lockup and the competition chip on the left, a
 *  desktop-only link row (the same five tabs as BottomNav, scoped to the
 *  current competition), then Premium, the theme toggle and the account /
 *  sign-in control. The link row is lg-only — below that the bottom tab bar
 *  handles navigation. */
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
    <header className="border-b border-border bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-5">
        <Link
          href="/"
          aria-label="FinalWhistle home"
          className="group flex shrink-0 items-center gap-2.5"
        >
          <BrandMark className="h-7 w-auto shrink-0 text-lime-deep transition group-hover:opacity-90" />
          {/* Below sm the hexagon mark stands alone. The wordmark is ~100px —
              the single largest item in a header that also has to fit the
              competition switcher, Premium, the theme toggle and Sign in
              inside 320px. aria-label on the link keeps the accessible name,
              so this costs nothing but pixels. */}
          <Wordmark className="hidden text-lg font-extrabold sm:inline" />
        </Link>

        {/* On every route, including /, /play and /leaderboard: the scope the
            tabs follow is always visible and one tap from switching. */}
        <CompetitionOverlay competition={competition} />

        {/* lg, not sm. This row needs ~450px on its own; at the old sm (640px)
            breakpoint it appeared while the header still had to fit the brand,
            the switcher, Premium, the toggle and Sign in — so 768px rendered a
            903px-wide nav and pushed Sign in 135px off screen. BottomNav's
            matching lg:hidden means tablets keep a full tab bar instead of
            losing navigation in the gap. */}
        <div className="ml-auto mr-2 hidden items-center gap-1 lg:flex">
          {tabs.map((tab) => {
            const active = isNavTabActive(tab, pathname);
            return (
              <Link
                key={tab.id}
                href={tab.href}
                data-tab={tab.id}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition",
                  active
                    ? "bg-win/10 font-semibold text-lime-deep"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <NavIcon id={tab.id} active={active} className="h-[17px] w-[17px]" />
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* Premium carries the competition only when the URL names one (a
            remembered preference is not context the visitor gave this page),
            and a way back only from a competition page. */}
        <PremiumNavLink
          competition={fromUrl ? competition : undefined}
          returnTo={onCompetitionRoute ? pathname : undefined}
        />
        <ThemeToggle />
        <AuthButton />
      </nav>
    </header>
  );
}
