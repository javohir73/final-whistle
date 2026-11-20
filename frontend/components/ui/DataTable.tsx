/** Tables (standings, ladder, leaderboard, mini tables).
 *
 *  15px cells, numbers right-aligned, a left-aligned club cell with its
 *  crest, 13px muted header, line-soft row rules, a `pos` column that can
 *  carry a 3px zone marker, bold points. Wrap in <TableScroll> so a wide
 *  table scrolls sideways inside its card instead of the page.
 *
 *    <TableScroll>
 *      <Table>
 *        <thead><tr><Th align="left"><span className="sr-only">Position</span></Th>
 *          <Th align="left">Club</Th><Th>P</Th><Th>Pts</Th></tr></thead>
 *        <tbody>
 *          <tr><Td pos zone="a">1</Td>
 *            <Td align="left"><ClubCell href="…" crest={<ClubBadge name="Arsenal" size={22} />} name="Arsenal" /></Td>
 *            <Td>10</Td><Td pts>27</Td></tr>
 *        </tbody>
 *      </Table>
 *    </TableScroll>
 *    <Legend items={[{ zone: "a", label: "Champions League" }, …]} />
 */
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import Link from "next/link";
import type { StandingsZone } from "@/lib/sports";
import { cn } from "@/lib/utils";

/** a = brand (top zone), b = #8fb3a5 (second zone), c = miss (relegation). */
export type Zone = "a" | "b" | "c";

/** The 3px inset marker on the position cell (classes in globals.css). */
export const ZONE_SHADOW: Record<Zone, string> = { a: "fw-zone-a", b: "fw-zone-b", c: "fw-zone-c" };
export const ZONE_FILL: Record<Zone, string> = { a: "bg-brand", b: "bg-europa", c: "bg-miss" };

/** Maps a registry zone tone (lib/sports.ts StandingsZone) to a marker. */
export function zoneForTone(tone: StandingsZone["tone"]): Zone | undefined {
  switch (tone) {
    case "cl":
    case "finals":
    case "promo":
      return "a";
    case "europa":
      return "b";
    case "releg":
      return "c";
    default:
      return undefined;
  }
}

/** The marker for a table position, from a competition's zones. */
export function zoneForPosition(position: number, zones: StandingsZone[]): Zone | undefined {
  const hit = zones.find((z) => position >= z.from && position <= z.to);
  return hit ? zoneForTone(hit.tone) : undefined;
}

export function TableScroll({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto", className)} {...rest} />;
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-table", className)} {...rest} />;
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({
  align = "right",
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-2 py-2.5 text-label font-medium text-muted", ALIGN[align], className)}
      {...rest}
    />
  );
}

export function Td({
  align = "right",
  pos,
  zone,
  pts,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  align?: Align;
  /** The position column: muted, narrow, left-aligned. */
  pos?: boolean;
  /** Zone marker on the position cell. */
  zone?: Zone;
  /** Bold points cell. */
  pts?: boolean;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap border-t border-line-soft px-2 py-3",
        ALIGN[pos ? "left" : align],
        pos && "w-9 text-muted",
        zone && ZONE_SHADOW[zone],
        pts && "font-bold",
        className,
      )}
      {...rest}
    />
  );
}

/** Crest + club name, optionally a link (to the club page). */
export function ClubCell({
  name,
  crest,
  href,
  className,
}: {
  name: ReactNode;
  crest?: ReactNode;
  href?: string;
  className?: string;
}) {
  const cls = cn(
    "inline-flex items-center gap-3 font-semibold text-ink no-underline underline-offset-[3px]",
    href && "hover:underline",
    className,
  );
  const inner = (
    <>
      {crest}
      <span>{name}</span>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export function Legend({
  items,
  className,
}: {
  items: Array<{ zone: Zone; label: string }>;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-x-6 gap-y-2 pt-4 text-sm text-muted", className)}>
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center">
          <i aria-hidden="true" className={cn("mr-2 inline-block h-3.5 w-[3px] rounded-sm", ZONE_FILL[item.zone])} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
