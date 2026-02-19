import type { Strategy } from "./types";

/**
 * Manual strategy — no signal logic; user-driven only.
 * Used when opening positions without an automated strategy.
 */
export const manualStrategy: Strategy = {
  id: "manual",
  name: "Manual",
  description: "Manual entries — you decide when to buy or sell",
  params: [],
  signal: (_ctx) => null,
};
