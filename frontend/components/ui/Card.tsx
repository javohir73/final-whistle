/** Cards: 16px radius, 1px line border, white, NO shadow.
 *
 *    <Card pad>             padded card (24×28, 20×16 under 900px)
 *    <Card flush>           unpadded, overflow hidden — for fixture lists
 *                           (DayBand / FixtureRow / CardFoot go straight in)
 *    <CardHead title=… action=…>  h2 19/600 + optional right-side link/note
 *    <DayBand>              soft band heading inside a flush card
 *    <CardFoot>             soft foot strip (".fxfoot")
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type CardElement = "section" | "div" | "article" | "aside" | "li";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: CardElement;
  /** 24×28 padding on desktop, 20×16 under 900px. */
  pad?: boolean;
  /** No padding and overflow hidden (fixture lists, tables that touch the edge). */
  flush?: boolean;
};

/** Padding shared by everything that sits flush inside a card. */
export const CARD_X = "px-4 min-[900px]:px-7";

export function Card({ as: Tag = "section", pad, flush, className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card border border-line bg-ground",
        pad && "px-4 py-5 min-[900px]:px-7 min-[900px]:py-6",
        flush && "overflow-hidden",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHead({
  title,
  as: Heading = "h2",
  id,
  action,
  className,
}: {
  title: ReactNode;
  /** Heading level; h2 by default (cards sit under the page h1). */
  as?: "h2" | "h3";
  id?: string;
  /** Right-side node: a <TextLink>, a muted note, a <Tag>… */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <Heading id={id} className="text-h2 font-semibold text-ink">
        {title}
      </Heading>
      {action != null && <div className="shrink-0 text-notes text-muted">{action}</div>}
    </div>
  );
}

/** Muted 15px supporting copy (".note"). */
export function Note({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-notes text-muted", className)} {...rest} />;
}

export function DayBand({
  as: Tag = "div",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: "div" | "h3" | "h2" }) {
  return (
    <Tag
      className={cn(
        "border-t border-line-soft bg-soft py-3 text-notes font-semibold text-ink first:border-t-0",
        CARD_X,
        className,
      )}
      {...rest}
    />
  );
}

export function CardFoot({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-soft py-5",
        CARD_X,
        className,
      )}
      {...rest}
    />
  );
}
