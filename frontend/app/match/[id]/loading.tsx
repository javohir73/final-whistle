import { Skeleton, SkeletonScreen, SkeletonRows } from "@/components/Skeleton";

/** Route-level fallback for the match centre (also re-exported by the scoped
 *  /football/<comp>/match/<id> route). The page first awaits the prediction,
 *  the live summary and the competition together, then likely scorers and the
 *  forecast history together -- two parallel rounds on a cold backend, the
 *  highest cold-start risk of the football surfaces. Mirrors the page
 *  column: the back/share row, the hero (crests + "vs", the model's call with
 *  its one bar and two chips), the pick card, then one panel of rows. */
export default function MatchLoading() {
  return (
    <SkeletonScreen label="Loading match…">
      <div className="space-y-6">
        {/* Back link ↔ share button row. */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28 rounded" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>

        {/* Hero — status line, crests either side of "vs", names; then the
            model's call: sentence, the one W/D/L bar, two chips. */}
        <div className="glass rounded-2xl" data-skeleton="hero">
          <div className="border-b border-border p-6 text-center">
            <Skeleton className="mx-auto h-3 w-24 rounded" />
            <div className="mt-3 flex items-center justify-center gap-[18px]">
              <Skeleton className="h-11 w-11 rounded-full" />
              <Skeleton className="h-6 w-8 rounded" />
              <Skeleton className="h-11 w-11 rounded-full" />
            </div>
            <div className="mt-2 flex justify-center gap-[26px]">
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-4 w-16 rounded" />
            </div>
          </div>
          <div className="space-y-3 p-5">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-[7px] w-full rounded-full" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-32 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
          </div>
        </div>

        {/* Your pick — the stepper card directly under the call. */}
        <div className="glass space-y-3 rounded-2xl p-4" data-skeleton="pick">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>

        {/* One panel of content rows (the "why"). */}
        <SkeletonRows rows={5} />
      </div>
    </SkeletonScreen>
  );
}
