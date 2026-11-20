import { Card, Main, PageLayout, Rail } from "@/components/ui";

/** Cold-start skeleton for the matchweek view: the head, one fixtures card of
 *  quiet bars, and the rail -- same boxes as the page, no shimmer. */
export default function MatchweekLoading() {
  return (
    <div role="status" aria-label="Loading fixtures">
      <div className="pb-6 pt-3 min-[900px]:pb-8">
        <div className="h-4 w-48 rounded bg-line-soft" />
        <div className="mt-3 h-10 w-64 rounded bg-line-soft" />
        <div className="mt-4 h-4 w-full max-w-md rounded bg-line-soft" />
      </div>
      <PageLayout>
        <Main>
          <Card flush>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex min-h-[74px] items-center justify-center gap-4 border-t border-line-soft px-4 first:border-t-0">
                <div className="h-4 w-24 rounded bg-line-soft" />
                <div className="h-8 w-20 rounded-[10px] bg-soft" />
                <div className="h-4 w-24 rounded bg-line-soft" />
              </div>
            ))}
          </Card>
        </Main>
        <Rail>
          <Card pad>
            <div className="h-5 w-40 rounded bg-line-soft" />
            <div className="mt-4 h-24 rounded bg-soft" />
          </Card>
        </Rail>
      </PageLayout>
      <span className="sr-only">Loading fixtures…</span>
    </div>
  );
}
