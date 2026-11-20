"use client";

/** The dropdown menu shell (competition switcher, account menu).
 *
 *  The trigger is a <button aria-haspopup="menu" aria-expanded>. Opening
 *  moves focus to the first item; ArrowDown/ArrowUp/Home/End move between
 *  items; Escape closes and returns focus to the trigger; Tab closes and lets
 *  focus move on; a click outside closes; choosing an item closes.
 *  Items are 44px+ rows with an optional muted note on the right.
 *
 *    <Menu
 *      label="Competition"
 *      trigger={<><CompetitionLogo competition="epl" size={22} />Premier League<ChevronDownIcon /></>}
 *      triggerClassName={PILL_CLASS}
 *    >
 *      <MenuItem href="/football/epl" meta="Matchweek 11" current>Premier League</MenuItem>
 *      <MenuItem onSelect={signOut}>Sign out</MenuItem>
 *    </Menu>
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const MenuContext = createContext<{ close: (restoreFocus?: boolean) => void } | null>(null);

/** The pill look for a menu trigger (same as <Pill>). */
export const PILL_CLASS =
  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-ground px-4 font-semibold text-ink transition-colors hover:border-line-strong aria-expanded:border-line-strong";

export function Menu({
  trigger,
  label,
  triggerClassName,
  menuClassName,
  align = "right",
  onOpenChange,
  children,
}: {
  /** Visible trigger content. */
  trigger: ReactNode;
  /** Accessible name of the trigger AND the menu (e.g. "Competition: Premier League"). */
  label: string;
  triggerClassName?: string;
  menuClassName?: string;
  align?: "left" | "right";
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpenState] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (restoreFocus = false) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, setOpen]);

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(at + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(at - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName ?? PILL_CLASS}
      >
        {trigger}
      </button>
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className={cn(
              "absolute top-[52px] z-[60] max-h-[calc(100dvh-96px)] min-w-[270px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[14px] border border-line bg-ground p-1.5 text-ink shadow-menu",
              align === "right" ? "right-0" : "left-0",
              // Phones: pin under the header across the screen, so a trigger
              // that is not at the edge cannot push the menu off-screen.
              "max-sm:fixed max-sm:inset-x-4 max-sm:top-[68px] max-sm:min-w-0 max-sm:max-w-none",
              menuClassName,
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

const ITEM =
  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[10px] border-0 bg-transparent px-3 py-2.5 text-left font-medium text-ink no-underline hover:bg-soft focus-visible:bg-soft";

export function MenuItem({
  href,
  onSelect,
  meta,
  current,
  tone,
  keepOpen,
  children,
  className,
}: {
  href?: string;
  onSelect?: () => void;
  /** Muted 13px note on the right (e.g. "Matchweek 11"). */
  meta?: ReactNode;
  /** Marks the current entry (aria-current + a check-free bold weight). */
  current?: boolean;
  /** "danger" paints the label in miss (Delete account). */
  tone?: "danger";
  /** Leave the menu open after choosing (an action that may fail in place). */
  keepOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(MenuContext);
  const choose = () => {
    onSelect?.();
    if (!keepOpen) ctx?.close(false);
  };
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-3">{children}</span>
      {meta != null && <small className="whitespace-nowrap text-label font-normal text-muted">{meta}</small>}
    </>
  );
  const cls = cn(ITEM, current && "font-semibold", tone === "danger" && "text-miss", className);
  return href !== undefined ? (
    <Link href={href} role="menuitem" aria-current={current ? "page" : undefined} onClick={choose} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" role="menuitem" onClick={choose} className={cls}>
      {body}
    </button>
  );
}

/** A non-interactive heading/label inside a menu (e.g. "Past tournaments"). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-1 pt-2.5 text-label font-medium text-muted">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 border-t border-line-soft" />;
}
