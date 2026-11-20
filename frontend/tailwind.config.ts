import type { Config } from "tailwindcss";

// Direction G, the site's only theme. See app/globals.css and the hand-off
// note for which names to use: new code uses the G names (`ground`, `ink`,
// `muted`, `line`, `line-soft`, `soft`, `brand`, `brand-soft`, `miss`,
// `miss-soft` and the supporting neutrals). The legacy HSL-channel names
// below them still work and resolve to G values, but are discouraged.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- Direction G (literal hex so `/alpha` modifiers work) ----
        ground: "#ffffff",
        ink: "#14181f",
        muted: "#5b6470",
        line: "#e4e7e3",
        "line-soft": "#eef0ec",
        "line-strong": "#c3c8c1", // hover border, input border
        soft: "#f6f7f5",
        chip: "#f2f4f1", // segmented track, neutral chip, kick-off box
        brand: "#0f4d3a",
        "brand-hover": "#0b3d2e",
        "brand-soft": "#e7f0ec",
        miss: "#8a3324",
        "miss-soft": "#f6ebe8",
        disabled: "#c9cfc8", // disabled button fill
        placeholder: "#b3b9b1", // empty score numeral
        dash: "#9aa1a9", // the dash between scores
        europa: "#8fb3a5", // second table-zone marker

        // ---- Legacy names, re-pointed at G (discouraged in new code) ----
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        foreground: "hsl(var(--foreground))",
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
        // Both point at Instrument Sans (app/layout.tsx).
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // ---- Direction G steps (use these in new code) ----
        h1: ["48px", { lineHeight: "1.05", letterSpacing: "-0.025em", fontWeight: "600" }], // page title (≥900px)
        "h1-sm": ["36px", { lineHeight: "1.08", letterSpacing: "-0.025em", fontWeight: "600" }], // page title (<900px)
        h2: ["19px", { lineHeight: "1.35", fontWeight: "600" }], // card heading
        notes: ["15px", { lineHeight: "1.45" }], // notes, eyebrows, day bands
        table: ["15px", { lineHeight: "1.4" }], // table cells
        stat: ["52px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "600" }], // stat numerals

        // Tailwind's own smallest step, raised to the 13px floor.
        xs: ["13px", { lineHeight: "18px" }],

        // ---- Legacy scale. The sub-13px steps are raised to the 13px floor
        // (direction G: nothing real below 13px), body/lead/sub move up one. ----
        "display-hero": "var(--text-display-hero)",
        rank: "var(--text-rank)",
        micro: "13px",
        mini: "13px",
        note: "13px",
        label: "13px", // also the G "smallest label" step
        meta: "13px",
        body: "15px",
        lead: "17px",
        sub: "19px",
        numeral: "25px",
        headline: "30px",
        "score-sm": "40px",
        score: "44px",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
        card: "16px",
        dialog: "20px",
        input: "12px",
      },
      maxWidth: {
        prose: "65ch",
        frame: "1360px",
      },
      opacity: {
        disabled: "var(--disabled-opacity)",
        "disabled-40": "var(--disabled-opacity-40)",
      },
      boxShadow: {
        menu: "0 12px 32px rgba(20, 24, 31, 0.12)",
        dialog: "0 24px 64px rgba(20, 24, 31, 0.25)",
        seg: "0 1px 2px rgba(20, 24, 31, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
