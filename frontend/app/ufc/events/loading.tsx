import { Skeleton, SkeletonRows, SkeletonScreen } from "@/components/Skeleton";

/** Route fallback for /ufc/events: the page head and two card lists. */
export default function UfcEventsLoading() {
  return (
    <SkeletonScreen label="Loading events…">
      <Skeleton className="h-4 w-12 rounded" />
      <Skeleton className="mt-2 h-10 w-48 rounded" />
      <Skeleton className="mt-3 h-4 w-72 max-w-full rounded" />
      <div className="mt-8">
        <SkeletonRows rows={4} />
      </div>
      <div className="mt-6">
        <SkeletonRows rows={3} />
      </div>
    </SkeletonScreen>
  );
}
