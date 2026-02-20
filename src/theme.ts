/**
 * Shared UI theme — single source for colors, spacing, typography.
 * Edit here to change the look across Dashboard, Live, and future pages.
 */

export const theme = {
  colors: {
    bg: {
      page: "transparent",
      card: "#0f172a",
      cardAlt: "#1e293b",
      rowHover: "#334155",
      error: "#7f1d1d",
    },
    border: "#334155",
    text: {
      primary: "#e2e8f0",
      secondary: "#94a3b8",
      muted: "#64748b",
      link: "#3b82f6",
    },
    pnl: {
      positive: "#22c55e",
      positiveBg: "#14532d",
      negative: "#ef4444",
      negativeBg: "#7f1d1d",
      neutral: "#94a3b8",
    },
    chart: {
      long: "#22c55e",
      short: "#ef4444",
      exit: "#f59e0b",
    },
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
  },
  radius: {
    sm: "4px",
    md: "6px",
    lg: "8px",
  },
  typography: {
    sectionTitle: { margin: "0 0 0.75rem", fontSize: "1rem" },
    label: { fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.25rem" },
    value: { fontSize: "0.9rem", color: "#e2e8f0" },
    pnlValue: { fontSize: "1.1rem", fontWeight: 600 },
  },
} as const;

export type Theme = typeof theme;
