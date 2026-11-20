import Link from "next/link";
import { ClubBadge } from "@/components/ClubBadge";
import { Card, CheckIcon, Chip } from "@/components/ui";
import { nrlDayMonth, nrlModelCall, wholePct } from "@/lib/nrlDisplay";
import { cn } from "@/lib/utils";
import type { NrlMatch } from "@/lib/types";
import { YourTipCell } from "./YourTipCell";

/** A club on the big match header: name + crest (54/60 px), linking to the
 *  club page. `dim` mutes the loser. Phone: crest above the name. */
export function HeroTeam({
  name,
  teamId,
  side,
  dim,
  size = 54,
}: {
  name: string;
  teamId: number | null;
  side: "home" | "away";
  dim?: boolean;
  size?: number;
}) {
  const crest = <ClubBadge name={name} size={size} decorative />;
  const label = (
    <span
      className={cn(
        "min-w-0 break-words text-[22px] font-semibold leading-[1.05] tracking-[-0.025em] min-[900px]:text-[40px]",
        dim ? "text-muted" : "text-ink",
      )}
    >
      {name}
    </span>
  );
  const cls = cn(
    "flex min-w-0 items-center gap-2 text-center no-underline min-[900px]:gap-[18px]",
    side === "home"
      ? "flex-col-reverse min-[900px]:flex-row min-[900px]:justify-end min-[900px]:text-right"
      : "flex-col min-[900px]:flex-row min-[900px]:text-left",
  );
  const inner =
    side === "home" ? (
      <>
        {label}
        {crest}
      </>
    ) : (
      <>
        {crest}
        {label}
      </>
    );
  // Visual order on phones: crest above the name for both sides.
  return teamId != null ? (
    <Link href={`/nrl/team/${teamId}`} className={cn(cls, "underline-offset-[5px] hover:[&>span]:underline")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** The big centre score: 60 px (40 on phones), the loser's number muted. */
export function HeroScore({ home, away }: { home: number; away: number }) {
  return (
    <div className="whitespace-nowrap text-[40px] font-semibold leading-none tracking-[-0.03em] min-[900px]:text-[60px]">
      <span className={home < away ? "text-muted" : "text-ink"}>{home}</span>{" "}
      <span aria-hidden="true" className="text-[0.6em] text-dash">
        –
      </span>
      <span className="sr-only">to</span>{" "}
      <span className={away < home ? "text-muted" : "text-ink"}>{away}</span>
    </div>
  );
}

/** NRL home, season complete: the Grand Final result with the model's call and,
 *  for a viewer who really tipped it, their tip (prototype `pageNrlHome`). */
export function GrandFinalCard({ match, season, round }: { match: NrlMatch; season: number; round: number }) {
  const home = match.home ?? "TBC";
  const away = match.away ?? "TBC";
  const sh = match.score_home ?? 0;
  const sa = match.score_away ?? 0;
  const call = nrlModelCall(match);
  const winner: "home" | "away" | "draw" = sh > sa ? "home" : sa > sh ? "away" : "draw";
  const meta = ["Grand Final", match.venue, nrlDayMonth(match.kickoff_utc)].filter(Boolean).join(" · ");

  return (
    <Card flush aria-labelledby="nrl-gf-heading">
      <div className="flex flex-col items-center px-4 pb-7 pt-7 text-center min-[900px]:px-10 min-[900px]:pb-8 min-[900px]:pt-10">
        <h2 id="nrl-gf-heading" className="flex flex-wrap items-center justify-center gap-2.5 text-notes font-medium text-muted">
          <Chip className="text-ink">Full time</Chip>
          {meta}
        </h2>
        <div className="mt-6 grid w-full max-w-[880px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 min-[900px]:gap-x-8">
          <HeroTeam name={home} teamId={match.home_team_id} side="home" dim={sh < sa} />
          <HeroScore home={sh} away={sa} />
          <HeroTeam name={away} teamId={match.away_team_id} side="away" dim={sa < sh} />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] border-t border-line">
        {call ? (
          <div className="px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
            <div className="text-notes text-muted">The model</div>
            <div className="text-h2 font-semibold text-ink">
              Picked {call.team} at {wholePct(call.probability)}
            </div>
            <div
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 text-notes font-semibold",
                call.called ? "text-brand" : "text-miss",
              )}
            >
              {call.called ? <CheckIcon /> : null}
              {call.called ? "Called it" : "Missed"}
            </div>
          </div>
        ) : null}
        <YourTipCell
          season={season}
          round={round}
          matchId={match.id}
          winner={winner}
          className={call ? "border-t border-line min-[640px]:border-l min-[640px]:border-t-0" : undefined}
        />
      </div>
    </Card>
  );
}
