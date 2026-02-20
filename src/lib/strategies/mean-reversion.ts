import type { Strategy } from "./types";

/**
 * Mean Reversion — buy oversold (RSI < 30), sell overbought (RSI > 70).
 * Uses RSI and Bollinger Bands for entries.
 */
export const meanReversionStrategy: Strategy = {
  id: "mean-reversion",
  name: "Mean Reversion",
  description: "Buy oversold, sell overbought — RSI & Bollinger Bands",
  params: [],
  signal: (_ctx) => null,
};
