"use client";

/** "My picks" for UFC: the next card's fights with the player's pick on each, then every card
 *  they have played. The shell (heading, intro, how it works) is the same for every visitor;
 *  everything about the player is fetched in the browser after hydration. Points and counts are
 *  the server's: nothing is scored here. */
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useTipsIdentityVersion } from "@/components/play/tipsIdentity";
import {
  Button,
  Card,
  CardFoot,
  CardHead,
  CARD_X,
  Chip,
  GhostButton,
  Main,
  Note,
  PageHead,
  PageLayout,
  Rail,
  TextLink,
} from "@/components/ui";
import { getUfcPicksSummary, UFC_SCORING } from "@/lib/ufcPicks";
import { boutHref, eventHref, mainEventId } from "@/lib/ufcDisplay";
import type { UfcEventDetail, UfcMyBout, UfcPicksSummaryResponse } from "@/lib/ufcTypes";
import { useTimezone } from "@/lib/useTimezone";
import { BoutPickStatus, hasPickSlot } from "./BoutPickStatus";
import { BoutRow } from "./BoutRow";
import { UfcPicksProvider, useUfcPicks } from "./UfcPicksProvider";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pointsFrom = (points: number, graded: number) =>
  `${plural(points, "point", "points")} from ${plural(graded, "scored fight", "scored fights")}.`;

const versus = (a: string, b: string) => `${a} v ${b}`;

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

/** A cancelled fight keeps its "Cancelled" chip; a pick the player had on it says it does not count. */
function cancelledRight(my: UfcMyBout | undefined): ReactNode {
  if (!my?.pick) return undefined;
  return (
    <div className="flex flex-col items-center gap-1 min-[900px]:items-end">
      <Chip>Cancelled</Chip>
      <span className="block text-notes leading-[1.4] text-muted">Your pick does not count because the fight was cancelled.</span>
    </div>
  );
}

/** A count that is true at every moment: no promise about why nothing is scored. */
const unscored = (picked: number) => `${plural(picked, "pick", "picks")} · 0 scored`;

function NextCardFoot({ event }: { event: UfcEventDetail }) {
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
        <GhostButton onClick={picks.retry} aria-label="Try again to load your picks">Try again</GhostButton>
      </CardFoot>
    );
  }
  const t = picks.data.totals;
  if (t.picked === 0) {
    return (
      <CardFoot>
        <Note>You have not picked any fights on this card yet.</Note>
        <Button href={eventHref(slug)}>Pick the next card</Button>
      </CardFoot>
    );
  }
  if (t.graded > 0) {
    return (
      <CardFoot>
        <Note>{pointsFrom(t.points, t.graded)}</Note>
      </CardFoot>
    );
  }
  return (
    <CardFoot>
      <Note>{unscored(t.picked)}</Note>
    </CardFoot>
  );
}

type Card = UfcPicksSummaryResponse["cards"][number];

/** One row of the other-cards lists (Coming up, Past cards). */
function PastCard({ card }: { card: Card }) {
  return (
    <li className={`${CARD_X} flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line-soft py-4`}>
      <div className="min-w-0">
        <TextLink href={eventHref(card.slug)} className="text-base">{card.name}</TextLink>
        <Note>
          {card.graded > 0
            ? `${plural(card.points, "point", "points")} · ${plural(card.graded, "scored fight", "scored fights")}`
            : unscored(card.picked)}
        </Note>
      </div>
      <TextLink href={`/ufc/leaderboard?event=${card.slug}`} aria-label={`Leaderboard for ${card.name}`}>
        Leaderboard
      </TextLink>
    </li>
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
  // Cards that start after this one are still to come; earlier ones, and any with no date, are past.
  const startsAfter = (c: Card) => {
    const next = Date.parse(event.first_bout_utc ?? "");
    const at = Date.parse(c.first_bout_utc ?? "");
    return !Number.isNaN(next) && !Number.isNaN(at) && at > next;
  };
  const comingUp = others.filter(startsAfter).reverse();
  const pastCards = others.filter((c) => !startsAfter(c));
  const overall = summary.data?.totals;
  // The invite goes only to a visitor with picks to keep (never to blocked storage or a first visit).
  const hasPlayed = (data?.totals.picked ?? 0) > 0 || others.length > 0;

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
            <div className={`${CARD_X} flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-soft py-3 text-notes font-semibold text-ink`}>
              <h2>{event.name}</h2>
              <TextLink href={eventHref(event.slug)}>Open the card</TextLink>
            </div>
            {segments.flatMap((seg) => seg.bouts).map((b) => (
              <BoutRow
                key={b.id}
                bout={b}
                tz={tz}
                isMainEvent={b.id === mainId}
                showTime
                right={
                  b.status === "cancelled"
                    ? cancelledRight(data?.bouts.find((m) => m.bout_id === b.id))
                    : hasPickSlot(b)
                      ? <BoutPickStatus bout={b} now={now} />
                      : undefined
                }
              />
            ))}
            <NextCardFoot event={event} />
          </Card>

          {summary.status === "error" && (
            <Card pad aria-label="Past cards">
              <CardHead title="Past cards" />
              <p role="alert" className="mt-3 text-notes text-muted">We could not load your other cards.</p>
              <GhostButton className="mt-3" onClick={() => setAttempt((n) => n + 1)} aria-label="Try again to load your other cards">Try again</GhostButton>
            </Card>
          )}
          {summary.status !== "error" && summary.data && comingUp.length > 0 && (
            <Card flush aria-label="Coming up">
              <CardHead title="Coming up" className={`${CARD_X} py-4`} />
              <ul>
                {comingUp.map((c) => (
                  <PastCard key={c.slug} card={c} />
                ))}
              </ul>
            </Card>
          )}
          {summary.status !== "error" && summary.data && pastCards.length > 0 && (
            <Card flush aria-label="Past cards">
              <CardHead title="Past cards" className={`${CARD_X} py-4`} />
              <ul>
                {pastCards.map((c) => (
                  <PastCard key={c.slug} card={c} />
                ))}
              </ul>
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
          {!auth.loading && !auth.user && hasPlayed && (
            <Card pad>
              <Note>A free account keeps your picks across devices.</Note>
              <GhostButton onClick={() => auth.openSignIn()} className="mt-2">
                Sign in
              </GhostButton>
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
