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
      },
    },
  },
  plugins: [typography],
}

export default config
