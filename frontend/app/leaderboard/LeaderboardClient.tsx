"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLeaderboard } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { useAuth } from "@/components/AuthProvider";
import { useFavorites } from "@/lib/useFavorites";
import { getMyBracket } from "@/lib/session";
import { Loading, ErrorState, Empty } from "@/components/States";
import { Flag } from "@/components/Flag";
import { MyRankCard } from "@/components/MyRankCard";
import { LocationPicker } from "@/components/LocationPicker";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { LeagueYouVsAi } from "@/components/leagueTips/LeagueYouVsAi";
import { LeagueTipsLeaderboard } from "@/components/leagueTips/LeagueTipsLeaderboard";
import { YouVsAi } from "@/components/nrl/YouVsAi";
import { NrlTipsLeaderboard } from "@/components/nrl/NrlTipsLeaderboard";
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";
import type { LeaderboardRow, SavedBracket } from "@/lib/types";

/** Initials for the avatar — first letters of up to two name words, else the
 *  first two characters of the email local part. */
function initialsFor(name?: string | null, email?: string | null): string {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || n.slice(0, 2).toUpperCase();
  }
  const local = email?.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "··";
}

/** "My picks" for one competition: your record against the model and the
 *  season board for a league or the NRL, or the bracket leaderboard for the
 *  World Cup, now a past tournament. The server page resolves which
 *  competition; any id renders cleanly (one with no tips loop yet gets an
 *  honest empty state, never another competition's board), and the default
 *  is a live league, never the finished World Cup. */
export function LeaderboardClient({
  initialRows,
  competition = "epl",
  nrlSeason = null,
}: {
  initialRows?: LeaderboardRow[];
  competition?: CompetitionId;
  nrlSeason?: number | null;
}) {
  const state = useFetch(
    () => competition === "wc26" ? getLeaderboard() : Promise.resolve([]),
    [competition],
    undefined,
    competition === "wc26" ? initialRows : [],
  );
  const { user, openSignIn } = useAuth();
  const { favorites } = useFavorites();
  // "Install app" settings row — only meaningful when a native prompt is queued.
  const install = useInstallPrompt();

  // The signed-in user's saved bracket drives the stat row (rank / points).
  const [bracket, setBracket] = useState<SavedBracket | null>(null);
  useEffect(() => {
    if (!user || competition !== "wc26") {
      setBracket(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const b = await getMyBracket();
        if (live) setBracket(b);
      } catch {
        /* ignore — stats fall back to placeholders */
      }
    })();
    return () => {
      live = false;
    };
  }, [competition, user]);

  const rows = state.status === "success" ? state.data : [];
  // Match the signed-in player's leaderboard row by display name so we can both
  // highlight their row and surface a "Correct" stat (percentile) when present.
  const myName = bracket?.display_name?.trim() || user?.display_name?.trim() || null;
  const myRow = myName ? rows.find((r) => r.display_name === myName) : undefined;

  const rank = bracket?.score?.rank ?? myRow?.rank ?? null;
  const points = bracket?.score?.total_points ?? myRow?.total_points ?? null;
  const correct = myRow?.percentile != null ? `${myRow.percentile}%` : null;

  const name = user?.display_name?.trim() || user?.email?.split("@")[0] || "Guest";
  const followingCount = favorites.length;
  const statusLine = user
    ? followingCount > 0
      ? `Signed in · Following ${followingCount}`
      : "Signed in"
    : "Guest · picks saved on this device";

  const selected = COMPETITIONS[competition];

  if (competition !== "wc26") {
    const leagueHasTips = competition !== "nrl" && ACTIVE_LEAGUES.includes(competition);
    return (
      <div className="space-y-6">
        <ProfileHeader
          name={name}
          statusLine={statusLine}
          avatarUrl={user?.avatar_url}
          initials={initialsFor(user?.display_name, user?.email)}
        />
        <CompetitionTabs selected={competition} />
        <section aria-label={`My picks · ${selected.label}`} className="space-y-6">
          <CompetitionHeading competition={competition} eyebrow="My picks" />
          {competition === "nrl" ? (
            <>
              <YouVsAi />
              {nrlSeason != null ? (
                <NrlTipsLeaderboard season={nrlSeason} seasonOnly />
              ) : (
                <Empty label="The NRL season leaderboard is not available yet." />
              )}
            </>
          ) : leagueHasTips ? (
            <>
              <LeagueYouVsAi league={competition} />
              <LeagueTipsLeaderboard league={competition} seasonOnly />
            </>
          ) : (
            <Empty label={`${selected.label} score-tip records are not available yet.`} />
          )}
          <Link
            href={`/play?competition=${competition}`}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-win/15 px-4 text-sm font-bold text-lime-deep ring-1 ring-win/30"
          >
            Play {selected.label} →
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1 · Profile header */}
      <ProfileHeader
        name={name}
        statusLine={statusLine}
        avatarUrl={user?.avatar_url}
        initials={initialsFor(user?.display_name, user?.email)}
      />
      <CompetitionTabs selected="wc26" />

      <section aria-label={`My picks · ${selected.label}`} className="space-y-5">
        <CompetitionHeading competition="wc26" eyebrow="Past tournament" />

        {/* 2 · Stat row */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Rank" value={rank != null ? `#${rank}` : "—"} />
          <Stat label="Points" value={points != null ? `${points}` : "—"} />
          <Stat label="Correct" value={correct ?? "—"} />
        </div>

        {/* 3 · Sign-in prompt (guests only) */}
        {!user && (
          <section className="panel-pitch rounded-2xl p-5">
            <h2 className="font-display text-lg font-extrabold text-white">
              Save across devices
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-pitch-copy">
              Free account — sync your bracket and join the leaderboard. Your picks stay yours.
            </p>
            <button
              type="button"
              onClick={() => openSignIn({ mode: "signup" })}
              className="mt-4 inline-flex items-center gap-1 rounded-xl bg-win px-4 py-2.5 font-display text-sm font-bold text-pitch transition hover:brightness-105"
            >
              Create free account →
            </button>
          </section>
        )}

        {/* 4 · Leaderboard */}
        <section>
          <h2 className="mb-2.5 px-0.5 text-label font-semibold uppercase tracking-wider text-muted">
            Bracket leaderboard
          </h2>
          <p className="mb-3 max-w-xl px-0.5 text-sm text-muted">
            Public brackets ranked by points (group 3 · knockout 5 · finalist 10 · champion 20).
            See the tournament on the{" "}
            <Link href="/brackets" className="text-lime-deep underline underline-offset-2">
              Bracket
            </Link>{" "}
            page.
          </p>

          <MyRankCard />

          {state.status === "loading" && <Loading label="Loading leaderboard…" />}
          {state.status === "error" && <ErrorState message={state.message} onRetry={state.retry} />}
          {state.status === "success" &&
            (rows.length === 0 ? (
              <Empty label="No public brackets yet — check back soon." />
            ) : (
              <div className="glass overflow-x-auto rounded-2xl p-2 sm:p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-label uppercase tracking-wider text-muted">
                      <th className="px-2 pb-2 text-left font-medium">#</th>
                      <th className="px-2 pb-2 text-left font-medium">Player</th>
                      <th className="px-2 pb-2 text-left font-medium">Champion pick</th>
                      <th className="px-2 pb-2 text-right font-medium">Points</th>
                      <th className="hidden px-2 pb-2 text-right font-medium sm:table-cell">Top</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const isMe = myName != null && row.display_name === myName;
                      const placeRank = row.rank ?? i + 1;
                      return (
                        <tr
                          key={`${row.display_name}-${i}`}
                          className={`border-t border-border ${isMe ? "bg-win/[0.06]" : ""}`}
                        >
                          <td
                            className={`px-2 py-2.5 font-semibold tabular-nums ${
                              placeRank === 1 ? "text-gold" : "text-muted"
                            }`}
                          >
                            {placeRank}
                          </td>
                          <td className={`px-2 py-2.5 ${isMe ? "font-bold" : "font-medium"}`}>
                            {row.display_name}
                            {row.premium && (
                              <span
                                aria-label="Premium supporter"
                                title="Premium supporter"
                                className="ml-1.5 inline-block align-middle text-accent"
                              >
                                ★
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            {row.champion ? (
                              <span className="flex items-center gap-2">
                                <Flag team={row.champion} size={18} />
                                <span className="min-w-0 truncate">{row.champion}</span>
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right font-display font-bold tabular-nums">
                            {row.total_points}
                          </td>
                          <td className="hidden px-2 py-2.5 text-right tabular-nums text-muted sm:table-cell">
                            {row.percentile != null ? `${row.percentile}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      </section>

      {/* 5 · Favourites */}
      <section>
        <h2 className="mb-2.5 px-0.5 text-label font-semibold uppercase tracking-wider text-muted">
          Favourites
        </h2>
        <div className="glass rounded-2xl p-4">
          {favorites.length > 0 ? (
            <ul className="flex flex-wrap gap-2.5">
              {favorites.map((team) => (
                <li
                  key={team}
                  className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold"
                >
                  <Flag team={team} size={18} />
                  {team}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Tap the ★ on any team to follow them here.</p>
          )}
        </div>
      </section>

      {/* 6 · Settings & info */}
      <section>
        <h2 className="mb-2.5 px-0.5 text-label font-semibold uppercase tracking-wider text-muted">
          Settings &amp; info
        </h2>
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3.5">
            <RowIcon>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </RowIcon>
            <span className="text-sm font-semibold">Time zone</span>
            <div className="ml-auto min-w-0 flex-1 sm:flex-none">
              <LocationPicker />
            </div>
          </div>

          {install.platform === "android" && (
            <RowButton label="Install app" onClick={() => void install.promptInstall()}>
              <path d="M12 3v11M8 11l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 19h14" strokeLinecap="round" />
            </RowButton>
          )}

          <RowLink href="/about" label="How it works">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
          </RowLink>

          <RowLink href="/methodology" label="Methodology">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" strokeLinejoin="round" />
            <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" strokeLinejoin="round" />
          </RowLink>
        </div>
      </section>

      {/* 7 · Footer */}
      <footer className="px-0.5 pb-2 pt-2 text-center text-label leading-relaxed text-muted">
        <p>
          FinalWhistle · For analytics and entertainment only.{" "}
          <strong className="font-semibold text-foreground">Not betting advice.</strong>
        </p>
        <p className="mt-1">
          <Link href="/privacy" className="text-lime-deep underline-offset-2 hover:underline">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="text-lime-deep underline-offset-2 hover:underline">
            Terms &amp; support
          </Link>
        </p>
      </footer>
    </div>
  );
}

function ProfileHeader({
  name,
  statusLine,
  avatarUrl,
  initials,
}: {
  name: string;
  statusLine: string;
  avatarUrl?: string | null;
  initials: string;
}) {
  return (
    <header className="fade-up flex items-center gap-4">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          aria-hidden
          className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-border"
        />
      ) : (
        <span
          aria-hidden
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-pitch font-display text-xl font-extrabold text-win"
        >
          {initials}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{name}</h1>
        <p className="mt-1 truncate text-sm text-muted">{statusLine}</p>
      </div>
    </header>
  );
}

/** The competition this view is about: crest, a small eyebrow ("My picks",
 *  or "Past tournament" for the World Cup) and the competition's own label as
 *  the heading. */
function CompetitionHeading({ competition, eyebrow }: { competition: CompetitionId; eyebrow: string }) {
  return (
    <header className="flex items-center gap-3">
      <CompetitionLogo competition={competition} size={40} />
      <div>
        <p className="text-label font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        <h2 className="font-display text-2xl font-extrabold">
          {COMPETITIONS[competition].label}
        </h2>
      </div>
    </header>
  );
}

/** Switcher groups, in the same order as the competition switcher elsewhere:
 *  live football, rugby league, then the finished World Cup on its own. */
const COMPETITION_GROUPS: Array<{ label: string; ids: CompetitionId[] }> = [
  {
    label: "Football",
    ids: Object.values(COMPETITIONS)
      .filter((c) => c.sport === "football" && c.id !== "wc26")
      .map((c) => c.id),
  },
  { label: "Rugby league", ids: Object.values(COMPETITIONS).filter((c) => c.sport === "nrl").map((c) => c.id) },
  { label: "Past tournaments", ids: ["wc26"] },
];

function CompetitionTabs({ selected }: { selected: CompetitionId }) {
  return (
    <nav aria-label="Competition" className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-1">
      {COMPETITION_GROUPS.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex shrink-0 items-center gap-2">
          <span aria-hidden className="text-label font-semibold uppercase tracking-wider text-muted">
            {group.label}
          </span>
          {group.ids.map((id) => (
            <Link
              key={id}
              href={`/leaderboard?competition=${id}`}
              aria-current={id === selected ? "page" : undefined}
              className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${
                id === selected ? "bg-win text-pitch" : "bg-surface-2 text-muted"
              }`}
            >
              <CompetitionLogo competition={id} size={22} />
              {COMPETITIONS[id].label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** A light stat card in the three-up row. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl px-3 py-4 text-center">
      <p className="font-display text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="mt-0.5 text-label font-semibold text-muted">{label}</p>
    </div>
  );
}

/** Tinted square icon used by the settings rows. */
function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-lime-deep">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </span>
  );
}

/** A tappable settings row that runs an action (same look as RowLink). */
function RowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-left transition hover:bg-surface-2"
    >
      <RowIcon>{children}</RowIcon>
      <span className="text-sm font-semibold">{label}</span>
      <svg
        viewBox="0 0 24 24"
        className="ml-auto h-4 w-4 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** A tappable settings/info row with an icon, label and chevron. */
function RowLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-t border-border px-4 py-3.5 transition hover:bg-surface-2"
    >
      <RowIcon>{children}</RowIcon>
      <span className="text-sm font-semibold">{label}</span>
      <svg
        viewBox="0 0 24 24"
        className="ml-auto h-4 w-4 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
