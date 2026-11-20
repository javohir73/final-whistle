import { Skeleton, SkeletonScreen, SkeletonRows } from "@/components/Skeleton";

/** Route-level fallback for /football/wc26/groups. GroupsClient is
 *  server-seeded, so this shows only while page.tsx awaits the standings feed
 *  on a cold navigation. Mirrors the page head plus the group-card grid (one
 *  SkeletonRows card per group, four rows each — a group's four teams) so the
 *  tables drop in without shifting. */
export default function GroupsLoading() {
  return (
    <SkeletonScreen label="Loading groups…">
      <div className="pb-6 pt-3 min-[900px]:pb-8">
        <Skeleton className="h-5 w-32 rounded-full" />
        <Skeleton className="mt-3 h-10 w-64 rounded-full" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-full" />
      </div>
      <div className="grid gap-6 min-[900px]:grid-cols-2 min-[1280px]:grid-cols-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRows key={i} rows={4} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
