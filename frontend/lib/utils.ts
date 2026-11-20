import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** The named steps of our type scale (tailwind.config.ts `fontSize`).
 *  tailwind-merge only knows Tailwind's OWN font-size names, so a custom one
 *  like `text-label` looks to it like a *colour* — and `cn("text-label",
 *  "text-lime-deep")` silently dropped the size, leaving elements with no
 *  font-size class at all. Declaring them here is what keeps size and colour
 *  in separate merge groups. Keep in sync with tailwind.config.ts. */
const TYPE_SCALE = [
  "micro", "mini", "note", "label", "meta", "body", "lead", "sub",
  "numeral", "headline", "score-sm", "score", "display-hero", "rank",
  // Direction G steps.
  "h1", "h1-sm", "h2", "notes", "table", "stat",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
    },
  },
});

/** Merge Tailwind class names (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
