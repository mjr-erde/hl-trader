/**
 * Backtesting engine — replays historical candles through trading rules.
 * Validates entry/exit rules against past data before live trading.
 */

import { rsi, macd, bollingerBands, atr, adx, detectRegime } from "./indicators";
import { realizedPnl } from "./pnl";

export interface BacktestConfig {
  coin: string;
  candles: { t: number; o: number; h: number; l: number; c: number }[];
  capital: number;
  positionSize: number; // notional $ per trade
}

interface VirtualPosition {
  side: "long" | "short";
  entryPrice: number;
  size: number;
  rule: string;
  entryBar: number;
  peakPnl: number; // for trailing stop tracking
}

export interface BacktestTrade {
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  size: number;
  rule: string;
  exitReason: string;
  pnl: number;
  holdingBars: number;
}

export interface BacktestResult {
  coin: string;
  bars: number;
  trades: BacktestTrade[];
  totalPnl: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpe: number;
  byRule: Record<string, { trades: number; pnl: number; winRate: number }>;
}

function computeIndicators(closes: number[], highs: number[], lows: number[]) {
  if (closes.length < 50) return null;
  const rsiVal = rsi(closes, 14);
  const macdVal = macd(closes);
  const bb = bollingerBands(closes, 20, 2);
  const atrVal = atr(highs, lows, closes, 14);
  const adxVal = adx(highs, lows, closes, 14);
  const regime = detectRegime(adxVal.adx, bb.width);
  return { rsi: rsiVal, macd: macdVal, bb, atr: atrVal, adx: adxVal, regime };
}

function checkEntryRules(ind: NonNullable<ReturnType<typeof computeIndicators>>, price: number) {
  const signals: { side: "long" | "short"; rule: string }[] = [];

  // RULE 1: RSI Oversold Bounce (long)
  if (ind.rsi < 30 && ind.regime !== "trending" && ind.regime !== "volatile_trend") {
    signals.push({ side: "long", rule: "R1-mean-reversion" });
  }

  // RULE 2: RSI Overbought Fade (short)
  if (ind.rsi > 70 && ind.regime !== "trending" && ind.regime !== "volatile_trend") {
    signals.push({ side: "short", rule: "R2-mean-reversion" });
  }

  // RULE 3: Trend Follow Long
  if (ind.adx.adx > 25 && ind.adx.plusDI > ind.adx.minusDI && ind.rsi > 50 && ind.macd.histogram > 0) {
    signals.push({ side: "long", rule: "R3-trend" });
  }

  // RULE 4: Trend Follow Short
  if (ind.adx.adx > 25 && ind.adx.minusDI > ind.adx.plusDI && ind.rsi < 50 && ind.macd.histogram < 0) {
    signals.push({ side: "short", rule: "R4-trend" });
  }

  // RULE 5: Bollinger Squeeze Breakout (simplified — just check width expansion + price outside bands)
  if (ind.bb.width > 0.015) {
    if (price > ind.bb.upper) signals.push({ side: "long", rule: "R5-breakout" });
    if (price < ind.bb.lower) signals.push({ side: "short", rule: "R5-breakout" });
  }

  return signals;
}

function checkExitRules(
  pos: VirtualPosition,
  price: number,
  ind: NonNullable<ReturnType<typeof computeIndicators>>,
  barsSinceEntry: number
): string | null {
  const notional = pos.size * pos.entryPrice;
  const pnl = pos.side === "long" ? pos.size * (price - pos.entryPrice) : pos.size * (pos.entryPrice - price);
  const pnlPct = pnl / notional;

  // EXIT 1: Take Profit (1.5%)
  if (pnlPct > 0.015) return "take-profit";

  // EXIT 2: Stop Loss (2%)
  if (pnlPct < -0.02) return "stop-loss";

  // EXIT 3: Trailing stop — if PnL was > +0.8% and dropped back to +0.3%
  if (pos.peakPnl / notional > 0.008 && pnlPct < 0.003) return "trailing-stop";

  // EXIT 4: Signal reversal
  if (pos.rule.includes("trend")) {
    if (ind.adx.adx < 20) return "adx-collapse";
    if (pos.side === "long" && ind.adx.minusDI > ind.adx.plusDI) return "di-flip";
    if (pos.side === "short" && ind.adx.plusDI > ind.adx.minusDI) return "di-flip";
  }
  if (pos.side === "long" && ind.rsi > 70) return "rsi-overbought";
  if (pos.side === "short" && ind.rsi < 30) return "rsi-oversold";

  // EXIT 5: Time stop (stale trade)
  if (barsSinceEntry > 48 && Math.abs(pnlPct) < 0.005) return "time-stop";

  return null;
}

export function backtest(config: BacktestConfig): BacktestResult {
  const { coin, candles, capital, positionSize } = config;
  const trades: BacktestTrade[] = [];
  let position: VirtualPosition | null = null;
  const equityCurve: number[] = [];
  let equity = capital;

  for (let i = 50; i < candles.length; i++) {
    const closes = candles.slice(0, i + 1).map((c) => c.c);
    const highs = candles.slice(0, i + 1).map((c) => c.h);
    const lows = candles.slice(0, i + 1).map((c) => c.l);
    const price = closes[closes.length - 1];

    const ind = computeIndicators(closes, highs, lows);
    if (!ind) continue;

    // Check exits first
    if (position) {
      const pnl = position.side === "long"
        ? position.size * (price - position.entryPrice)
        : position.size * (position.entryPrice - price);
      if (pnl > position.peakPnl) position.peakPnl = pnl;

      const exitReason = checkExitRules(position, price, ind, i - position.entryBar);
      if (exitReason) {
        const tradePnl = realizedPnl(position.side, position.entryPrice, price, position.size);
        trades.push({
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice: price,
          size: position.size,
          rule: position.rule,
          exitReason,
          pnl: tradePnl,
          holdingBars: i - position.entryBar,
        });
        equity += tradePnl;
        position = null;
      }
    }

    // Check entries (only if no position)
    if (!position) {
      const signals = checkEntryRules(ind, price);
      if (signals.length > 0) {
        const sig = signals[0]; // take first signal
        const size = positionSize / price;
        position = {
          side: sig.side,
          entryPrice: price,
          size,
          rule: sig.rule,
          entryBar: i,
          peakPnl: 0,
        };
      }
    }

    equityCurve.push(equity);
  }

  // Close any remaining position at last price
  if (position) {
    const price = candles[candles.length - 1].c;
    const tradePnl = realizedPnl(position.side, position.entryPrice, price, position.size);
    trades.push({
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: price,
      size: position.size,
      rule: position.rule,
      exitReason: "end-of-data",
      pnl: tradePnl,
      holdingBars: candles.length - 1 - position.entryBar,
    });
    equity += tradePnl;
    equityCurve.push(equity);
  }

  // Compute stats
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const winSum = wins.reduce((s, t) => s + t.pnl, 0);
  const lossSum = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);

  // Max drawdown
  let peak = capital;
  let maxDd = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Sharpe (annualized from bar returns)
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(365 * 24) : 0; // annualized assuming 1h bars

  // By rule breakdown
  const byRule: Record<string, { trades: number; pnl: number; winRate: number }> = {};
  for (const t of trades) {
    if (!byRule[t.rule]) byRule[t.rule] = { trades: 0, pnl: 0, winRate: 0 };
    byRule[t.rule].trades++;
    byRule[t.rule].pnl += t.pnl;
  }
  for (const rule of Object.keys(byRule)) {
    const ruleTrades = trades.filter((t) => t.rule === rule);
    const ruleWins = ruleTrades.filter((t) => t.pnl > 0);
    byRule[rule].winRate = ruleTrades.length > 0 ? ruleWins.length / ruleTrades.length : 0;
    byRule[rule].pnl = Math.round(byRule[rule].pnl * 100) / 100;
  }

  return {
    coin,
    bars: candles.length,
    trades,
    totalPnl: Math.round(totalPnl * 100) / 100,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    avgWin: wins.length > 0 ? Math.round((winSum / wins.length) * 100) / 100 : 0,
    avgLoss: losses.length > 0 ? Math.round((lossSum / losses.length) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : Infinity,
    maxDrawdown: Math.round(maxDd * 10000) / 100, // as percentage
    sharpe: Math.round(sharpe * 100) / 100,
    byRule,
  };
}
