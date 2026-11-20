import { Fragment, type ReactNode } from "react";
import { ClubBadge } from "@/components/ClubBadge";
import { Card, Chip, DayBand, FixtureRow } from "@/components/ui";
import { nrlMatchHref } from "@/lib/nrlAdapters";
import { groupByNrlDay, nrlTimeLabel, type NrlFinalsRound } from "@/lib/nrlDisplay";
import type { NrlMatch } from "@/lib/types";
import { NrlTipCell } from "./NrlTipCell";
import { DateVenue, NrlCallVerdict } from "./NrlResultRows";

/** One NRL round on the centred spine (the football matchweek pattern): a day
 *  band per Sydney day, venue on the left, crests, kick-off or score, and on
 *  the right the tip action / "You X · Model X 64%" (client, reveal rule) for
 *  open and live matches, or the model's verdict for finished ones.
 *
 *  Server component. It never passes the model's numbers for an unfinished
 *  match: NrlTipCell reads them from /tips/mine after mount, and only shows
 *  them once tipped or kicked off. `tipping` = the round is still tippable
 *  (otherwise unfinished rows get no tip action). */
export function NrlRoundCard({
  season,
  round,
  matches,
  label,
  tipping = true,
}: {
  season: number;
  round: number | null;
  matches: NrlMatch[];
  label: string;
  tipping?: boolean;
}) {
  const days = groupByNrlDay(matches, (m) => m.kickoff_utc);
  return (
    <Card flush aria-label={label}>
      {days.map((d) => (
        <Fragment key={d.day}>
          <DayBand as="h3">{d.day}</DayBand>
          {d.items.map((m) => (
            <NrlFixtureRow key={m.id} match={m} season={season} round={round} tipping={tipping} />
          ))}
        </Fragment>
      ))}
    </Card>
  );
}

export function NrlFixtureRow({
  match: m,
  season,
  round,
  tipping = true,
  left,
}: {
  match: NrlMatch;
  season: number;
  round: number | null;
  tipping?: boolean;
  /** Overrides the venue on the left (finals rows: date + venue). */
  left?: ReactNode;
}) {
  const home = m.home ?? "TBC";
  const away = m.away ?? "TBC";
  const finished = m.status === "finished" && m.score_home != null && m.score_away != null;
  const live = m.status === "in_play" && m.score_home != null && m.score_away != null;
  let right: ReactNode = null;
  if (finished) right = <NrlCallVerdict match={m} />;
  else if (m.status === "postponed" || m.status === "cancelled") {
    right = <Chip>{m.status === "postponed" ? "Postponed" : "Cancelled"}</Chip>;
  } else if (round != null && (tipping || live)) {
    right = <NrlTipCell season={season} round={round} matchId={m.id} home={home} away={away} />;
  }
  return (
    <FixtureRow
      href={nrlMatchHref(season, round, m.match_no) ?? undefined}
      left={left ?? m.venue ?? "Venue to be confirmed"}
      home={{ name: home, crest: <ClubBadge name={m.home} size={26} decorative /> }}
      away={{ name: away, crest: <ClubBadge name={m.away} size={26} decorative /> }}
      score={finished || live ? { home: m.score_home!, away: m.score_away! } : undefined}
      kickoff={nrlTimeLabel(m.kickoff_utc)}
      right={right}
    />
  );
}

/** A finals series (or one club's part of it) in one flush card, a day band
 *  per stage (prototype `finalsCard`). */
export function NrlFinalsCard({
  finals,
  season,
  label = "Finals results",
}: {
  finals: NrlFinalsRound[];
  season: number;
  label?: string;
}) {
  return (
    <Card flush aria-label={label}>
      {finals.map((stage) => (
        <Fragment key={stage.stage}>
          <DayBand as="h3">{stage.stage}</DayBand>
          {stage.matches.map((m) => (
            <NrlFixtureRow key={m.id} match={m} season={season} round={stage.round} left={<DateVenue match={m} />} />
          ))}
        </Fragment>
      ))}
    </Card>
  );
}
