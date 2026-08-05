import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Data-dense, legibility-first. System stack; no display fonts.
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        // Neutral, clarity-first palette (per brief §6 design note).
        canvas: "#0b0e14",
        panel: "#141922",
        edge: "#232a36",
        ink: "#e6eaf0",
        muted: "#8a94a6",
        accent: "#4c8dff",
        good: "#3fb950",
        warn: "#d29922",
        bad: "#f85149",
      },
    },
  },
  plugins: [],
};

export default config;
