/** Buttons and links of direction G.
 *
 *  Every control here renders as a Next `<Link>` when given `href` and as a
 *  `<button type="button">` otherwise. A disabled LINK renders as a
 *  non-focusable `<span aria-disabled="true">` (there is no such thing as a
 *  disabled anchor); a disabled BUTTON keeps the native `disabled` attribute.
 *
 *    Button      brand pill, min-h 48 (`wide`: full width, min-h 56, 17px;
 *                `size="sm"`: min-h 44, the header "Sign in")
 *    GhostButton ink outline pill, min-h 44 ("Pick score", "Not now")
 *    TextLink    brand 600 15px link ("Full table", "See the leaderboard")
 *    Pill        44px outline pill (the competition switcher trigger)
 *    IconButton  44px circle with an icon; `label` is REQUIRED (its name)
 *    RoundLink   = IconButton (alias, reads better for prev/next arrows)
 */
import { forwardRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type ActionProps = {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Renders a Next <Link> to this href instead of a <button>. */
  href?: string;
  /** Link only. */
  target?: string;
  rel?: string;
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
  /** Button only. Defaults to "button". */
  type?: "button" | "submit" | "reset";
  form?: string;
  name?: string;
  value?: string;
  id?: string;
  title?: string;
  tabIndex?: number;
  "aria-label"?: string;
  "aria-current"?: React.AriaAttributes["aria-current"];
  "aria-expanded"?: boolean;
  "aria-haspopup"?: React.AriaAttributes["aria-haspopup"];
  "aria-controls"?: string;
  "aria-pressed"?: boolean;
  "aria-describedby"?: string;
  "data-testid"?: string;
};

/** The shared element switch. Exported for primitives built on top of it. */
export const Action = forwardRef<HTMLElement, ActionProps>(function Action(props, ref) {
  const {
    className, children, disabled, onClick, href,
    target, rel, prefetch, scroll, replace,
    type = "button", form, name, value,
    ...rest
  } = props;
  if (href !== undefined) {
    if (disabled) {
      return (
        <span ref={ref as Ref<HTMLSpanElement>} aria-disabled="true" className={className} {...rest} tabIndex={undefined}>
          {children}
        </span>
      );
    }
    return (
      <Link
        ref={ref as Ref<HTMLAnchorElement>}
        href={href}
        target={target}
        rel={rel}
        prefetch={prefetch}
        scroll={scroll}
        replace={replace}
        onClick={onClick}
        className={className}
        {...rest}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type={type}
      form={form}
      name={name}
      value={value}
      disabled={disabled}
      onClick={onClick}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
});

const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 font-semibold text-white no-underline transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-disabled aria-disabled:cursor-not-allowed aria-disabled:bg-disabled";

export type ButtonProps = ActionProps & {
  /** Full width, min-height 56, 17px — the match page's lock button. */
  wide?: boolean;
  /** "sm" = min-height 44 (header Sign in). Default min-height 48. */
  size?: "md" | "sm";
};

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { wide, size = "md", className, ...props },
  ref,
) {
  return (
    <Action
      ref={ref}
      {...props}
      className={cn(
        BUTTON,
        size === "sm" ? "min-h-[44px] px-5" : "min-h-[48px]",
        wide && "min-h-[56px] w-full text-[17px]",
        className,
      )}
    />
  );
});

export const GhostButton = forwardRef<HTMLElement, ActionProps>(function GhostButton(
  { className, ...props },
  ref,
) {
  return (
    <Action
      ref={ref}
      {...props}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ink bg-ground px-5 font-semibold text-ink no-underline transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:border-line-strong disabled:text-muted disabled:hover:bg-ground aria-disabled:cursor-not-allowed aria-disabled:border-line-strong aria-disabled:text-muted",
        className,
      )}
    />
  );
});

export const TextLink = forwardRef<HTMLElement, ActionProps>(function TextLink(
  { className, ...props },
  ref,
) {
  return (
    <Action
      ref={ref}
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-notes font-semibold text-brand no-underline underline-offset-[3px] hover:underline aria-disabled:text-muted aria-disabled:no-underline",
        className,
      )}
    />
  );
});

export const Pill = forwardRef<HTMLElement, ActionProps>(function Pill({ className, ...props }, ref) {
  return (
    <Action
      ref={ref}
      {...props}
      className={cn(
        "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-ground px-4 font-semibold text-ink no-underline transition-colors hover:border-line-strong aria-expanded:border-line-strong",
        className,
      )}
    />
  );
});

export type IconButtonProps = Omit<ActionProps, "aria-label"> & {
  /** The accessible name. Required: the control shows only an icon. */
  label: string;
};

export const IconButton = forwardRef<HTMLElement, IconButtonProps>(function IconButton(
  { label, className, ...props },
  ref,
) {
  return (
    <Action
      ref={ref}
      {...props}
      aria-label={label}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-ground text-ink no-underline transition-colors hover:border-line-strong disabled:pointer-events-none disabled:text-line-strong aria-disabled:pointer-events-none aria-disabled:text-line-strong",
        className,
      )}
    />
  );
});

/** Alias of IconButton for prev/next arrows (`href` + `disabled`). */
export const RoundLink = IconButton;
