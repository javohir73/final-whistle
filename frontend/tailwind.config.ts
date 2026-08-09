import type { Config } from "tailwindcss";

// "Daylight" light design system. Color tokens are CSS variables (see globals.css).
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        win: "hsl(var(--win))",
        draw: "hsl(var(--draw))",
        loss: "hsl(var(--loss))",
        gold: "hsl(var(--gold))",
        accent: "hsl(var(--accent))",
        "lime-deep": "hsl(var(--lime-deep))",
        "amber-ink": "hsl(var(--amber-ink))",
        "action-ink": "hsl(var(--action-ink))",
        "draw-ink": "hsl(var(--draw-ink))",
        "loss-ink": "hsl(var(--loss-ink))",
        "lime-deep-ink": "hsl(var(--lime-deep-ink))",
        "origin-disclaimer": "hsl(var(--origin-disclaimer))",
        "gold-ink": "hsl(var(--gold-ink))",
        "muted-solid": "hsl(var(--muted-solid))",
        "hint-ink": "hsl(var(--hint-ink))",
        "loss-wash-ink": "hsl(var(--loss-wash-ink))",
        "gold-wash-ink": "hsl(var(--gold-wash-ink))",
        "accent-nrl-ink": "hsl(var(--accent-nrl-ink))",
        "pitch-accent-ink": "hsl(var(--pitch-accent-ink))",
        "pitch-loss-ink": "hsl(var(--pitch-loss-ink))",
        "pitch-foreground-ink": "hsl(var(--pitch-foreground-ink))",
        "pitch-muted-ink": "hsl(var(--pitch-muted-ink))",
        "pitch-subtle-ink": "hsl(var(--pitch-subtle-ink))",
        "pitch-chip": "hsl(var(--pitch-chip))",
        pitch: "hsl(var(--pitch))",
        "pitch-copy": "var(--pitch-copy)",
        "feature-chart-ink": "var(--feature-chart-ink)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Floodlight (P1): display scale utility access; the .text-display-hero
        // / .text-rank component classes in globals.css already cover most consumers.
        "display-hero": "var(--text-display-hero)",
        rank: "var(--text-rank)",

        // ---- The type scale (2026-08-07) ----
        // Replaces ~225 arbitrary `text-[Npx]` literals that were scattered
        // across 79 files with names that say what the text IS. Sizes are the
        // ones already shipping, so this is a rename, not a redesign — every
        // value below is the exact px the components already rendered.
        //
        // Three half-pixel sizes (8.5/9.5/12.5) did NOT survive: they were
        // one-off nudges, not steps in a scale, and are folded into their
        // nearest whole step (4 elements move by half a pixel).
        //
        // Tailwind's own text-xs/sm/base still exist; this scale covers the
        // sub-14px range the design uses and Tailwind's default does not.
        micro: "8px", //   badge overlines, crest captions
        mini: "9px", //    dense table furniture
        note: "10px", //   secondary labels, chips
        label: "11px", //  THE workhorse — uppercase labels, meta rows
        meta: "12px", //   inline secondary copy
        body: "13px", //   readable body in dense cards
        lead: "15px", //   card lead-ins
        sub: "17px", //    sub-headings, team names in heroes
        // Display numerals — big, tabular, never body copy.
        numeral: "25px", //   scoreboard
        headline: "30px", //  feature hero
        "score-sm": "40px", // scorebug, pre-kickoff
        score: "44px", //     scorebug, live and full time
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      opacity: {
        disabled: "var(--disabled-opacity)",
        "disabled-40": "var(--disabled-opacity-40)",
      },
    },
  },
  plugins: [],
};

export default config;
