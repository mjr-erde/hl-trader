import type { Strategy } from "./types";

/**
 * Funding Arb — capture funding payments when rates are extreme.
 * Short perp + long spot when funding is positive (longs pay shorts).
 */
export const fundingArbStrategy: Strategy = {
  id: "funding-arb",
  name: "Funding Arb",
  description: "Capture funding payments — short perp when longs pay shorts",
  params: [],
  signal: (_ctx) => null,
};
