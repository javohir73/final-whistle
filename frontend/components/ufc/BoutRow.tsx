import type { ReactNode } from "react";
import { kickoffTimeLower } from "@/components/match/matchPageData";
import { Chip, FixtureRow, KickoffBox, ResultBox } from "@/components/ui";
import { boutHref, boutSubLine, resultBoxText, resultLine } from "@/lib/ufcDisplay";
import type { UfcBoutSummary } from "@/lib/ufcTypes";
import { FighterMark } from "./FighterMark";

/** One fight on a card, on the shared fixture row. */
export function BoutRow({ bout, tz, isMainEvent }: { bout: UfcBoutSummary; tz: string; isMainEvent: boolean }) {
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
      centre = <KickoffBox>Live</KickoffBox>;
      label = `${versus}, live now`;
      break;
    case "finished": {
      const r = bout.result;
      if (r) centre = <ResultBox>{resultBoxText(r)}</ResultBox>;
      if (r?.winner === "a") sideB = side(b, { muted: true });
      else if (r?.winner === "b") sideA = side(a, { muted: true });
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
      kickoff = bout.scheduled_utc ? kickoffTimeLower(bout.scheduled_utc, tz) : "TBC";
      label = `${versus}, ${kickoff}`;
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
      right={right}
      label={label}
    />
  );
}
