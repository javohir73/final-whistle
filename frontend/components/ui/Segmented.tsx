/** The segmented control (".seg"): a soft pill track with one current item.
 *
 *  Items with `href` render as links (current = aria-current="page");
 *  items with `onSelect` render as buttons (current = aria-pressed).
 *
 *    <Segmented label="Show" items={[
 *      { label: "Fixtures", href: "/football/epl", current: true },
 *      { label: "Results", href: "/football/epl?view=results" },
 *    ]} />
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

export type SegmentedItem = {
  label: string;
  current?: boolean;
  href?: string;
  onSelect?: () => void;
};

const ITEM =
  "inline-flex min-h-[40px] items-center rounded-full px-5 font-medium text-muted no-underline transition-colors hover:text-ink";
const CURRENT = "bg-ground font-semibold text-ink shadow-seg";

export function Segmented({
  items,
  label,
  className,
}: {
  items: SegmentedItem[];
  /** Accessible name of the group, e.g. "Show". */
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex rounded-full bg-chip p-1", className)}>
      {items.map((item) =>
        item.href !== undefined ? (
          <Link
            key={item.label}
            href={item.href}
            aria-current={item.current ? "page" : undefined}
            className={cn(ITEM, item.current && CURRENT)}
          >
            {item.label}
          </Link>
        ) : (
          <button
            key={item.label}
            type="button"
            aria-pressed={Boolean(item.current)}
            onClick={item.onSelect}
            className={cn(ITEM, item.current && CURRENT)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
