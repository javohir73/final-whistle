import { Skeleton, SkeletonScreen } from "@/components/Skeleton";

/** Route skeleton for /ufc and /ufc/event/[slug]: head, two cards of three rows, a rail. */
export default function UfcHomeLoading() {
  return (
    <SkeletonScreen label="Loading…">
      <Skeleton className="h-3 w-32 rounded" />
      <Skeleton className="mt-2 h-9 w-72 max-w-full rounded" />
      <Skeleton className="mt-2.5 h-4 w-60 max-w-full rounded" />
      <div className="mt-6 flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[999_1_700px] flex-col gap-6">
          {[0, 1].map((c) => (
            <div key={c} className="overflow-hidden rounded-card border border-line bg-ground">
              <Skeleton className="h-10 w-full rounded-none" />
              {[0, 1, 2].map((r) => (
                <div key={r} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-40 max-w-full rounded" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-[1_1_340px]">
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
