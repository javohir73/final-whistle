import type { ReactNode } from "react";
import { Chip, FixtureRow, KickoffBox, ResultBox } from "@/components/ui";
import { boutHref, boutSubLine, localTime, resultBoxText, resultLine } from "@/lib/ufcDisplay";
import type { UfcBoutSummary } from "@/lib/ufcTypes";
import { FighterMark } from "./FighterMark";

/** Under 400px the row gives up 6px of side padding to the name columns: at 390px a
 *  column is 95px, half a pixel short of "Mehemmedeli" (95.5px), which then broke
 *  mid-word. With 98px it wraps between words; only a word wider than the column breaks. */
const ROW_GUTTER = "max-[400px]:px-1.5";

/** A word that fits its column must wrap to the next line whole. `hyphens: auto` (the shared row's
 *  default) hyphenates a word that is merely late on a line, so "Mehemmedeli" broke mid-word at 375px
 *  and 360px even though it fits a line of its own; with manual hyphenation only a word wider than
 *  its column breaks (`break-words`). Under 400px the spine also gives up 2px between its columns. */
const NAME_WRAP = "max-[400px]:[&>a]:gap-x-1 [&_span]:[hyphens:manual]";

/** Under 370px a name column is 90px at 360px (97.5px at 375px), which "Mehemmedeli" (95.5px) no
 *  longer fits. The two marks go from 26px to 22px and the centre box from 66px to 58px: 16px freed,
 *  8px for each name column, so 98px at 360px. (The marks are inline-sized, hence `!`.) */
const NAME_ROOM =
  "max-[370px]:[&>a]:grid-cols-[minmax(0,1fr)_22px_58px_22px_minmax(0,1fr)] max-[370px]:[&_span[style]]:!h-[22px] max-[370px]:[&_span[style]]:!w-[22px]";
const CENTRE_BOX = "max-[370px]:min-w-[58px]";

/** One fight on a card, on the shared fixture row. `showTime={false}` is for a
 *  card, where the segment band already gives the start and the feed repeats
 *  that start on every fight in the segment. */
export function BoutRow({
  bout,
  tz,
  isMainEvent,
  showTime = true,
  right: rightSlot,
}: {
  bout: UfcBoutSummary;
  tz: string;
  isMainEvent: boolean;
  showTime?: boolean;
  /** Replaces the right-hand slot (the "Cancelled" chip, or nothing). Absent: the row is as before. */
  right?: ReactNode;
}) {
  const a = bout.fighter_a;
  const b = bout.fighter_b;
  const versus = `${a.name} v ${b.name}`;
  const side = (f: typeof a, extra: { muted?: boolean; struck?: boolean } = {}) => ({
    name: f.name,
    crest: <FighterMark name={f.name} />,
    ...extra,
  });

  let sideA = side(a);
  let sideB = side(b);
  let kickoff: string | undefined;
  let centre: ReactNode;
  let right: ReactNode;
  let label: string;

  switch (bout.status) {
    case "live":
      centre = <KickoffBox className={CENTRE_BOX}>Live</KickoffBox>;
      label = `${versus}, live now`;
      break;
    case "finished": {
      const r = bout.result;
      if (r) centre = <ResultBox className={CENTRE_BOX}>{resultBoxText(r)}</ResultBox>;
      const decided = r && r.method !== "draw" && r.method !== "no_contest";
      if (decided && r.winner === "a") sideB = side(b, { muted: true });
      else if (decided && r.winner === "b") sideA = side(a, { muted: true });
      label = `${versus}. ${resultLine(bout)}`;
      break;
    }
    case "cancelled":
      sideA = side(a, { struck: true });
      sideB = side(b, { struck: true });
      right = <Chip>Cancelled</Chip>;
      label = `${versus}, cancelled`;
      break;
    default:
      if (showTime) {
        kickoff = localTime(bout.scheduled_utc, tz) ?? "TBC";
        label = `${versus}, ${kickoff}`;
      } else {
        centre = (
          <span aria-hidden="true" className="justify-self-center text-dash">
            v
          </span>
        );
        label = `${versus}, upcoming`;
      }
  }

  return (
    <FixtureRow
      href={boutHref(bout.id)}
      left={boutSubLine(bout, isMainEvent)}
      leftOnPhone
      home={sideA}
      away={sideB}
      kickoff={kickoff}
      centre={centre}
      right={rightSlot !== undefined ? rightSlot : right}
      label={label}
      className={`${ROW_GUTTER} ${NAME_WRAP} ${NAME_ROOM}`}
    />
  );
}
