"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, Wordmark } from "@/components/Logo";
import { NavIcon } from "@/components/NavIcon";
import { AuthButton } from "@/components/AuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompetitionOverlay } from "@/components/CompetitionOverlay";
import { useAuth } from "@/components/AuthProvider";
import { BILLING_ENABLED } from "@/lib/constants";
import {
  COMPETITIONS,
  competitionFromPathname,
  isCompetitionHomeHref,
  isPlatformPathname,
  normalizePathname,
} from "@/lib/sports";
import { useTournament } from "@/components/TournamentProvider";
import { cn } from "@/lib/utils";

const PLATFORM_LINKS = [
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

/** The one persistent route to /premium. Deliberately outside both link
 *  registries: the row below is PLATFORM_LINKS on platform routes and
 *  COMPETITIONS[id].navLinks on competition routes, so an entry in either one
 *  disappears on the other half of the site — a "Premium" item in
 *  PLATFORM_LINKS would vanish the moment a visitor opens /football/epl.
 *  Rendered on mobile too (no `hidden sm:*`): BottomNav's five tabs are capped
 *  by design, so the header is what covers small screens. Nothing renders for
 *  a subscriber, mid session-check, or when billing is off. */
function PremiumNavLink() {
  const { user, loading } = useAuth();
  if (!BILLING_ENABLED || loading || user?.premium) return null;

  return (
    <Link
      href="/premium"
      className="ml-auto mr-1 inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2.5 text-sm font-semibold text-lime-deep transition hover:bg-win/10 sm:ml-0 sm:px-3"
    >
      Premium
    </Link>
  );
}

/** Top bar (Daylight): brand lockup on the left, a desktop-only primary link
 *  row in the middle/right, and the account / sign-in control on the right.
 *  The link row is hidden on mobile (`hidden sm:flex`) — there the bottom tab
 *  bar handles navigation. */
export function SiteNav() {
  // Through normalizePathname: the raw value is "/index" during the root
  // route's ISR revalidation, which would flip the whole bar into WC26
  // competition mode server-side and break hydration.
  const pathname = normalizePathname(usePathname());
  const { has_brackets } = useTournament();
  // /embed/[matchId] is a standalone, partner-iframeable widget — it must not
  // carry the full site chrome.
  if (pathname === "/embed" || pathname.startsWith("/embed/")) return null;
  // C6: the Bracket link only makes sense for tournaments that have one.
  // Tips (league-format only) takes the slot Bracket vacates -- see
  // requiresLeagueFormat's doc comment in lib/sports.ts.
  const isPlatformRoute = isPlatformPathname(pathname);
  const links = isPlatformRoute
    ? PLATFORM_LINKS
    : COMPETITIONS[competitionFromPathname(pathname)].navLinks.filter(
        (link) =>
          (!link.requiresBrackets || has_brackets) &&
          (!link.requiresLeagueFormat || !has_brackets),
      );

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link
          href="/"
          aria-label="FinalWhistle home"
          className="group flex shrink-0 items-center gap-2.5"
        >
          <BrandMark className="h-7 w-auto shrink-0 text-lime-deep transition group-hover:opacity-90" />
          <Wordmark className="text-lg font-extrabold" />
        </Link>

        {!isPlatformRoute && <CompetitionOverlay />}

        <div className="ml-auto mr-2 hidden items-center gap-1 sm:flex">
          {links.map((link) => {
            const active = matches(pathname, link.activePrefixes, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition",
                  active
                    ? "bg-win/10 font-semibold text-lime-deep"
                    : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <NavIcon name={link.label} active={active} className="h-[17px] w-[17px]" />
                {link.label}
              </Link>
            );
          })}
        </div>

        <PremiumNavLink />
        <ThemeToggle />
        <AuthButton />
      </nav>
    </header>
  );
}
