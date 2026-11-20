/** The page head (".head"): eyebrow, the 48px h1 (36px under 900px), an
 *  optional sub line (≤65ch), optional controls beside the h1 (prev/next
 *  arrows), optional right-side actions (a Segmented, a GhostButton), an
 *  optional back link above, and an optional leading logo/crest.
 *
 *    <PageHead
 *      eyebrow="Premier League · 2026–27"
 *      title="Matchweek 11"
 *      titleAside={<><RoundLink label="Matchweek 10" href="…"><ChevronLeftIcon/></RoundLink>…</>}
 *      sub="Ten matches. Call each score before kick-off."
 *      actions={<Segmented label="Show" items={…} />}
 *    />
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

/** The h1 classes, for the rare page that renders its own heading. */
export const H1_CLASS = "text-h1-sm font-semibold text-ink min-[900px]:text-h1";

export function BackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-2 font-medium text-muted no-underline hover:text-ink",
        className,
      )}
    >
      <ChevronLeftIcon />
      {children}
    </Link>
  );
}

export function PageHead({
  eyebrow,
  title,
  titleAside,
  sub,
  actions,
  back,
  leading,
  titleId,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Nodes on the h1's line, e.g. prev/next RoundLinks. */
  titleAside?: ReactNode;
  sub?: ReactNode;
  /** Right-aligned (bottom-aligned) controls; wrap under the title on phones. */
  actions?: ReactNode;
  /** A "‹ Table" link above the head. */
  back?: { href: string; label: string };
  /** A crest or competition logo before the text (club pages). */
  leading?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  const text = (
    <div className="min-w-0">
      {eyebrow != null && <div className="text-notes font-medium text-muted">{eyebrow}</div>}
      <div className={cn("flex flex-wrap items-center gap-4", eyebrow != null && "mt-1.5")}>
        <h1 id={titleId} className={cn(H1_CLASS, "min-w-0 break-words")}>
          {title}
        </h1>
        {titleAside}
      </div>
      {sub != null && <p className="mt-2.5 max-w-prose text-muted">{sub}</p>}
    </div>
  );
  return (
    <>
      {back && (
        <div className="-mt-2">
          <BackLink href={back.href}>{back.label}</BackLink>
        </div>
      )}
      <div
        className={cn(
          "flex flex-wrap items-end justify-between gap-5 pb-6 min-[900px]:pb-8",
          // <main> already gives 32px; this tops the head up to the 44px gap.
          back ? "pt-2 min-[900px]:pt-3" : "pt-3",
          className,
        )}
      >
        {leading ? (
          <div className="flex min-w-0 items-center gap-4 min-[900px]:gap-6">
            <div className="shrink-0">{leading}</div>
            {text}
          </div>
        ) : (
          text
        )}
        {actions != null && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </>
  );
}
