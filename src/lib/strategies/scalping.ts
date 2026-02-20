import type { Strategy } from "./types";

/**
 * Scalping — quick in/out trades on small price moves.
 * High frequency, tight stops, small profit targets.
 */
export const scalpingStrategy: Strategy = {
  id: "scalping",
  name: "Scalping",
  description: "Quick trades — small moves, tight stops, high frequency",
  params: [],
  signal: (_ctx) => null,
};
