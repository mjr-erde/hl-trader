import type { Strategy } from "./types";

/**
 * Momentum — follow MACD and EMA crossovers.
 * Buy when fast EMA crosses above slow; sell on death cross.
 */
export const momentumStrategy: Strategy = {
  id: "momentum",
  name: "Momentum",
  description: "MACD & EMA crossover — ride the trend",
  params: [],
  signal: (_ctx) => null,
};
