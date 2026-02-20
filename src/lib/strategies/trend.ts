import type { Strategy } from "./types";

/**
 * Trend — tag for positions opened on momentum/trend signals.
 * Placeholder for future automated trend-following logic.
 */
export const trendStrategy: Strategy = {
  id: "trend",
  name: "Trend",
  description: "Trend-following — buy breakouts, sell breakdowns",
  params: [],
  signal: (_ctx) => null,
};
