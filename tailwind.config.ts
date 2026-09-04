import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0F1B17",          // near-black with a green cast — sidebar/base
        panel: "#F6F3EC",        // warm paper — chat surface
        moss: "#1F5B3F",         // deep signal green — primary actions, sent bubbles
        moss2: "#2E7A54",
        sprout: "#8FBF9A",       // pale green — subtle accents, active states
        clay: "#C7723B",         // human-mode / handoff accent
        wire: "#D8D2C2",         // hairline borders on warm surfaces
        wireDark: "#20302A",     // hairline borders on ink surfaces
        ash: "#6B7570",          // secondary text
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"],
      },
      borderRadius: {
        bubble: "1rem",
      },
    },
  },
  plugins: [],
};
export default config;
