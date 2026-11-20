/** Small content blocks: stats, empty state, reading column, locked list.
 *
 *    <StatGrid><Stat value="64%" label="of winners called" /></StatGrid>
 *    <EmptyState title="Tips reopen in March" actions={<Button>…</Button>}>Copy…</EmptyState>
 *    <Prose><h2>What it does</h2><p>…</p></Prose>
 *    <LockedList items={["The model's score", "Win, draw and loss chances"]} />
 */
import type { HTMLAttributes, ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { LockIcon } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";

export function StatGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-6", className)}
      {...rest}
    />
  );
}

export function Stat({ value, label, className }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-stat font-semibold text-ink">{value}</div>
      <div className="mt-1.5 text-muted">{label}</div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  actions,
  headingAs: Heading = "h2",
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  headingAs?: "h2" | "h3";
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col items-center gap-3.5 px-4 py-12 text-center min-[900px]:px-7", className)}>
      <Heading className="text-2xl font-semibold text-ink">{title}</Heading>
      {children != null && <div className="max-w-[46ch] text-notes text-muted">{children}</div>}
      {actions != null && <div className="flex flex-col items-center gap-3.5">{actions}</div>}
    </Card>
  );
}

/** The reading column: 65ch, left-aligned, 16px gaps, h2 at card-heading size. */
export function Prose({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex max-w-prose flex-col gap-4 text-ink",
        "[&_h2]:mt-2 [&_h2]:text-h2 [&_h2]:font-semibold",
        "[&_ul]:m-0 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5",
        "[&_a:not([class])]:font-semibold [&_a:not([class])]:text-brand [&_a:not([class])]:underline-offset-[3px] [&_a:not([class]):hover]:underline",
        className,
      )}
      {...rest}
    />
  );
}

/** "Unlocked when you lock your pick" rows: lock icon, label, skeleton bar. */
export function LockedList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn("mt-4 list-none p-0", className)}>
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-center justify-between gap-4 border-t border-line-soft py-3.5"
        >
          <span className="inline-flex items-center gap-3 font-medium text-ink">
            <LockIcon />
            {item}
          </span>
          <span aria-hidden="true" className="h-2.5 w-24 shrink-0 rounded-[5px] bg-line-soft" />
        </li>
      ))}
    </ul>
  );
}
