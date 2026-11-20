/** Main column + rail (the prototype's .layout/.main/.rail).
 *
 *  A wrapping flex row: Main grows (`flex: 999 1 700px`), Rail takes about
 *  340px (`flex: 1 1 340px`), gap 32px, both min-width 0. When the row
 *  cannot hold 700 + 32 + 340 the rail drops UNDER the main column and
 *  stretches full width (at 1024px with 40px gutters it already drops).
 *  Each column stacks its children with a 24px gap.
 *
 *    <PageLayout>
 *      <Main>…cards…</Main>
 *      <Rail>…cards…</Rail>
 *    </PageLayout>
 *
 *  Pages without a rail just render <Main> alone, or nothing at all: the
 *  site container (app/layout.tsx) already sets width and gutters.
 */
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageLayout({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-start gap-8", className)} {...rest} />;
}

export function Main({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-w-0 flex-[999_1_700px] flex-col gap-6", className)}
      {...rest}
    />
  );
}

/** Renders an <aside>. Give it an aria-label when it holds more than one card. */
export function Rail({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <aside className={cn("flex min-w-0 flex-[1_1_340px] flex-col gap-6", className)} {...rest} />
  );
}
