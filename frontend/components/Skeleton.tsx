import { cn } from "@/lib/utils";

/** Shared loading-skeleton primitives. Pure presentation, no client hooks —
 *  safe to render in Server Components (route `loading.tsx` fallbacks) as well
 *  as inside client islands. The shimmer sweep and its reduced-motion gate live
 *  on the `skeleton` class in globals.css. */

/** One soft block (line-soft fill; the faint sweep stops under reduced
 *  motion). Composes the `skeleton` class with caller layout classes.
 *  `aria-hidden` because a shimmer block carries no meaning on its own — the
 *  announcing `role="status"` lives on the surrounding SkeletonScreen. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Status wrapper for a whole loading view. Mirrors States.Loading's a11y
 *  contract so each `loading.tsx` announces exactly one status to AT. */
export function SkeletonScreen({
  label = "Loading…",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label}>
      {children}
    </div>
  );
}

/** A fixture-list placeholder in the direction-G card: a day band and six
 *  rows shaped like the centred fixture spine. Shared by the football and NRL
 *  list loaders (and States.Loading) so they don't each hand-roll it. */
export function SkeletonCardGrid() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-ground">
      <div className="border-b border-line-soft bg-soft px-4 py-3 min-[900px]:px-7">
        <Skeleton className="h-4 w-40 rounded-full" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid min-h-[74px] grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-3 border-t border-line-soft px-4 first:border-t-0 min-[900px]:px-7"
        >
          <div className="flex items-center justify-end gap-3">
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
          <Skeleton className="h-8 w-[72px] rounded-[10px]" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Standings / ladder table placeholder: a header bar plus `rows` fixed-height
 *  rows. Heights and widths are fixed so the skeleton reserves the same box the
 *  real table fills — no layout shift when data lands. */
export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-card border border-line bg-ground px-4 py-5 min-[900px]:px-7 min-[900px]:py-6">
      <Skeleton className="mb-4 h-5 w-32 rounded-full" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}
