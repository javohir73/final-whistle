"use client";

/** The matchweek home (prototype `pageMatches`): one card of fixtures for a
 *  round, grouped into local days, each row a centred spine with the venue on
 *  the left and the action on the right; a foot with the viewer's progress;
 *  a rail with "You and the model" and the top of the table.
 *
 *  Reveal rule: open fixtures arrive from the server WITHOUT the model's call
 *  (lib/matchweeks `withoutModel`), and `useModelRevealMap` decides, once the
 *  viewer's picks are read, which rows may show it. A locked pick's model
 *  score is then read from that match's summary. Server HTML and the first
 *  paint never carry a model number for an open fixture. */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ClubBadge } from "@/components/ClubBadge";
import { TeamBadge } from "@/components/TeamBadge";
import { YouAndModelCard } from "@/components/rail/YouAndModelCard";
import { MiniTableCard } from "@/components/rail/MiniTableCard";
import {
  Button,
  Card,
  CardFoot,
  CardHead,
  ChevronLeftIcon,
  ChevronRightIcon,
  Chip,
  DayBand,
  FixtureRow,
  GhostButton,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  RoundLink,
  Segmented,
  TextLink,
  type ChipTone,
} from "@/components/ui";
import { useHydratedNow } from "@/components/match/clock";
import { getMatchSummary, getUpcomingMatches } from "@/lib/api";
import { dayKey } from "@/lib/datetime";
import { liveLabel } from "@/lib/liveLabel";
import {
  buildRounds,
  modelRoundPoints,
  modelVerdict,
  matchCountLabel,
  type ModelVerdict,
  type Round,
} from "@/lib/matchweeks";
import { matchPhase, stoppedLabel, type MatchPhase } from "@/lib/matchStatus";
import { MODEL_HIDDEN_NOTE, pickGameFor } from "@/lib/reveal";
import { COMPETITIONS, competitionLinks, footballMatchHref, type CompetitionId } from "@/lib/sports";
import type { MatchSummary, PredictedScore } from "@/lib/types";
import { useModelRevealMap, type ModelReveal } from "@/lib/useModelReveal";
import { useTimezone } from "@/lib/useTimezone";

export interface RoundNav {
  title: string;
  href: string;
}

export interface MatchweekViewProps {
  competition: CompetitionId;
  /** "Premier League · 2026–27". */
  eyebrow: string;
  round: Round;
  prev: RoundNav | null;
  next: RoundNav | null;
  /** The Fixtures / Results control: hrefs, or null when there is none. */
  fixturesHref: string | null;
  resultsHref: string | null;
  /** The server render instant (ISO), for a hydration-safe clock. */
  renderedAt: string;
  /** World Cup archive: the champion, when the final is decided. */
  champion?: string | null;
}

/** Phones: a little more room for long club names ("Nottingham Forest",
 *  "Borussia Mönchengladbach") -- 12px row padding and 15px names. */
const PHONE_ROW = "max-[899px]:px-3";

const VERDICT_TONE: Record<ModelVerdict["kind"], ChipTone> = { exact: "good", result: "ok", miss: "miss" };

/** "Saturday 21 November", in the viewer's timezone. */
function dayLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

/** The row's venue, as the match hero prints it: the stadium, else the city
 *  (the API often has only the city), else "Venue to be confirmed". */
export function venueLabel(m: Pick<MatchSummary, "venue" | "venue_city">): string {
  return m.venue?.trim() || m.venue_city?.trim() || "Venue to be confirmed";
}

/** "11:30 pm", in the viewer's timezone. */
function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\s/g, " ")
    .replace(/^0/, "");
}

function weekdayLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(new Date(iso));
}

const score = (s: { home: number | null; away: number | null } | null | undefined) =>
  s && s.home != null && s.away != null ? `${s.home}–${s.away}` : null;

/** The model's scoreline for open fixtures whose call this viewer may now see
 *  (a locked pick): the server left it out of the page, so read it from the
 *  match summary -- only for those matches, only after the reveal. */
function useRevealedModelScores(competition: CompetitionId, ids: readonly number[]) {
  const [scores, setScores] = useState<Record<number, PredictedScore | null>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    const missing = ids.filter((id) => !(id in scores));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) =>
        getMatchSummary(id, competition)
          .then((s) => [id, s.predicted_score ?? null] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((rows) => {
      if (!alive) return;
      setScores((prev) => {
        const next = { ...prev };
        for (const [id, s] of rows) next[id] = s;
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // `key` stands for `ids`; `scores` is read only to skip known ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition, key]);
  return scores;
}

/** Live scores: re-read the round while a match in it is live or about to
 *  start (the season list is ~260 KB, so not on a blind timer). */
function useLiveRound(competition: CompetitionId, initial: Round, now: Date | null): Round {
  const [round, setRound] = useState(initial);
  useEffect(() => setRound(initial), [initial]);
  const t = now?.getTime() ?? null;
  const active =
    t != null &&
    round.matches.some((m) => {
      if (m.status === "in_play") return true;
      if (m.status !== "scheduled" || !m.kickoff_utc) return false;
      const k = Date.parse(m.kickoff_utc);
      return k - t < 15 * 60_000 && t - k < 3 * 60 * 60_000;
    });
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      getUpcomingMatches(competition)
        .then((all) => {
          const fresh = buildRounds(competition, all).find((r) => r.key === initial.key);
          if (fresh) setRound(fresh);
        })
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [active, competition, initial.key]);
  return round;
}

function Pair({ rows }: { rows: ReactNode[] }) {
  return (
    <span className="flex flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1 text-notes leading-[1.4] text-muted min-[900px]:flex-col min-[900px]:gap-y-0.5 min-[900px]:items-end">
      {rows.map((row, i) => (
        <span key={i}>{row}</span>
      ))}
    </span>
  );
}

function Scoreline({ label, value, you }: { label: string; value: string; you?: boolean }) {
  return (
    <>
      {label} <b className={you ? "text-base font-bold text-brand" : "text-base font-bold text-ink"}>{value}</b>
    </>
  );
}

function RowAction({
  match,
  phase,
  reveal,
  model,
  pickGame,
  href,
}: {
  match: MatchSummary;
  phase: MatchPhase;
  reveal: ModelReveal;
  model: string | null;
  pickGame: boolean;
  href: string;
}) {
  const you = reveal.pick?.kind === "score" ? score(reveal.pick) : null;
  const shownModel = reveal.revealed ? model : null;
  const scores = [
    you && <Scoreline key="y" label="You" value={you} you />,
    shownModel && <Scoreline key="m" label="Model" value={shownModel} />,
  ].filter(Boolean) as ReactNode[];

  switch (phase) {
    case "finished": {
      const v = modelVerdict(match);
      const rows = [v && <Chip key="v" tone={VERDICT_TONE[v.kind]}>{v.label}</Chip>, ...scores].filter(Boolean) as ReactNode[];
      return rows.length ? <Pair rows={rows} /> : null;
    }
    case "live":
      return <Pair rows={[<Chip key="l">Live · {liveLabel(match)}</Chip>, ...scores]} />;
    case "stale":
      return <Pair rows={[<Chip key="p">Result pending</Chip>, ...scores]} />;
    case "postponed":
    case "cancelled":
    case "suspended":
      return <Pair rows={[<Chip key="s">{stoppedLabel(match.status) ?? "Postponed"}</Chip>, ...scores]} />;
    default:
      if (reveal.pick || (reveal.revealed && shownModel)) return <Pair rows={scores} />;
      if (!pickGame) return null;
      return (
        <GhostButton href={`${href}#pick`} aria-label={`Pick the score for ${match.teams.home} v ${match.teams.away}`}>
          Pick score
        </GhostButton>
      );
  }
}

export function MatchweekView({
  competition,
  eyebrow,
  round: initialRound,
  prev,
  next,
  fixturesHref,
  resultsHref,
  renderedAt,
  champion,
}: MatchweekViewProps) {
  const config = COMPETITIONS[competition];
  const links = competitionLinks(competition);
  const knockout = config.format === "knockout";
  const pickGame = pickGameFor(competition) === "league_tips";
  const { tz } = useTimezone();
  const now = useHydratedNow(renderedAt);
  const round = useLiveRound(competition, initialRound, now);
  const matches = round.matches;

  const fixtures = useMemo(
    () =>
      matches.map((m) => ({
        competition,
        matchId: m.match_id,
        status: m.status,
        kickoffUtc: m.kickoff_utc,
        matchweek: m.matchweek ?? null,
      })),
    [competition, matches],
  );
  const reveals = useModelRevealMap(fixtures, { serverNow: renderedAt });

  // Open fixtures the viewer may now see but whose call the server withheld.
  const needModel = useMemo(
    () =>
      matches
        .filter((m) => !m.predicted_score && m.status !== "finished" && reveals.get(m.match_id).revealed)
        .map((m) => m.match_id),
    [matches, reveals],
  );
  const fetched = useRevealedModelScores(competition, needModel);
  const modelScore = (m: MatchSummary) => score(m.predicted_score ?? fetched[m.match_id] ?? null);

  const phases = useMemo(() => new Map(matches.map((m) => [m.match_id, matchPhase(m, now)])), [matches, now]);
  const finishedRound = matches.length > 0 && matches.every((m) => m.status === "finished");

  // Day bands in the viewer's timezone.
  const days = useMemo(() => {
    const out: Array<{ key: string; label: string; matches: MatchSummary[] }> = [];
    for (const m of matches) {
      const k = m.kickoff_utc ? dayKey(m.kickoff_utc, tz) : "tbc";
      const last = out[out.length - 1];
      if (last && last.key === k) last.matches.push(m);
      else out.push({ key: k, label: m.kickoff_utc ? dayLabel(m.kickoff_utc, tz) : "Date to be confirmed", matches: [m] });
    }
    return out;
  }, [matches, tz]);

  const timed = matches.filter((m) => m.kickoff_utc);
  const firstDay = timed[0]?.kickoff_utc ? weekdayLabel(timed[0].kickoff_utc, tz) : null;
  const lastDay = timed.length ? weekdayLabel(timed[timed.length - 1].kickoff_utc!, tz) : null;
  const span = firstDay && lastDay ? (firstDay === lastDay ? `, ${firstDay}` : `, ${firstDay} to ${lastDay}`) : "";
  const count = matchCountLabel(matches.length);
  const sub = finishedRound
    ? `Full-time scores, and how the model’s call went on each match. Dates are in your local time.`
    : pickGame
      ? `${count}${span}. Call each score before kick-off. Times are in your local time.`
      : `${count}${span}. Times are in your local time.`;

  // Progress for the foot (picking competitions, round not over).
  const unpickedOpen = matches.filter(
    (m) => (phases.get(m.match_id) === "upcoming" || phases.get(m.match_id) === "postponed") && !reveals.get(m.match_id).pick,
  );
  const picked = matches.filter((m) => reveals.get(m.match_id).pick).length;
  const points = modelRoundPoints(round);

  let foot: ReactNode = null;
  if (finishedRound && !knockout && pickGame) {
    foot = (
      <CardFoot>
        <div>
          {points != null && (
            <div className="font-semibold text-ink">The model scored {points} points this {round.title.split(" ")[0].toLowerCase()}</div>
          )}
          <Note>Exact score 5 points, right result 2.</Note>
        </div>
        <GhostButton href={links.leaderboard}>See the leaderboard</GhostButton>
      </CardFoot>
    );
  } else if (pickGame) {
    const loading = reveals.isLoading;
    const target = unpickedOpen[0];
    foot = (
      <CardFoot>
        <div>
          <div className="font-semibold text-ink">
            {loading
              ? "Call each score before kick-off"
              : picked === matches.length
                ? `All ${matches.length} picked`
                : `${picked} of ${matches.length} picked`}
          </div>
          <Note>{MODEL_HIDDEN_NOTE}</Note>
        </div>
        {target ? (
          <Button href={`${footballMatchHref(competition, target.match_id)}#pick`}>
            {!loading && picked > 0 ? `Pick the other ${unpickedOpen.length}` : "Start picking"}
          </Button>
        ) : (
          <Button href={links.picks}>See my picks</Button>
        )}
      </CardFoot>
    );
  } else if (knockout) {
    foot = (
      <CardFoot>
        <div>
          <div className="font-semibold text-ink">The tournament is over</div>
          <Note>Every result, with the model’s call before kick-off.</Note>
        </div>
        {links.bracket && <GhostButton href={links.bracket}>See the bracket</GhostButton>}
      </CardFoot>
    );
  } else if (!finishedRound) {
    foot = (
      <CardFoot>
        <Note>{config.label} picks are not open yet, so the model’s call shows on every match.</Note>
      </CardFoot>
    );
  }

  const arrows = (
    <div className="flex items-center gap-3">
      <RoundLink label={prev ? prev.title : `No earlier ${knockout ? "round" : round.title.split(" ")[0].toLowerCase()}`} href={prev?.href} disabled={!prev}>
        <ChevronLeftIcon />
      </RoundLink>
      <RoundLink label={next ? next.title : `No later ${knockout ? "round" : round.title.split(" ")[0].toLowerCase()}`} href={next?.href} disabled={!next}>
        <ChevronRightIcon />
      </RoundLink>
    </div>
  );

  const segItems = [
    fixturesHref != null && { label: "Fixtures", href: fixturesHref, current: !finishedRound },
    resultsHref != null && { label: "Results", href: resultsHref, current: finishedRound },
  ].filter(Boolean) as Array<{ label: string; href: string; current: boolean }>;

  const badge = (name: string) =>
    knockout ? <TeamBadge team={name} size={26} decorative /> : <ClubBadge name={name} size={26} decorative />;

  return (
    <>
      <PageHead
        eyebrow={eyebrow}
        title={round.title}
        titleAside={arrows}
        sub={sub}
        actions={segItems.length > 1 ? <Segmented label="Show" items={segItems} /> : undefined}
      />
      <PageLayout>
        <Main>
          <Card flush aria-label={round.title}>
            {days.map((day) => (
              <Fragment key={day.key}>
                <DayBand as="h2">{day.label}</DayBand>
                {day.matches.map((m) => {
                  const phase = phases.get(m.match_id) ?? "upcoming";
                  const href = footballMatchHref(competition, m.match_id);
                  const hasScore = m.score_home != null && m.score_away != null;
                  const showScore = hasScore && (phase === "finished" || phase === "live" || phase === "stale");
                  const time = m.kickoff_utc ? timeLabel(m.kickoff_utc, tz) : "TBC";
                  return (
                    <FixtureRow
                      key={m.match_id}
                      href={href}
                      className={PHONE_ROW}
                      left={m.stage === "third_place" ? `Third place · ${venueLabel(m)}` : venueLabel(m)}
                      home={{ name: m.teams.home, crest: badge(m.teams.home) }}
                      away={{ name: m.teams.away, crest: badge(m.teams.away) }}
                      score={showScore ? { home: m.score_home!, away: m.score_away! } : undefined}
                      kickoff={phase === "postponed" || phase === "cancelled" ? "TBC" : time}
                      right={
                        <RowAction
                          match={m}
                          phase={phase}
                          reveal={reveals.get(m.match_id)}
                          model={modelScore(m)}
                          pickGame={pickGame}
                          href={href}
                        />
                      }
                    />
                  );
                })}
              </Fragment>
            ))}
            {foot}
          </Card>
        </Main>
        <Rail aria-label="More">
          {pickGame && <YouAndModelCard competition={competition} />}
          {knockout && (
            <Card pad>
              <CardHead title={config.label} />
              {champion && (
                <p className="mt-4 flex items-center gap-3 text-ink">
                  <TeamBadge team={champion} size={26} decorative />
                  <span>
                    <span className="block text-notes text-muted">Champions</span>
                    <span className="font-semibold">{champion}</span>
                  </span>
                </p>
              )}
              <Note className="mt-4">The tournament finished in July 2026. Every result and the model’s call stay here.</Note>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                <TextLink href={links.table}>Groups</TextLink>
                {links.bracket && <TextLink href={links.bracket}>Bracket</TextLink>}
              </div>
            </Card>
          )}
          <MiniTableCard competition={competition} limit={6} />
        </Rail>
      </PageLayout>
    </>
  );
}
