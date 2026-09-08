import type { Config } from "tailwindcss";

// `brand` is the ORIGINAL Step-1 placeholder palette. It is left untouched
// and still powers every screen that hasn't been rebuilt to the final
// design system yet (Steps 1–9's customer/measurement/order pages) — each
// of those gets retired to the tokens below in its own dedicated future
// step, not touched wholesale here.
//
// Step 10 — the FINAL Sui Dhaga design-system palette, taken verbatim from
// the design brief (sui-dhaga-design-brief.md §2) and the authoritative
// UI mockup. New UI (starting with the persistent header) uses these
// tokens directly by name — ink / indigo / paper / card / rule / graphite
// / amber — not `brand`.
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#7A2E2E",
          50: "#FBF3F3",
          100: "#F3E0E0",
          200: "#E4B9B9",
          300: "#D19191",
          400: "#B85F5F",
          500: "#7A2E2E",
          600: "#682626",
          700: "#551F1F",
          800: "#421818",
          900: "#301111",
        },
        neutral: {
          25: "#FCFCFC",
        },

        // Headings, labels, print ink — from the order pad's printed red.
        ink: "#7B241C",
        // Primary actions, active nav/interaction states — from the cloth
        // wrap. `hover` is a hand-picked ~15% darker shade for hover/press
        // states; there is no full numbered scale because the brief only
        // specifies these two.
        indigo: {
          DEFAULT: "#1F3A63",
          hover: "#17304F",
        },
        // Page background — slightly warm, like newsprint.
        paper: "#FBF7F0",
        // Input/card surfaces.
        card: "#FFFFFF",
        // Hairlines, table dividers.
        rule: "#D8CFC2",
        // Body text and, critically, all numerals.
        graphite: "#2B2724",
        // Reserved for attention states only (overdue, changed values,
        // outstanding balance) — never a routine "in progress" color.
        amber: {
          DEFAULT: "#C87A0E",
        },
        // Step 46 (Step 44 redesign plan §8) — the one deliberately added
        // token: a restrained, muted green for genuinely positive/
        // completed states (Ready orders, the Dashboard's own status
        // reads). Picked to sit in the same low-saturation, "heritage"
        // family as the rest of the palette, not a bright/marketing
        // green — used sparingly, never as a second primary color.
        success: {
          DEFAULT: "#3F7A56",
        },
      },
      fontFamily: {
        // English UI — IBM Plex Sans replaces the old (never actually
        // loaded) "Inter" reference.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        // Urdu measurement labels on screen.
        naskh: ["var(--font-naskh)", "serif"],
        // Print headings and the shop name / brand mark.
        nastaliq: ["var(--font-nastaliq)", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
