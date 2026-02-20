import type { Strategy } from "./types";

/**
 * Breakout — enter when price breaks above resistance or below support.
 * Often uses Bollinger Band squeeze or range breakouts.
 */
export const breakoutStrategy: Strategy = {
  id: "breakout",
  name: "Breakout",
  description: "Trade range breakouts — support/resistance levels",
  params: [],
  signal: (_ctx) => null,
};
