import type { Config } from "tailwindcss"
import typography from "@tailwindcss/typography"

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "var(--bg-base)",
        elevated: "var(--bg-elevated)",
        teal: "var(--accent-teal)",
        sky: "var(--accent-sky)",
        primary: "var(--text-primary)",
        muted: "var(--text-muted)",

        "sev-critical": "var(--sev-critical)",
        "sev-high": "var(--sev-high)",
        "sev-medium": "var(--sev-medium)",
        "sev-low": "var(--sev-low)",
        "sev-info": "var(--sev-info)",

        "grade-a": "var(--grade-a)",
        "grade-b": "var(--grade-b)",
        "grade-c": "var(--grade-c)",
        "grade-d": "var(--grade-d)",
        "grade-f": "var(--grade-f)",

        // Plan 04 Sonar palette (spec §1). --sonar is the brand primary;
        // --accent-teal above is legacy/transitional.
        abyss: "var(--abyss)",
        deep: "var(--deep)",
        sonar: "var(--sonar)",
        "sonar-d": "var(--sonar-d)",
        "sonar-muted": "var(--sonar-muted)",
        amber: "var(--amber)",
        red: "var(--red)",
        foam: "var(--foam)",
      },
      backgroundImage: {
        "storm-gradient": "var(--bg-gradient)",
      },
      backdropBlur: {
        "glass": "12px",
      },
      borderColor: {
        "subtle": "var(--border-subtle)",
        "teal-glow": "var(--border-teal)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
        // Plan 04 Sonar typography: Chakra Petch (display/headings) +
        // IBM Plex Mono (labels, data, technical chrome).
        display: ["var(--font-chakra-petch)", "system-ui", "sans-serif"],
        data: ["var(--font-ibm-plex-mono)", "monospace"],
      },
      keyframes: {
        // Sonar sweep rotation (spec §1: ~4.5s controlled rotation).
        sweep: {
          to: { transform: "rotate(360deg)" },
        },
        // Blip pulse ring expanding out from a node.
        blip: {
          "0%": { transform: "scale(0.6)", opacity: "0.5" },
          "100%": { transform: "scale(2)", opacity: "0" },
        },
        // Shore-water tide drift (200%-wide wave layer loops seamlessly).
        tide: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        sweep: "sweep 4.5s linear infinite",
        blip: "blip 3s ease-out infinite",
        // Two tide speeds, the fast one reversed — matches the mockup's
        // s1 (17s) / s2 (11s reverse) layered waves.
        "tide-slow": "tide 17s linear infinite",
        "tide-fast": "tide 11s linear infinite reverse",
      },
    },
  },
  plugins: [typography],
}

export default config
