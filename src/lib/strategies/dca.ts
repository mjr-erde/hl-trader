import type { Strategy } from "./types";

/**
 * DCA (Dollar-Cost Average) — tag for positions opened as part of
 * a periodic buy plan. No automated signals; user-driven entries.
 */
export const dcaStrategy: Strategy = {
  id: "dca",
  name: "DCA",
  description: "Dollar-cost average: periodic buys at fixed intervals",
  params: [],
  signal: (_ctx) => null,
};
