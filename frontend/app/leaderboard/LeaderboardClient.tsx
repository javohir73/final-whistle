"use client";

import { useEffect, useState } from "react";
import { getLeaderboard } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { useAuth } from "@/components/AuthProvider";
import { getMyBracket } from "@/lib/session";
import { Flag } from "@/components/Flag";
import { MyRankCard } from "@/components/MyRankCard";
import { LocationPicker } from "@/components/LocationPicker";
import { LeagueTipsLeaderboard } from "@/components/leagueTips/LeagueTipsLeaderboard";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { footballSeasonLabel } from "@/components/play/pickVerdict";
import { YouVsAi } from "@/components/nrl/YouVsAi";
import { NrlTipsLeaderboard } from "@/components/nrl/NrlTipsLeaderboard";
import {
  Button,
  Card,
  CardHead,
  EmptyState,
  GhostButton,
  Note,
  PageHead,
  Segmented,
  Table,
  TableScroll,
  Td,
  TextLink,
  Th,
} from "@/components/ui";
import { ACTIVE_LEAGUES } from "@/lib/leagueConfig";
import { getLeagueTipsSummary, getMyLeagueTips } from "@/lib/leagueTips";
import { getOrCreateDeviceId } from "@/lib/session";
import { COMPETITIONS, competitionLinks, type CompetitionId } from "@/lib/sports";
import type { LeaderboardRow, LeagueSeasonLeaderboardResponse, SavedBracket } from "@/lib/types";

/** The leaderboard for one competition (the prototype's pageBoard): the
 *  season board of a football league's score-pick game (with the current
 *  matchweek beside it), the NRL's own boards, or the World Cup's bracket
 *  board, now an archive. A competition without a pick game gets a calm
 *  "not open" state, never another competition's board. */
export function LeaderboardClient({
  initialRows,
  competition = "epl",
  nrlSeason = null,
}: {
  initialRows?: LeaderboardRow[];
  competition?: CompetitionId;
  nrlSeason?: number | null;
}) {
  const config = COMPETITIONS[competition];
  const links = competitionLinks(competition);

  if (competition === "wc26") return <WorldCupBoard initialRows={initialRows} />;

  if (competition === "nrl") {
    return (
      <>
        <PageHead
          eyebrow={nrlSeason != null ? `NRL · ${nrlSeason}` : "NRL"}
          title="Leaderboard"
          sub="Season to date. One point for each winner. Everyone plays against the model."
        />
        <section aria-label={`Leaderboard · ${config.label}`} className="flex max-w-[900px] flex-col gap-6">
          <YouVsAi />
          {nrlSeason != null ? (
            <NrlTipsLeaderboard season={nrlSeason} seasonOnly />
          ) : (
            <EmptyState title="Not available yet">The NRL season leaderboard is not available yet.</EmptyState>
          )}
        </section>
      </>
    );
  }

  if (!ACTIVE_LEAGUES.includes(competition)) {
    return (
      <>
        <PageHead eyebrow={config.label} title="Leaderboard" />
        <EmptyState
          className="max-w-[900px]"
          title="Picks are not open for this competition"
          actions={<GhostButton href={links.home}>See its matches</GhostButton>}
        >
          {config.label} score picks are not open yet, so there is no leaderboard.
        </EmptyState>
      </>
    );
  }

  return <FootballBoard competition={competition} />;
}

function FootballBoard({ competition }: { competition: CompetitionId }) {
  const config = COMPETITIONS[competition];
  const links = competitionLinks(competition);
  const identityVersion = useTipsIdentityVersion();
  const [weeks, setWeeks] = useState<number | null>(null);
  // The matchweek board shown beside the season: the current week once it
  // has a result in, else the one before it.
  const [boardWeek, setBoardWeek] = useState<number | null>(null);
  const [view, setView] = useState<"season" | "weekly">("season");

  useEffect(() => {
    const device = getOrCreateDeviceId();
    if (!device) return;
    let live = true;
    // The handle marks the viewer's own row ("You"); nothing else is read.
    getLeagueTipsSummary(competition, device)
      .then((s) => live && reportViewerHandle(s.handle))
      .catch(() => {});
    getMyLeagueTips(competition, device)
      .then((w) => {
        if (!live) return;
        const started = w.matches.some((m) => m.status !== "scheduled" && m.status !== "postponed");
        const n = started ? w.matchweek : w.matchweek - 1;
        setBoardWeek(n >= 1 ? n : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [competition, identityVersion]);

  const onSeason = (data: LeagueSeasonLeaderboardResponse) => {
    const model = data.entries.find((e) => e.is_model);
    setWeeks(model?.matchweeks_played ?? null);
  };

  return (
    <>
      <PageHead
        eyebrow={`${config.label} · ${footballSeasonLabel()}`}
        title="Leaderboard"
        sub={`Season to date${
          weeks != null && weeks > 0 ? `, after ${weeks} matchweek${weeks === 1 ? "" : "s"}` : ""
        }. Exact score 5 points, right result 2. Everyone plays against the model.`}
        actions={
          boardWeek != null ? (
            <Segmented
              label="Leaderboard"
              items={[
                { label: "Season", current: view === "season", onSelect: () => setView("season") },
                { label: `Matchweek ${boardWeek}`, current: view === "weekly", onSelect: () => setView("weekly") },
              ]}
            />
          ) : null
        }
      />
      <section aria-label={`Leaderboard · ${config.label}`} className="flex flex-col gap-6">
        <LeagueTipsLeaderboard
          league={competition}
          matchweek={boardWeek ?? undefined}
          view={view}
          onSeasonLoaded={onSeason}
        />
        <p>
          <Button href={links.home}>Pick this week’s matches</Button>
        </p>
      </section>
    </>
  );
}

/** The finished World Cup's public bracket board, kept as an archive. */
function WorldCupBoard({ initialRows }: { initialRows?: LeaderboardRow[] }) {
  const state = useFetch(() => getLeaderboard(), [], undefined, initialRows);
  const { user, openSignIn } = useAuth();

  // The signed-in user's saved bracket marks their row.
  const [bracket, setBracket] = useState<SavedBracket | null>(null);
  useEffect(() => {
    if (!user) {
      setBracket(null);
      return;
    }
    let live = true;
    getMyBracket()
      .then((b) => live && setBracket(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user]);

  const rows = state.status === "success" ? state.data : [];
  const myName = bracket?.display_name?.trim() || user?.display_name?.trim() || null;

  return (
    <>
      <PageHead
        eyebrow="World Cup 2026 · Past tournament"
        title="Leaderboard"
        sub="Public brackets ranked by points: group 3, knockout 5, finalist 10, champion 20."
      />
      <section aria-label="Leaderboard · World Cup 2026" className="flex max-w-[900px] flex-col gap-6">
        <MyRankCard />
        {!user ? (
          <Card pad>
            <CardHead title="Keep your bracket" />
            <Note className="mt-1.5">A free account keeps your bracket across devices.</Note>
            <p className="mt-4">
              <Button size="sm" onClick={() => openSignIn({ mode: "signup" })}>
                Create a free account
              </Button>
            </p>
          </Card>
        ) : null}
        <Card pad>
          {state.status === "loading" ? (
            <Note>Loading the leaderboard…</Note>
          ) : state.status === "error" ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <Note>{state.message}</Note>
              <Button size="sm" onClick={state.retry}>
                Try again
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <Note>No public brackets yet.</Note>
          ) : (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <Th align="left">
                      <span className="sr-only">Rank</span>
                    </Th>
                    <Th align="left">Player</Th>
                    <Th align="left">Champion pick</Th>
                    <Th>Points</Th>
                    <Th className="hidden sm:table-cell">Top</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const isMe = myName != null && row.display_name === myName;
                    return (
                      <tr key={`${row.display_name}-${i}`} className={isMe ? "bg-brand-soft" : undefined}>
                        <Td pos>{row.rank ?? i + 1}</Td>
                        <Td align="left" className="font-semibold text-ink">
                          {row.display_name}
                        </Td>
                        <Td align="left">
                          {row.champion ? (
                            <span className="inline-flex items-center gap-2">
                              <Flag team={row.champion} size={18} decorative />
                              {row.champion}
                            </span>
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </Td>
                        <Td pts>{row.total_points}</Td>
                        <Td className="hidden text-muted sm:table-cell">
                          {row.percentile != null ? `${row.percentile}%` : "–"}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
        <p>
          <TextLink href="/football/wc26/bracket">See the bracket</TextLink>
        </p>
        <Card pad>
          <CardHead title="Time zone" />
          <Note className="mt-1.5">Kick-off times across the site use this time zone.</Note>
          <div className="mt-4">
            <LocationPicker />
          </div>
        </Card>
      </section>
    </>
  );
}
