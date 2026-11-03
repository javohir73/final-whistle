import { cn } from "@/lib/utils";
import type { NavTabId } from "@/lib/sports";

/** Glyphs keyed by the tab's stable id (lib/sports.ts NavTabId), never by its
 *  label: labels vary by competition ("Table" / "Ladder" / "Groups") and a
 *  rename used to silently drop the icon. The Record type makes a missing
 *  glyph a compile error instead. */
const ICONS: Record<NavTabId, React.ReactNode> = {
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" strokeLinejoin="round" strokeLinecap="round" />,
  fixtures: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
    </>
  ),
  table: <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />,
  play: (
    <>
      <path d="M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1Z" strokeLinejoin="round" />
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 12.5l2 2 4-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  mypicks: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
    </>
  ),
};

/** One icon vocabulary for desktop and mobile navigation. */
export function NavIcon({
  id,
  active = false,
  className,
}: {
  id: NavTabId;
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.4 : 2}
      aria-hidden="true"
    >
      {ICONS[id]}
    </svg>
  );
}
