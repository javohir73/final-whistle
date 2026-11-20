"use client";

import Link from "next/link";
import { Flag } from "@/components/Flag";
import { KO_TREE, FINAL_MATCH, THIRD_PLACE } from "@/lib/bracketStructure";
import type { SideView, TieView } from "@/lib/officialBracket";
import { cn } from "@/lib/utils";
import { stoppedLabel } from "@/lib/matchStatus";
import { footballMatchHref } from "@/lib/sports";

const ROUND_LABEL: Record<string, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
};

/** Split the bracket into its two halves from the winner-feeder map, so the tree
 *  converges from BOTH sides toward the Final in the centre — the classic printed
 *  layout that fits on one desktop screen — instead of one tall column. */
function half(sfNo: number) {
  const sf = [sfNo];
  const qf = KO_TREE[sfNo]; // [97,98] / [99,100]
  const r16 = qf.flatMap((m) => KO_TREE[m]); // 4
  const r32 = r16.flatMap((m) => KO_TREE[m]); // 8
  return { r32, r16, qf, sf };
}
const L = half(101);
const R = half(102);
// Column order outer→inner. Left half flows rightward; right half flows leftward.
const LEFT_COLS: [string, number[]][] = [
  ["r32", L.r32],
  ["r16", L.r16],
  ["qf", L.qf],
  ["sf", L.sf],
];
const RIGHT_COLS: [string, number[]][] = [
  ["sf", R.sf],
  ["qf", R.qf],
  ["r16", R.r16],
  ["r32", R.r32],
];

/** Nine columns of 124px plus the 12px connector gaps fill the 1,360px frame's
 *  card exactly; narrower screens scroll the tree inside its card. */
const TIE_W = "w-[124px]";

function sideAria(s: SideView): string {
  const name = s.team ?? s.label;
  const score = s.score != null ? ` ${s.score}` : "";
  return `${name}${score}`;
}

function tieAria(v: TieView, roundLabel: string): string {
  const a = sideAria(v.a);
  const b = sideAria(v.b);
  const winner =
    v.a.isWinner ? `, ${v.a.team ?? v.a.label} win` : v.b.isWinner ? `, ${v.b.team ?? v.b.label} win` : "";
  return `${roundLabel}: ${a} vs ${b}, ${v.state}${winner}`;
}

function SideRow({ s }: { s: SideView }) {
  return (
    <div
      data-side
      data-winner={s.isWinner ? "" : undefined}
      className={cn(
        "flex items-center justify-between gap-1 py-0.5",
        s.isWinner ? "font-semibold text-ink" : s.team ? "text-ink" : "text-muted",
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        {s.team ? <Flag team={s.team} size={16} decorative /> : null}
        {/* Full names, never cut: a long one wraps onto a second line inside the
            card ("Bosnia and / Herzegovina"); the title is a fallback. */}
        <span className="min-w-0 text-label leading-tight [overflow-wrap:anywhere]" title={s.team ?? s.label}>
          {s.team ?? s.label}
        </span>
      </span>
      {s.score != null ? (
        <span className={cn("shrink-0 text-label tabular-nums", s.isWinner ? "font-bold" : "font-medium")}>{s.score}</span>
      ) : null}
    </div>
  );
}

function TieCard({ v, roundLabel, final }: { v: TieView; roundLabel: string; final?: boolean }) {
  const live = v.state === "in_play";
  const stopped = stoppedLabel(v.state);
  const status = live ? null : v.state === "finished" ? "FT" : stopped;
  const body = (
    <div
      className={cn(
        "rounded-[12px] border bg-ground px-1.5 py-2 transition-colors",
        final ? "border-ink" : "border-line hover:border-line-strong",
      )}
    >
      <div className="mb-0.5 flex items-center justify-between text-label leading-none text-muted">
        <span>#{v.matchNo}</span>
        {live ? (
          <span
            className="inline-flex items-center gap-1 font-semibold text-brand"
            aria-label={`Live, ${v.liveLabel}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden />
            {v.liveLabel}
          </span>
        ) : status ? (
          <span>{status}</span>
        ) : null}
      </div>
      <SideRow s={v.a} />
      <SideRow s={v.b} />
      {v.penaltyText ? <div className="mt-0.5 text-label text-muted">{v.penaltyText}</div> : null}
    </div>
  );

  // The only official bracket is the World Cup's (hasBracket: wc26).
  const href =
    v.matchId != null && v.state !== "labels" ? footballMatchHref("wc26", v.matchId) : null;
  return (
    <li className={cn("ko-tie", TIE_W)} aria-label={tieAria(v, roundLabel)}>
      {href ? (
        <Link href={href} className="block rounded-[12px] no-underline">
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

function RoundLabel({ children }: { children: string }) {
  return (
    <div className="mb-2 text-center text-label font-medium text-muted" aria-hidden>
      {children}
    </div>
  );
}

function Column({
  side,
  round,
  nos,
  ties,
  outer,
}: {
  side: "l" | "r";
  round: string;
  nos: number[];
  ties: Record<number, TieView>;
  outer: boolean;
}) {
  const label = ROUND_LABEL[round];
  return (
    <div className="flex shrink-0 flex-col">
      <RoundLabel>{label}</RoundLabel>
      <ol
        aria-label={`${label}, ${side === "l" ? "left" : "right"} half`}
        className={cn("ko-round flex-1", side === "l" ? "ko-col-l" : "ko-col-r", outer && "ko-edge")}
      >
        {nos.map((no) => (ties[no] ? <TieCard key={no} v={ties[no]} roundLabel={label} /> : null))}
      </ol>
    </div>
  );
}

export default function OfficialBracket({ ties }: { ties: Record<number, TieView> }) {
  const final = ties[FINAL_MATCH];
  const third = ties[THIRD_PLACE.no];
  return (
    <div className="flex flex-col gap-6">
      {/* The tree scrolls sideways INSIDE its card on narrow screens; the page never does. */}
      <div
        className="-mx-4 overflow-x-auto px-4 pb-2 [-webkit-overflow-scrolling:touch] min-[900px]:-mx-7 min-[900px]:px-7"
        tabIndex={0}
        role="region"
        aria-label="Knockout bracket, scrolls sideways"
      >
        <div className="ko-bracket mx-auto flex w-max items-stretch gap-3" aria-label="Official knockout bracket">
          {LEFT_COLS.map(([round, nos], i) => (
            <Column key={`l-${round}`} side="l" round={round} nos={nos} ties={ties} outer={i === 0} />
          ))}

          {/* Centre: the Final, vertically centred so both semi-finals meet it. */}
          <div className="flex shrink-0 flex-col">
            <RoundLabel>Final</RoundLabel>
            <ol aria-label="Final" className="ko-round flex-1">
              {final ? <TieCard v={final} roundLabel="Final" final /> : null}
            </ol>
          </div>

          {RIGHT_COLS.map(([round, nos], i) => (
            <Column
              key={`r-${round}`}
              side="r"
              round={round}
              nos={nos}
              ties={ties}
              outer={i === RIGHT_COLS.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Detached 3rd-place node — centred under the Final, not part of the tree. */}
      {third ? (
        <div className={cn("mx-auto", TIE_W)}>
          <RoundLabel>Third place</RoundLabel>
          <ol aria-label="Third place">
            <TieCard v={third} roundLabel="Third place" />
          </ol>
        </div>
      ) : null}
    </div>
  );
}
