import { Skeleton, SkeletonScreen } from "@/components/Skeleton";

/** Fighter page skeleton: the head (monogram, name, sub line), the facts card
 *  and the fights table. Pure presentation, no data. */
export default function UfcFighterLoading() {
  return (
    <SkeletonScreen label="Loading…">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="mt-2 h-8 w-56 max-w-full rounded" />
          <Skeleton className="mt-2 h-4 w-44 max-w-full rounded" />
        </div>
      </div>
      <div className="mt-6 rounded-card border border-line bg-ground p-4">
        <Skeleton className="h-5 w-32 rounded" />
        <div className="mt-5 grid grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-7 w-20 rounded" />
              <Skeleton className="mt-2 h-4 w-12 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-card border border-line bg-ground">
        <div className="border-b border-line-soft bg-soft px-4 py-3">
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-line-soft px-4 py-3 first:border-t-0">
            <Skeleton className="h-4 w-16 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="ml-auto h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
