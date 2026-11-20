"use client";

import { useEffect, useMemo, useState } from "react";
import { ClubBadge } from "@/components/ClubBadge";
import { ShareButton } from "@/components/ShareButton";
import { reportViewerHandle } from "@/components/play/viewerHandle";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import { gradedVerdict, scoreVerdict } from "@/components/play/pickVerdict";
import { YouAndModelCard } from "@/components/rail/YouAndModelCard";
import {
  Button,
  Card,
  CardFoot,
  ChevronLeftIcon,
  ChevronRightIcon,
  Chip,
  DayBand,
  EmptyState,
  FixturePair,
  FixtureRow,
  GhostButton,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  RoundLink,
} from "@/components/ui";
import { SITE_URL } from "@/lib/constants";
import { dayKey, kickoffDate, kickoffTime } from "@/lib/datetime";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { isPickable, stoppedLabel } from "@/lib/matchStatus";
import { ApiError, getOrCreateDeviceId } from "@/lib/session";
import { COMPETITIONS, competitionLinks, footballMatchHref, type CompetitionId } from "@/lib/sports";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse } from "@/lib/types";
import { useModelRevealMap, type ModelReveal, type RevealFixture } from "@/lib/useModelReveal";
import { useTimezone } from "@/lib/useTimezone";

/** A row the feed still calls "scheduled" a day after kickoff is a ghost (a
 *  duplicate fixture that will never be played or graded): not listed. */
const GHOST_AFTER_MS = 24 * 60 * 60 * 1000;
/** How far the page walks forward from the server's "current" matchweek
 *  looking for one with something still to pick. */
const MAX_FORWARD_HOPS = 3;

function isGhost(m: LeagueTipsMineMatch, now: number): boolean {
  return m.status === "scheduled" && m.kickoff_utc != null && now - new Date(m.kickoff_utc).getTime() > GHOST_AFTER_MS;
}

/** Still open for a pick: pickable by status and not yet kicked off by the clock. */
export function isOpenForPick(m: LeagueTipsMineMatch, now: number): boolean {
  if (!isPickable(m.status)) return false;
  return m.kickoff_utc == null || new Date(m.kickoff_utc).getTime() > now;
}

type Week = LeagueTipsMineResponse;

type State =
  | { status: "loading" }
  | { status: "not-open" }
  | { status: "error"; message: string }
  | { status: "ready"; week: Week; later: Week | null };

function withoutGhosts(week: Week, now: number): Week {
  return { ...week, matches: week.matches.filter((m) => !isGhost(m, now)) };
}

async function loadWeek(league: string, device: string, mw?: number): Promise<Week | null> {
  try {
    return withoutGhosts(await getMyLeagueTips(league, device, mw), Date.now());
  } catch (err) {
    if (err instanceof ApiError && err.code === "matchweek_not_found") return null;
    throw err;
  }
}

/** My picks for one football league and one matchweek: the prototype's
 *  pagePicks. A read-only list -- picking happens on the match page (the
 *  "Pick score" links), the one place a score is locked. The data is the
 *  device-scoped /tips/mine (the same read the reveal rule uses); the model's
 *  numbers show only where `useModelRevealMap` says so. */
export function MyPicks({
  competition,
  matchweek,
  venues = {},
}: {
  competition: CompetitionId;
  matchweek?: number | null;
  /** match id → venue, from the public schedule (server-fetched). */
  venues?: Record<number, string>;
}) {
  const config = COMPETITIONS[competition];
  const links = competitionLinks(competition);
  const { tz } = useTimezone();
  const identityVersion = useTipsIdentityVersion();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const device = getOrCreateDeviceId();
    if (!device) {
      setState({ status: "error", message: "This browser is not keeping local storage, so picks can't be read." });
      return;
    }
    let live = true;
    (async () => {
      try {
        const first = await loadWeek(competition, device, matchweek ?? undefined);
        if (!first) {
          if (live) setState({ status: "error", message: `There is no Matchweek ${matchweek} in the fixtures yet.` });
          return;
        }
        let week = first;
        // The server's "current" week can be one with nothing left to pick
        // (status lag after kickoff). Without an explicit ?mw=, walk forward
        // a few weeks to the first one with an open match.
        if (matchweek == null) {
          let probe: Week | null = week;
          for (let hop = 0; hop < MAX_FORWARD_HOPS && probe; hop += 1) {
            if (probe.matches.some((m) => isOpenForPick(m, Date.now()))) break;
            probe = await loadWeek(competition, device, probe.matchweek + 1);
            if (probe?.matches.some((m) => isOpenForPick(m, Date.now()))) week = probe;
          }
        }
        // Picks already made in the following matchweek get their own card.
        const next = await loadWeek(competition, device, week.matchweek + 1).catch(() => null);
        const later = next && next.matches.some((m) => m.your_prediction) ? next : null;
        if (!live) return;
        reportViewerHandle(week.handle);
        setState({ status: "ready", week, later });
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiError && ["league_not_found", "league_inactive", "no_matchweek_data"].includes(err.code)) {
          setState({ status: "not-open" });
          return;
        }
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Couldn't load your picks." });
      }
    })();
    return () => {
      live = false;
    };
  }, [competition, matchweek, attempt, identityVersion]);

  const week = state.status === "ready" ? state.week : null;
  const later = state.status === "ready" ? state.later : null;
  const fixtures = useMemo<RevealFixture[]>(
    () =>
      [week, later].flatMap((w) =>
        w
          ? w.matches.map((m) => ({
              competition,
              matchId: m.id,
              status: m.status,
              kickoffUtc: m.kickoff_utc,
              matchweek: w.matchweek,
            }))
          : [],
      ),
    [competition, week, later],
  );
  const reveals = useModelRevealMap(fixtures);

  const mw = week?.matchweek ?? matchweek ?? null;
  const eyebrow = mw != null ? `${config.label} · Matchweek ${mw}` : config.label;
  const picksHref = (n: number) => `/play?competition=${competition}&mw=${n}`;

  const head = (
    <PageHead
      eyebrow={eyebrow}
      title="My picks"
      titleAside={
        mw != null ? (
          <span className="flex gap-2">
            <RoundLink label={`My picks, Matchweek ${mw - 1}`} href={picksHref(mw - 1)} disabled={mw <= 1}>
              <ChevronLeftIcon />
            </RoundLink>
            <RoundLink label={`My picks, Matchweek ${mw + 1}`} href={picksHref(mw + 1)}>
              <ChevronRightIcon />
            </RoundLink>
          </span>
        ) : null
      }
      sub="Your scores for this matchweek, beside the model’s where you have locked one in."
      actions={
        mw != null && mw > 1 ? (
          <GhostButton href={`${links.home}?mw=${mw - 1}`}>Last week’s results</GhostButton>
        ) : null
      }
    />
  );

  return (
    <>
      {head}
      <PageLayout>
        <Main>
          {state.status === "loading" ? (
            <ListSkeleton />
          ) : state.status === "not-open" ? (
            <EmptyState
              title="Picks open with the fixtures"
              actions={<GhostButton href={links.home}>See the matches</GhostButton>}
            >
              {config.label} picks open once this season’s fixtures are loaded.
            </EmptyState>
          ) : state.status === "error" ? (
            <EmptyState
              title="Your picks didn’t load"
              actions={
                <Button onClick={() => { setState({ status: "loading" }); setAttempt((a) => a + 1); }}>
                  Try again
                </Button>
              }
            >
              {state.message}
            </EmptyState>
          ) : (
            <WeekCards
              competition={competition}
              week={state.week}
              later={state.later}
              reveals={reveals.get}
              tz={tz}
              venues={venues}
            />
          )}
        </Main>
        <Rail aria-label="Season">
          <YouAndModelCard competition={competition} />
        </Rail>
      </PageLayout>
    </>
  );
}

function pickOf(m: LeagueTipsMineMatch, reveal: ModelReveal): { home: number; away: number } | null {
  if (m.your_prediction) return { home: m.your_prediction.predicted_home, away: m.your_prediction.predicted_away };
  if (reveal.pick?.kind === "score") return { home: reveal.pick.home, away: reveal.pick.away };
  return null;
}

function WeekCards({
  competition,
  week,
  later,
  reveals,
  tz,
  venues,
}: {
  competition: CompetitionId;
  week: Week;
  later: Week | null;
  reveals: (id: number) => ModelReveal;
  tz: string;
  venues: Record<number, string>;
}) {
  const links = competitionLinks(competition);
  const now = Date.now();
  const mw = week.matchweek;
  const matches = [...week.matches].sort(
    (a, b) => (a.kickoff_utc ?? "9999").localeCompare(b.kickoff_utc ?? "9999") || a.id - b.id,
  );
  const picked = matches.filter((m) => pickOf(m, reveals(m.id)) != null);
  const openUnpicked = matches.filter((m) => isOpenForPick(m, now) && pickOf(m, reveals(m.id)) == null);
  const anyOpen = matches.some((m) => isOpenForPick(m, now));
  const nextWeekHref = `${links.home}?mw=${mw + 1}`;

  if (matches.length === 0) {
    return (
      <EmptyState title={`No matches in Matchweek ${mw}`} actions={<GhostButton href={links.home}>See the matches</GhostButton>} />
    );
  }

  const laterCard = later ? (
    <Card flush aria-label={`My picks, Matchweek ${later.matchweek}`}>
      <DayBand>Matchweek {later.matchweek}</DayBand>
      {later.matches
        .filter((m) => m.your_prediction)
        .map((m) => (
          <PickRow
            key={m.id}
            competition={competition}
            match={m}
            reveal={reveals(m.id)}
            tz={tz}
            now={now}
            left={m.kickoff_utc ? kickoffDate(m.kickoff_utc, tz) : "Date to be confirmed"}
          />
        ))}
    </Card>
  ) : null;

  if (picked.length === 0 && anyOpen) {
    const first = openUnpicked[0];
    return (
      <>
        <EmptyState
          title={`No picks yet for Matchweek ${mw}`}
          actions={
            first ? <Button href={footballMatchHref(competition, first.id)}>Start picking</Button> : null
          }
        >
          Call the score of each match before kick-off. You see the model’s call once yours is locked.
        </EmptyState>
        {laterCard}
      </>
    );
  }

  // Server-graded points for this week, when any pick is graded.
  const graded = matches.filter((m) => m.your_prediction?.graded_at != null);
  const weekPoints = graded.reduce((s, m) => s + (m.your_prediction?.points ?? 0), 0);
  const shareUrl =
    week.handle && graded.length > 0
      ? `${SITE_URL}/tips/share/${competition}/${mw}/${encodeURIComponent(week.handle)}`
      : null;

  const groups: { key: string; label: string; rows: LeagueTipsMineMatch[] }[] = [];
  for (const m of matches) {
    const key = m.kickoff_utc ? dayKey(m.kickoff_utc, tz) : "tbc";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(m);
    else groups.push({ key, label: m.kickoff_utc ? bandLabel(m.kickoff_utc, tz) : "Date to be confirmed", rows: [m] });
  }

  const footTitle =
    openUnpicked.length > 0 || !anyOpen
      ? `${picked.length} of ${matches.length} picked`
      : `All ${matches.length} picked`;
  const footNote =
    graded.length > 0 && !anyOpen
      ? `You scored ${weekPoints} point${weekPoints === 1 ? "" : "s"} this matchweek.`
      : "Points are added after full time.";
  const footAction =
    openUnpicked.length > 0 ? (
      <Button href={footballMatchHref(competition, openUnpicked[0].id)}>
        {picked.length > 0 ? `Pick the other ${openUnpicked.length}` : "Start picking"}
      </Button>
    ) : (
      <Button href={nextWeekHref}>Go to Matchweek {mw + 1}</Button>
    );

  return (
    <>
      <Card flush aria-label={`My picks, Matchweek ${mw}`}>
        {groups.map((g) => (
          <div key={g.key}>
            <DayBand>{g.label}</DayBand>
            {g.rows.map((m) => (
              <PickRow
                key={m.id}
                competition={competition}
                match={m}
                reveal={reveals(m.id)}
                tz={tz}
                now={now}
                left={venues[m.id] ?? "Venue to be confirmed"}
              />
            ))}
          </div>
        ))}
        <CardFoot>
          <div>
            <div className="font-semibold text-ink">{footTitle}</div>
            <Note>{footNote}</Note>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {shareUrl ? (
              <ShareButton
                label="Share"
                title={`${week.handle} scored ${weekPoints} against the model — Matchweek ${mw}`}
                url={shareUrl}
                surface="league_tips_recap"
                className="min-h-[44px] rounded-full border border-ink bg-ground px-5 font-semibold text-ink"
              />
            ) : null}
            {footAction}
          </div>
        </CardFoot>
      </Card>
      {laterCard}
    </>
  );
}

function PickRow({
  competition,
  match: m,
  reveal,
  tz,
  now,
  left,
}: {
  competition: CompetitionId;
  match: LeagueTipsMineMatch;
  reveal: ModelReveal;
  tz: string;
  now: number;
  left?: string;
}) {
  const home = m.home ?? "Home";
  const away = m.away ?? "Away";
  const href = footballMatchHref(competition, m.id);
  const pick = pickOf(m, reveal);
  const model =
    reveal.revealed && m.model?.predicted_home != null && m.model.predicted_away != null
      ? { home: m.model.predicted_home, away: m.model.predicted_away }
      : null;
  const hasScore = m.score_home != null && m.score_away != null;
  const finished = m.status === "finished" && hasScore;
  const stopped = stoppedLabel(m.status);
  const time = m.kickoff_utc ? kickoffTime(m.kickoff_utc, tz).toLowerCase() : "TBC";

  let right: React.ReactNode;
  if (finished) {
    const final = { home: m.score_home as number, away: m.score_away as number };
    if (pick) {
      const v =
        gradedVerdict(m.your_prediction?.points ?? null, m.your_prediction?.exact ?? null) ?? scoreVerdict(pick, final);
      const pts = m.your_prediction?.points;
      right = (
        <FixturePair
          rows={[
            { label: "You", value: `${pick.home}–${pick.away}`, you: true },
            {
              label: <Chip tone={v.tone}>{pts != null ? `${v.label} · ${pts}` : v.label}</Chip>,
              value: null,
            },
          ]}
        />
      );
    } else if (model) {
      const v = scoreVerdict(model, final);
      right = (
        <FixturePair
          rows={[
            { label: <Chip tone={v.tone}>{v.label}</Chip>, value: null },
            { label: "Model", value: `${model.home}–${model.away}` },
          ]}
        />
      );
    } else {
      right = <Chip>Full time</Chip>;
    }
  } else if (stopped) {
    right = pick ? (
      <FixturePair rows={[{ label: "You", value: `${pick.home}–${pick.away}`, you: true }, { label: stopped, value: null }]} />
    ) : (
      <Chip>{stopped}</Chip>
    );
  } else if (pick) {
    right = (
      <FixturePair
        rows={[
          { label: "You", value: `${pick.home}–${pick.away}`, you: true },
          ...(model ? [{ label: "Model", value: `${model.home}–${model.away}` }] : []),
        ]}
      />
    );
  } else if (isOpenForPick(m, now)) {
    right = (
      <GhostButton href={href} aria-label={`Pick the score for ${home} v ${away}`}>
        Pick score
      </GhostButton>
    );
  } else {
    right = model ? (
      <FixturePair rows={[{ label: "Model", value: `${model.home}–${model.away}` }]} />
    ) : (
      <Chip>Picks closed</Chip>
    );
  }

  return (
    <FixtureRow
      href={href}
      left={left}
      home={{ name: home, crest: <ClubBadge name={home} size={26} decorative /> }}
      away={{ name: away, crest: <ClubBadge name={away} size={26} decorative /> }}
      kickoff={time}
      score={hasScore && m.status !== "scheduled" ? { home: m.score_home as number, away: m.score_away as number } : undefined}
      right={right}
    />
  );
}

/** "Saturday 21 November" (the prototype's day band), in the viewer's zone. */
function bandLabel(iso: string, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month}`;
}

function ListSkeleton() {
  return (
    <Card flush aria-busy="true" aria-label="Loading your picks">
      <DayBand>
        <span className="block h-5 w-48 rounded bg-line-soft" />
      </DayBand>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex min-h-[74px] items-center border-t border-line-soft px-4 min-[900px]:px-7">
          <span className="mx-auto block h-6 w-3/5 rounded bg-line-soft" />
        </div>
      ))}
    </Card>
  );
}
