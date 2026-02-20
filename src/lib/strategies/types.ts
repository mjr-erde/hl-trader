/**
 * Strategy types — modular strategy interface.
 * See knowledge/crypto-trading-strategies.md for indicator formulas.
 */

export interface OHLCV {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface Position {
  id: string;
  coin: string;
  side: "long" | "short";
  entryPrice: number;
  size: number;
  strategyId: string;
  openedAt: number;
  leverage?: number;
  comment?: string;
}

export interface StrategyParam {
  key: string;
  label: string;
  type: "number" | "select";
  default: number | string;
  options?: { value: number; label: string }[];
}

export interface Signal {
  action: "long" | "short" | "close";
  strength?: number;
  reason?: string;
}

export interface SignalContext {
  candles: OHLCV[];
  indicators: Record<string, number[]>;
  currentPrice: number;
  openPositions: Position[];
}

export interface RecommendContext {
  positions: Position[];
  currentPrices: Record<string, number>;
  strategyPerformance: Record<string, { pnl: number; winRate: number }>;
}

export interface Recommendation {
  strategyId: string;
  positionId?: string;
  message: string;
  action?: "add_stop" | "reduce" | "close";
}

export interface Strategy {
  id: string;
  name: string;
  description?: string;
  params: StrategyParam[];
  signal: (ctx: SignalContext) => Signal | null;
  recommend?: (ctx: RecommendContext) => Recommendation[];
}
