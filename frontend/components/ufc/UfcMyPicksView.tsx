"use client";

/** "My picks" for UFC: the next card's fights with the player's pick on each, then every card
 *  they have played. The shell (heading, intro, how it works) is the same for every visitor;
 *  everything about the player is fetched in the browser after hydration. Points and counts are
 *  the server's: nothing is scored here. */
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import {
  Button,
  Card,
  CardFoot,
  CardHead,
  CARD_X,
  Chip,
  DayBand,
  GhostButton,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  TextLink,
} from "@/components/ui";
import { getMyUfcPicks, getUfcPicksSummary, modelLine, pickLine, pickVerdict, UFC_SCORING } from "@/lib/ufcPicks";
import { boutHref, eventHref, isTba, mainEventId } from "@/lib/ufcDisplay";
import type {
  UfcBoutSummary,
  UfcEventDetail,
  UfcMyBout,
  UfcMyPicksResponse,
  UfcPick,
  UfcPicksSummaryResponse,
} from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { BoutRow } from "./BoutRow";
import { UfcPicksProvider, useUfcPicks } from "./UfcPicksProvider";

/** Past cards that load their fights; any others still show their totals and a link. */
const DETAIL_CARDS = 8;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pointsFrom = (points: number, graded: number) =>
  `${plural(points, "point", "points")} from ${plural(graded, "scored fight", "scored fights")}.`;

const versus = (a: string, b: string) => `${a} v ${b}`;

function PickChip({ pick }: { pick: UfcPick }) {
  const v = pickVerdict(pick);
  return v ? <Chip tone={v.tone}>{v.label}</Chip> : null;
}

function ChangedNotice({ a, b, newId }: { a: string; b: string; newId: number | null }) {
  return (
    <Card pad>
      <Note>{`Your pick on ${versus(a, b)} doesn't count because the fight changed.`}</Note>
      {newId != null && (
        <TextLink href={`${boutHref(newId)}#pick`} className="mt-2">
          Pick the new fight
        </TextLink>
      )}
    </Card>
  );
}

/** What the player has on one fight of the next card, under its row. */
function PickStrip({ bout, my, now }: { bout: UfcBoutSummary; my: UfcMyBout | undefined; now: Date | null }) {
  if (!my || bout.status === "cancelled") return null;
  const names = versus(bout.fighter_a.name, bout.fighter_b.name);
  let body;
  if (my.pick) {
    const verdict = pickVerdict(my.pick);
    body = (
      <>
        <p className="text-notes font-semibold text-ink">{pickLine(my, my.pick)}</p>
        {verdict ? <PickChip pick={my.pick} /> : my.model ? <Note>{modelLine(my, my.model)}</Note> : null}
      </>
    );
  } else if (isTba(bout.fighter_a) || isTba(bout.fighter_b)) {
    return null;
  } else {
    const lockMs = my.locks_at ? Date.parse(my.locks_at) : NaN;
    const closedByClock = now != null && Number.isFinite(lockMs) && now.getTime() >= lockMs;
    if (my.picks_open && !closedByClock) {
      body = (
        <GhostButton href={`${boutHref(bout.id)}#pick`} aria-label={`Pick the winner of ${names}`}>
          Pick winner
        </GhostButton>
      );
    } else if (bout.status === "scheduled") {
      body = <Note>Picks closed</Note>;
    } else if (my.model) {
      body = <Note>{modelLine(my, my.model)}</Note>;
    } else {
      return null;
    }
  }
  return <div className="flex flex-col items-center gap-1.5 px-3 pb-3.5 text-center">{body}</div>;
}

function NextCardFoot({ event, now }: { event: UfcEventDetail; now: Date | null }) {
  void now;
  const picks = useUfcPicks();
  const slug = event.slug;
  if (!picks || picks.status === "loading") {
    return (
      <CardFoot>
        <p role="status" className="text-notes text-muted">Loading your picks…</p>
      </CardFoot>
    );
  }
  if (picks.status === "no-device") {
    return (
      <CardFoot>
        <Note>Picks need your browser&apos;s storage to remember you. Allow site data to play.</Note>
      </CardFoot>
    );
  }
  if (!picks.data || picks.data.event.slug !== slug) {
    return (
      <CardFoot>
        <p role="alert" className="text-notes text-muted">We could not load your picks.</p>
        <GhostButton onClick={picks.retry}>Try again</GhostButton>
      </CardFoot>
    );
  }
  const t = picks.data.totals;
  if (t.picked === 0) {
    return (
      <CardFoot>
        <Note>You have not picked any fights yet.</Note>
        <Button href={eventHref(slug)}>Pick the next card</Button>
      </CardFoot>
    );
  }
  return (
    <CardFoot>
      <Note>{t.graded > 0 ? pointsFrom(t.points, t.graded) : "Nothing is scored yet. Points appear as each fight finishes."}</Note>
    </CardFoot>
  );
}

type Card = UfcPicksSummaryResponse["cards"][number];

function PastCard({ card, deviceId, withDetail, version }: { card: Card; deviceId: string; withDetail: boolean; version: number }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; data: UfcMyPicksResponse | null }>({
    status: "loading",
    data: null,
  });

  useEffect(() => {
    if (!withDetail) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading", data: null }));
    getMyUfcPicks(deviceId, card.slug).then(
      (data) => live && setState(data.event.slug === card.slug ? { status: "ready", data } : { status: "error", data: null }),
      () => live && setState((s) => (s.data ? s : { status: "error", data: null })),
    );
    return () => {
      live = false;
    };
  }, [deviceId, card.slug, withDetail, version, attempt]);

  const played = state.data?.bouts.filter((b) => b.pick) ?? [];
  const changed = state.data?.changed_picks ?? [];
  return (
    <section aria-label={card.name} className="border-t border-line-soft first:border-t-0">
      <div className={`${CARD_X} flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4`}>
        <div>
          <h3 className="text-base font-semibold">
            <TextLink href={eventHref(card.slug)} className="text-base">{card.name}</TextLink>
          </h3>
          <Note>
            {card.graded > 0
              ? `${plural(card.points, "point", "points")} · ${plural(card.graded, "scored fight", "scored fights")}`
              : "Not scored yet"}
          </Note>
        </div>
        <TextLink href={`/ufc/leaderboard?event=${card.slug}`}>Leaderboard</TextLink>
      </div>
      {withDetail && state.status === "loading" && (
        <p role="status" className={`${CARD_X} pb-4 text-notes text-muted`}>Loading your picks…</p>
      )}
      {withDetail && state.status === "error" && (
        <div className={`${CARD_X} flex flex-wrap items-center gap-3 pb-4`}>
          <p role="alert" className="text-notes text-muted">We could not load your picks on this card.</p>
          <GhostButton onClick={() => setAttempt((n) => n + 1)}>Try again</GhostButton>
        </div>
      )}
      {(played.length > 0 || changed.length > 0) && (
        <ul>
          {played.map((b) => (
            <li key={b.bout_id} className={`${CARD_X} flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line-soft py-3`}>
              <div className="min-w-0">
                <TextLink href={boutHref(b.bout_id)} className="text-base">{versus(b.fighter_a, b.fighter_b)}</TextLink>
                <Note>{pickLine(b, b.pick!)}</Note>
              </div>
              <PickChip pick={b.pick!} />
            </li>
          ))}
          {changed.map((c) => (
            <li key={`changed-${c.bout_id}`} className={`${CARD_X} flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line-soft py-3`}>
              <div className="min-w-0">
                <TextLink href={boutHref(c.bout_id)} className="text-base">{versus(c.fighter_a, c.fighter_b)}</TextLink>
                <Note>{pickLine(c, c.pick)}</Note>
                <Note>The fight changed, so this pick doesn&apos;t count.</Note>
                {c.replaced_by_id != null && (
                  <TextLink href={`${boutHref(c.replaced_by_id)}#pick`}>Pick the new fight</TextLink>
                )}
              </div>
              <PickChip pick={c.pick} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Summary = { status: "loading" | "ready" | "error"; data: UfcPicksSummaryResponse | null; version: number };

function Inner({ event }: { event: UfcEventDetail }) {
  const picks = useUfcPicks();
  const auth = useAuth();
  const { tz } = useTimezone();
  const identityVersion = useTipsIdentityVersion();
  const deviceId = picks?.deviceId ?? null;
  const [now, setNow] = useState<Date | null>(null);
  const [summary, setSummary] = useState<Summary>({ status: "loading", data: null, version: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    setSummary((s) => (s.data ? s : { status: "loading", data: null, version: s.version }));
    getUfcPicksSummary(deviceId).then(
      (data) => live && setSummary((s) => ({ status: "ready", data, version: s.version + 1 })),
      () => live && setSummary((s) => (s.data ? { ...s, status: "ready" } : { ...s, status: "error" })),
    );
    return () => {
      live = false;
    };
  }, [deviceId, identityVersion, attempt]);

  // Only this card's payload counts (a stale answer for another card is never shown).
  const data = picks?.data?.event.slug === event.slug ? picks.data : null;
  const handle = data?.handle ?? summary.data?.handle ?? null;
  const mainId = mainEventId(event);
  const segments = event.segments ?? [];
  const others = [...(summary.data?.cards ?? [])]
    .filter((c) => c.slug !== event.slug)
    .sort((a, b) => (b.first_bout_utc ?? "").localeCompare(a.first_bout_utc ?? ""));
  const overall = summary.data?.totals;

  return (
    <>
      <PageHead
        eyebrow="UFC"
        title="My picks"
        sub={handle ? `Playing as ${handle}.` : `Pick the winner of every fight on ${event.name}, and how they win.`}
      />
      <PageLayout>
        <Main>
          {(data?.changed_picks ?? []).map((c) => (
            <ChangedNotice key={c.bout_id} a={c.fighter_a} b={c.fighter_b} newId={c.replaced_by_id} />
          ))}
          <Card flush aria-label={event.name}>
            <DayBand as="h2" className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>{event.name}</span>
              <TextLink href={eventHref(event.slug)}>Open the card</TextLink>
            </DayBand>
            {segments.flatMap((seg) => seg.bouts).map((b) => (
              <div key={b.id} className="border-t border-line-soft first:border-t-0">
                <BoutRow bout={b} tz={tz} isMainEvent={b.id === mainId} showTime />
                <PickStrip bout={b} my={data ? picks?.myBout(b.id) : undefined} now={now} />
              </div>
            ))}
            <NextCardFoot event={event} now={now} />
          </Card>

          {summary.status === "error" && (
            <Card pad aria-label="Past cards">
              <CardHead title="Past cards" />
              <p role="alert" className="mt-3 text-notes text-muted">We could not load your other cards.</p>
              <GhostButton className="mt-3" onClick={() => setAttempt((n) => n + 1)}>Try again</GhostButton>
            </Card>
          )}
          {summary.status !== "error" && summary.data && others.length > 0 && deviceId && (
            <Card flush aria-label="Past cards">
              <CardHead title="Past cards" className={`${CARD_X} py-4`} />
              {others.map((c, i) => (
                <PastCard key={c.slug} card={c} deviceId={deviceId} withDetail={i < DETAIL_CARDS} version={summary.version} />
              ))}
            </Card>
          )}
        </Main>
        <Rail aria-label="About picks">
          <Card pad>
            <CardHead title="How it works" />
            <ul className="mt-4 space-y-2">
              <li><Note>{UFC_SCORING}</Note></li>
              <li><Note>A locked pick is final.</Note></li>
              <li><Note>Picks close when that part of the card starts.</Note></li>
            </ul>
          </Card>
          {overall && overall.graded > 0 && (
            <Card pad>
              <CardHead title="Your points" />
              <Note className="mt-4">{pointsFrom(overall.points, overall.graded)}</Note>
              <TextLink href="/ufc/leaderboard" className="mt-3">Leaderboard</TextLink>
            </Card>
          )}
          {!auth.loading && !auth.user && (
            <Card pad>
              <CardHead title="Keep your picks" />
              <Note className="mt-4">Your picks are saved on this device. A free account keeps them across devices.</Note>
              <GhostButton className="mt-3" onClick={() => auth.openSignIn()}>Sign in</GhostButton>
            </Card>
          )}
        </Rail>
      </PageLayout>
    </>
  );
}

export function UfcMyPicksView({ event }: { event: UfcEventDetail }) {
  return (
    <UfcPicksProvider eventSlug={event.slug}>
      <Inner event={event} />
    </UfcPicksProvider>
  );
}
