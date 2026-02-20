import type { Strategy } from "./types";

/**
 * Grid — place orders at regular price intervals to profit from
 * oscillations in range-bound markets.
 */
export const gridStrategy: Strategy = {
  id: "grid",
  name: "Grid",
  description: "Grid trading — buy low, sell high at fixed price levels",
  params: [],
  signal: (_ctx) => null,
};
