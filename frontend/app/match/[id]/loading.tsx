import { Skeleton, SkeletonScreen } from "@/components/Skeleton";

/** Route-level fallback for the match page (also re-exported by the scoped
 *  /football/<comp>/match/<id> route). Mirrors the direction-G page so the
 *  real one swaps in without shifting: the top bar, the centred hero with
 *  the two clubs either side of the kick-off and the pick under a hairline,
 *  then the two cards below. */
export default function MatchLoading() {
  return (
    <SkeletonScreen label="Loading match…">
      <div className="flex items-center justify-between pb-5">
        <Skeleton className="h-5 w-32 rounded" />
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>

      <div
        className="flex flex-col items-center rounded-card border border-line bg-ground px-4 pb-7 pt-7 min-[900px]:px-10 min-[900px]:pb-9 min-[900px]:pt-10"
        data-skeleton="hero"
      >
        <Skeleton className="h-4 w-72 max-w-full rounded" />
        <div className="mt-6 flex w-full max-w-[880px] items-center justify-center gap-6 min-[900px]:gap-8">
          <Skeleton className="h-[60px] w-[60px] rounded-full" />
          <Skeleton className="h-8 w-24 rounded" />
          <Skeleton className="h-[60px] w-[60px] rounded-full" />
        </div>
        <div className="mt-8 h-px w-full max-w-[550px] bg-line" />
        <div className="flex w-full max-w-[550px] flex-col items-center gap-6 pt-7" data-skeleton="pick">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-[72px] w-full max-w-[420px] rounded-[14px] min-[480px]:h-[84px]" />
          <Skeleton className="h-14 w-full rounded-full" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr))]">
        <Skeleton className="h-64 w-full rounded-card" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    </SkeletonScreen>
  );
}
