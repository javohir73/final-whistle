/** The fixture row: a centred spine
 *    home name | crest | kick-off or score | crest | away name
 *  with the venue/label on the left and the action on the right.
 *
 *  Desktop (≥900px): grid `150px | 1fr | 150px`, spine `1fr 30px 84px 30px 1fr`.
 *  Phone (<900px):   one column, left label hidden (unless `leftOnPhone`), spine `1fr 26px 66px 26px 1fr`,
 *                    the right part centred under the spine.
 *  Long names wrap (and hyphenate) inside their column; nothing overflows at 390px.
 *
 *  Put rows straight into <Card flush>, between <DayBand>s, above a <CardFoot>.
 *
 *    <FixtureRow
 *      href={footballMatchHref("epl", m.id)}
 *      left={m.venue ?? "Venue to be confirmed"}
 *      home={{ name: m.home, crest: <ClubBadge name={m.home} size={26} /> }}
 *      away={{ name: m.away, crest: <ClubBadge name={m.away} size={26} /> }}
 *      kickoff="2:00 am"              // or: score={{ home: 2, away: 1 }}
 *      right={<GhostButton href={…} aria-label={`Pick the score for ${m.home} v ${m.away}`}>Pick score</GhostButton>}
 *    />
 *
 *  Crests: pass the LOGOS agent's components (ClubBadge / Flag). The spine
 *  link already carries the full accessible name, so crests inside it should
 *  be decorative or carry the plain club name as alt.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type FixtureSide = {
  name: string;
  crest?: ReactNode;
  /** A shorter name printed below 900px in place of `name`, for a club whose
   *  full name holds a word too long for the phone column. The link's
   *  accessible name always uses `name`. */
  phoneName?: string;
};

function SideName({ side, className }: { side: FixtureSide; className?: string }) {
  if (!side.phoneName || side.phoneName === side.name) {
    return <span className={className}>{side.name}</span>;
  }
  return (
    <span className={className}>
      <span className="min-[900px]:hidden">{side.phoneName}</span>
      <span className="max-[899px]:hidden">{side.name}</span>
    </span>
  );
}

export type FixtureRowProps = {
  home: FixtureSide;
  away: FixtureSide;
  /** Kick-off text in the soft box, e.g. "2:00 am". */
  kickoff?: string;
  /** Final (or live) score in the ink box. Wins over `kickoff`. */
  score?: { home: number | string; away: number | string };
  /** Anything else for the centre slot (overrides both of the above). */
  centre?: ReactNode;
  /** Venue or label at the left (hidden under 900px unless `leftOnPhone`). */
  left?: ReactNode;
  /** Show `left` on phones too, as a small centred line above the spine. Use
   *  it where the label is the only place the date appears (club fixtures). */
  leftOnPhone?: boolean;
  /** The action: a GhostButton, a <FixturePair>, a <Chip>… */
  right?: ReactNode;
  /** Makes the spine a link (to the match page). */
  href?: string;
  /** Accessible name of the spine link; defaults to "Home v Away, <kick-off>"
   *  or "Home 2–1 Away". */
  label?: string;
  className?: string;
};

const SPINE =
  "grid grid-cols-[minmax(0,1fr)_26px_66px_26px_minmax(0,1fr)] items-center gap-x-1.5 rounded-[10px] py-1.5 text-ink no-underline min-[900px]:grid-cols-[minmax(0,1fr)_30px_84px_30px_minmax(0,1fr)] min-[900px]:gap-x-3.5";
const NAME =
  "min-w-0 break-words text-sm font-semibold leading-snug hyphens-auto min-[900px]:text-base underline-offset-[3px] group-hover/spine:underline";
const BOX =
  "justify-self-center whitespace-nowrap rounded-[10px] py-1.5 text-center font-semibold min-w-[66px] min-[900px]:min-w-[84px]";

export function KickoffBox({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(BOX, "bg-chip text-notes text-ink", className)}>{children}</span>;
}

export function ScoreBox({
  home,
  away,
  className,
}: {
  home: number | string;
  away: number | string;
  className?: string;
}) {
  return (
    <span className={cn(BOX, "bg-ink text-base text-white", className)}>
      {home}–{away}
    </span>
  );
}

export function FixtureRow({
  home,
  away,
  kickoff,
  score,
  centre,
  left,
  leftOnPhone = false,
  right,
  href,
  label,
  className,
}: FixtureRowProps) {
  const middle =
    centre ??
    (score ? (
      <ScoreBox home={score.home} away={score.away} />
    ) : kickoff ? (
      <KickoffBox>{kickoff}</KickoffBox>
    ) : (
      <span aria-hidden="true" className="justify-self-center text-dash">
        –
      </span>
    ));
  const name =
    label ??
    (score
      ? `${home.name} ${score.home}–${score.away} ${away.name}`
      : `${home.name} v ${away.name}${kickoff ? `, ${kickoff}` : ""}`);

  const spineContent = (
    <>
      <SideName side={home} className={cn(NAME, "text-right")} />
      <span className="flex items-center justify-center">{home.crest}</span>
      {middle}
      <span className="flex items-center justify-center">{away.crest}</span>
      <SideName side={away} className={NAME} />
    </>
  );

  return (
    <div
      className={cn(
        "grid min-h-[74px] grid-cols-1 items-center gap-y-2.5 border-t border-line-soft px-3 py-3.5 first:border-t-0",
        "min-[900px]:grid-cols-[150px_minmax(0,1fr)_150px] min-[900px]:gap-x-4 min-[900px]:px-7",
        className,
      )}
    >
      <span
        className={cn(
          "text-sm leading-tight text-muted min-[900px]:block min-[900px]:text-left",
          leftOnPhone && left
            ? "flex flex-wrap justify-center gap-x-2 text-center min-[900px]:justify-start"
            : "hidden",
        )}
      >
        {left}
      </span>
      {href ? (
        <Link href={href} aria-label={name} className={cn(SPINE, "group/spine")}>
          {spineContent}
        </Link>
      ) : (
        <div className={SPINE} aria-label={name} role="group">
          {spineContent}
        </div>
      )}
      <div className="justify-self-center text-center min-[900px]:justify-self-end min-[900px]:text-right">
        {right}
      </div>
    </div>
  );
}

/** The right-hand "You 2–1 / Model 2–0" pair. Rows stack on desktop and sit
 *  side by side on phones. Mark the user's row `you` (brand colour). */
export function FixturePair({
  rows,
  className,
}: {
  rows: Array<{ label: ReactNode; value: ReactNode; you?: boolean }>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex flex-row flex-wrap justify-center gap-x-4 text-notes leading-[1.4] text-muted min-[900px]:flex-col min-[900px]:items-end",
        className,
      )}
    >
      {rows.map((row, i) => (
        <span key={i}>
          {row.label}{" "}
          <b className={cn("text-base font-bold", row.you ? "text-brand" : "text-ink")}>{row.value}</b>
        </span>
      ))}
    </span>
  );
}
