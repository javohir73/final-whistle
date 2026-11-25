import { Skeleton, SkeletonScreen } from "@/components/Skeleton";

/** Fight page skeleton: back link, the centred hero with two fighters either
 *  side of the start time, then the tale of the tape card. */
export default function FightLoading() {
  return (
    <SkeletonScreen label="Loading…">
      <Skeleton className="h-5 w-40 rounded" />
      <div className="mt-4 flex flex-col items-center rounded-card border border-line bg-ground px-4 pb-7 pt-7 min-[900px]:px-10">
        <Skeleton className="h-4 w-56 max-w-full rounded" />
        <div className="mt-6 flex w-full max-w-[880px] items-center justify-center gap-6 min-[900px]:gap-8">
          <Skeleton className="h-[60px] w-[60px] rounded-full" />
          <Skeleton className="h-8 w-24 rounded" />
          <Skeleton className="h-[60px] w-[60px] rounded-full" />
        </div>
        <Skeleton className="mt-5 h-4 w-48 rounded" />
      </div>
      <Skeleton className="mx-auto mt-6 h-64 w-full max-w-[900px] rounded-card" />
    </SkeletonScreen>
  );
}
