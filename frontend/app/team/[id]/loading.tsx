import { Skeleton, SkeletonScreen } from "@/components/Skeleton";

/** Route-level fallback for the club / national-team page: the back link, the
 *  64px crest beside the eyebrow + h1 + sub, then the main column (season card,
 *  fixtures card) beside the rail, in the page's own boxes so it drops in
 *  without a shift. */
export default function TeamLoading() {
  return (
    <SkeletonScreen label="Loading team…">
      <div data-team-skeleton>
        <Skeleton className="-mt-2 h-11 w-20 rounded" />
        <div className="flex items-center gap-4 pb-6 pt-2 min-[900px]:gap-6 min-[900px]:pb-8 min-[900px]:pt-3">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-48 rounded" />
            <Skeleton className="mt-3 h-10 w-64 max-w-full rounded" />
            <Skeleton className="mt-3 h-4 w-80 max-w-full rounded" />
          </div>
        </div>
        <div className="flex flex-wrap gap-8">
          <div className="flex min-w-0 flex-[999_1_700px] flex-col gap-6">
            <Skeleton className="h-[188px] rounded-card" />
            <Skeleton className="h-[280px] rounded-card" />
          </div>
          <div className="min-w-0 flex-[1_1_340px]">
            <Skeleton className="h-[380px] rounded-card" />
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}
