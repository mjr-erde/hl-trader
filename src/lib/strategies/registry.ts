import type { Strategy } from "./types";
import { manualStrategy } from "./manual";
import { dcaStrategy } from "./dca";
import { trendStrategy } from "./trend";
import { gridStrategy } from "./grid";
import { meanReversionStrategy } from "./mean-reversion";
import { momentumStrategy } from "./momentum";
import { breakoutStrategy } from "./breakout";
import { fundingArbStrategy } from "./funding-arb";
import { scalpingStrategy } from "./scalping";

export const strategies: Strategy[] = [
  manualStrategy,
  dcaStrategy,
  trendStrategy,
  gridStrategy,
  meanReversionStrategy,
  momentumStrategy,
  breakoutStrategy,
  fundingArbStrategy,
  scalpingStrategy,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find((s) => s.id === id);
}
