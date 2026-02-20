/**
 * Strategy display metadata — icons, categories, explanations, visuals.
 * Used by the UI to explain each strategy.
 */

export interface StrategyMeta {
  id: string;
  category: "discretionary" | "systematic" | "arbitrage";
  risk: "low" | "medium" | "high";
  whenToUse: string;
  indicators: string[];
  /** Mini SVG path or visual description for the strategy shape */
  visual: "range" | "trend-up" | "trend-down" | "grid" | "oscillate" | "breakout" | "neutral";
  /** Take-profit % from entry (e.g. 0.02 = 2%). Used for chart target lines. */
  takeProfitPct?: number;
  /** Stop-loss % from entry (e.g. 0.01 = 1%). Used for chart target lines. */
  stopLossPct?: number;
}

export const strategyMeta: Record<string, StrategyMeta> = {
  manual: {
    id: "manual",
    category: "discretionary",
    risk: "medium",
    whenToUse: "When you have a conviction and want full control over entries and exits.",
    indicators: [],
    visual: "neutral",
  },
  dca: {
    id: "dca",
    category: "discretionary",
    risk: "low",
    whenToUse: "Accumulate over time regardless of price. Reduces timing risk.",
    indicators: [],
    visual: "trend-up",
  },
  trend: {
    id: "trend",
    category: "systematic",
    risk: "medium",
    whenToUse: "When price is trending. Buy breakouts, sell breakdowns.",
    indicators: ["EMA", "ADX", "MACD"],
    visual: "trend-up",
    takeProfitPct: 0.02,
    stopLossPct: 0.01,
  },
  grid: {
    id: "grid",
    category: "systematic",
    risk: "medium",
    whenToUse: "Range-bound markets. Place orders at fixed levels to capture oscillations.",
    indicators: ["ATR", "Bollinger Bands"],
    visual: "grid",
    takeProfitPct: 0.01,
    stopLossPct: 0.005,
  },
  "mean-reversion": {
    id: "mean-reversion",
    category: "systematic",
    risk: "medium",
    whenToUse: "Buy oversold (RSI < 30), sell overbought (RSI > 70). Price returns to mean.",
    indicators: ["RSI", "Bollinger Bands"],
    visual: "oscillate",
    takeProfitPct: 0.01,
    stopLossPct: 0.005,
  },
  momentum: {
    id: "momentum",
    category: "systematic",
    risk: "medium",
    whenToUse: "Ride the trend. Enter on EMA crossover or MACD histogram flip.",
    indicators: ["EMA", "MACD"],
    visual: "trend-up",
    takeProfitPct: 0.02,
    stopLossPct: 0.01,
  },
  breakout: {
    id: "breakout",
    category: "systematic",
    risk: "high",
    whenToUse: "When price breaks support/resistance. Often after Bollinger squeeze.",
    indicators: ["Bollinger Bands", "ATR", "Volume"],
    visual: "breakout",
    takeProfitPct: 0.03,
    stopLossPct: 0.015,
  },
  "funding-arb": {
    id: "funding-arb",
    category: "arbitrage",
    risk: "low",
    whenToUse: "When funding rate is extreme. Short perp + long spot to capture payments.",
    indicators: ["Funding Rate"],
    visual: "neutral",
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
  },
  scalping: {
    id: "scalping",
    category: "systematic",
    risk: "high",
    whenToUse: "Quick in/out on small moves. Tight stops, small targets, high frequency.",
    indicators: ["Order book", "ATR", "Volume"],
    visual: "oscillate",
    takeProfitPct: 0.005,
    stopLossPct: 0.003,
  },
};
