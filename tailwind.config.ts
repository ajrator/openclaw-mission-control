import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#6366f1",
          hover: "#4f46e5",
          light: "#e0e7ff",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f8fafc",
        },
        /* Cleopatra-style semantic tokens (light/dark via Tailwind dark:) */
        background: {
          DEFAULT: "#f8fafc",
          dark: "#0f172a",
        },
        foreground: {
          DEFAULT: "#0f172a",
          dark: "#f1f5f9",
        },
        card: {
          DEFAULT: "#ffffff",
          dark: "#1e293b",
        },
        "card-foreground": {
          DEFAULT: "#0f172a",
          dark: "#f1f5f9",
        },
        muted: {
          DEFAULT: "#f1f5f9",
          dark: "#334155",
        },
        "muted-foreground": {
          DEFAULT: "#64748b",
          dark: "#94a3b8",
        },
        accent: {
          DEFAULT: "#f1f5f9",
          dark: "#334155",
        },
        "accent-foreground": {
          DEFAULT: "#0f172a",
          dark: "#f1f5f9",
        },
        border: {
          DEFAULT: "#e2e8f0",
          dark: "#475569",
        },
        destructive: "#dc2626",
        danger: "#dc2626",
        warning: "#ea580c",
        success: "#22c55e",
        /* Cleopatra-style: info (soft blue) for neutral actions */
        info: "#0ea5e9",
      },
      width: {
        sidebar: "240px",
        "sidebar-collapsed": "64px",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "card-hover": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      },
      borderRadius: {
        "cleo": "0.375rem",
        "cleo-lg": "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
