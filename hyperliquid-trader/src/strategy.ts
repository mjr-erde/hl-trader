/**
 * Strategy signal computation for the automated trading agent.
 * Uses the same R1-R5 entry rules and EXIT 1-5 exit rules as the paper trading system.
 */

import { getCandles, type Candle } from "./candles.js";
import {
  rsi,
  macd,
  bollingerBands,
  atr,
  adx,
  detectRegime,
} from "../../src/lib/indicators.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IndicatorSnapshot {
  coin: string;
  interval: string;
  price: number;
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  bb: { upper: number; middle: number; lower: number; width: number };
  atr: number;
  adx: { adx: number; plusDI: number; minusDI: number };
  regime: string;
}

export interface Signal {
  coin: string;
  side: "long" | "short";
  rule: string;       // e.g. "R3-trend", "R4-trend"
  strategy: string;   // e.g. "trend", "mean-reversion", "breakout"
  confidence: number; // 0–1
  reason: string;
}

export interface ExitSignal {
  rule: string;       // e.g. "EXIT-1-trailing", "EXIT-2-stoploss"
  reason: string;
}

export interface NearMiss {
  coin: string;
  side: "long" | "short";
  rule: string;
  price: number;
  timestamp: number;
  reason: string;           // why it almost triggered
  blockedBy: string;        // which condition failed
  indicators: {
    adx: number; plusDI: number; minusDI: number;
    rsi: number; macdHist: number; regime: string; bbWidth: number;
  };
}

export interface AgentState {
  peakPnl: Map<string, number>;
  squeezeForming: Map<string, boolean>;
  entryTimes: Map<string, number>;
}

// ── Indicator Computation ────────────────────────────────────────────────────

export async function computeIndicators(
  coin: string,
  interval: string,
  testnet = false
): Promise<IndicatorSnapshot | null> {
  const now = Date.now();
  // Fetch 200 candles worth of history
  const intervalMs =
    interval === "1h" ? 3600_000 : interval === "15m" ? 900_000 : 3600_000;
  const startTime = now - 200 * intervalMs;

  const candles = await getCandles(coin, interval, startTime, now, testnet);
  if (candles.length < 50) return null;

  const closes = candles.map((c: Candle) => parseFloat(c.c));
  const highs = candles.map((c: Candle) => parseFloat(c.h));
  const lows = candles.map((c: Candle) => parseFloat(c.l));
  const price = closes[closes.length - 1];

  const rsiVal = rsi(closes, 14);
  const macdVal = macd(closes);
  const bbVal = bollingerBands(closes, 20, 2);
  const atrVal = atr(highs, lows, closes, 14);
  const adxVal = adx(highs, lows, closes, 14);
  const regime = detectRegime(adxVal.adx, bbVal.width);

  return {
    coin,
    interval,
    price,
    rsi: rsiVal,
    macd: macdVal,
    bb: bbVal,
    atr: atrVal,
    adx: adxVal,
    regime,
  };
}

// ── Entry Signal Evaluation ──────────────────────────────────────────────────

export function evaluateEntrySignals(
  ind1h: IndicatorSnapshot,
  ind15m: IndicatorSnapshot | null,
  coin: string,
  state: AgentState,
): Signal | null {
  const signals: Signal[] = [];
  const regime = ind1h.regime;

  // R1: RSI Oversold Bounce (long) — quiet/ranging regimes only
  if (
    (regime === "quiet" || regime === "ranging") &&
    ind1h.rsi < 30
  ) {
    let confidence = 0.6;
    // 15m timing boost: if 15m RSI is also oversold or recovering
    if (ind15m && ind15m.rsi < 35) confidence += 0.1;
    signals.push({
      coin,
      side: "long",
      rule: "R1-mean-reversion",
      strategy: "mean-reversion",
      confidence,
      reason: `RSI ${ind1h.rsi.toFixed(1)}, regime ${regime}`,
    });
  }

  // R2: RSI Overbought Fade (short) — quiet/ranging regimes only
  if (
    (regime === "quiet" || regime === "ranging") &&
    ind1h.rsi > 70
  ) {
    let confidence = 0.6;
    if (ind15m && ind15m.rsi > 65) confidence += 0.1;
    signals.push({
      coin,
      side: "short",
      rule: "R2-mean-reversion",
      strategy: "mean-reversion",
      confidence,
      reason: `RSI ${ind1h.rsi.toFixed(1)}, regime ${regime}`,
    });
  }

  // R3: Trend Follow Long — trending/volatile_trend regimes
  // RSI threshold lowered from 50→45 based on near-miss data (64% of skips were wrong)
  if (
    (regime === "trending" || regime === "volatile_trend") &&
    ind1h.adx.adx > 25 &&
    ind1h.adx.plusDI > ind1h.adx.minusDI &&
    ind1h.rsi > 45 &&
    ind1h.macd.histogram > 0
  ) {
    let confidence = 0.6; // reduced from 0.65 — R3-long has ~50% win rate
    const diSpread = ind1h.adx.plusDI - ind1h.adx.minusDI;
    if (diSpread > 10) confidence += 0.1;
    if (ind1h.adx.adx > 35) confidence += 0.05;
    // 15m timing: pullback entry is ideal
    if (ind15m && ind15m.rsi < 55 && ind15m.rsi > 40) confidence += 0.1;
    signals.push({
      coin,
      side: "long",
      rule: "R3-trend",
      strategy: "trend",
      confidence: Math.min(confidence, 1),
      reason: `ADX ${ind1h.adx.adx.toFixed(1)}, +DI ${ind1h.adx.plusDI.toFixed(1)} > -DI ${ind1h.adx.minusDI.toFixed(1)}, RSI ${ind1h.rsi.toFixed(1)}, MACD hist ${ind1h.macd.histogram.toFixed(4)}`,
    });
  }

  // R4: Trend Follow Short — trending/volatile_trend regimes
  // ADX threshold lowered from 25→22: near-miss data shows HYPE R4-shorts at ADX 20-24
  // consistently won +0.5-1.6%. Require DI spread > 8 at lower ADX for conviction.
  {
    const adxVal = ind1h.adx.adx;
    const diSpread = ind1h.adx.minusDI - ind1h.adx.plusDI;
    const adxOk = adxVal > 25 ||
      (adxVal > 22 && diSpread > 8); // relaxed ADX with DI spread confirmation
    const regimeOk = regime === "trending" || regime === "volatile_trend" ||
      (adxVal > 22 && adxVal <= 25); // allow transitional zone for R4 shorts

    if (
      regimeOk && adxOk &&
      ind1h.adx.minusDI > ind1h.adx.plusDI &&
      ind1h.rsi < 50
    ) {
      // Near-miss data (11/11 skipped R4 shorts were winners, +1.55% avg):
      // Relax MACD threshold to 0.05 — low-price coins (DOGE, SUI) have naturally near-zero MACD hist
      // Fallback: ADX > 35 + wide DI spread exempts fully (lowered from 40)
      const macdOk =
        ind1h.macd.histogram < 0.05 ||
        (adxVal > 35 && diSpread > 10);

      if (macdOk) {
        let confidence = 0.7; // R4 is the dominant winner per backtests
        if (diSpread > 10) confidence += 0.1;
        if (adxVal > 35) confidence += 0.05;
        if (adxVal <= 25) confidence -= 0.05; // slight discount for transitional ADX
        if (ind15m && ind15m.rsi > 45 && ind15m.rsi < 55) confidence += 0.05;
        signals.push({
          coin,
          side: "short",
          rule: "R4-trend",
          strategy: "trend",
          confidence: Math.min(confidence, 1),
          reason: `ADX ${adxVal.toFixed(1)}, -DI ${ind1h.adx.minusDI.toFixed(1)} > +DI ${ind1h.adx.plusDI.toFixed(1)} (spread ${diSpread.toFixed(1)}), RSI ${ind1h.rsi.toFixed(1)}, MACD hist ${ind1h.macd.histogram.toFixed(4)}`,
        });
      }
    }
  }

  // R5: Bollinger Squeeze Breakout — two-step detection
  // Step 1: detect squeeze forming (width < 0.01)
  if (ind1h.bb.width < 0.01) {
    state.squeezeForming.set(coin, true);
  }
  // Step 2: breakout confirmed (width > 0.015 after squeeze was forming)
  if (state.squeezeForming.get(coin) && ind1h.bb.width > 0.015) {
    state.squeezeForming.set(coin, false);
    if (ind1h.price > ind1h.bb.upper) {
      signals.push({
        coin,
        side: "long",
        rule: "R5-breakout",
        strategy: "breakout",
        confidence: 0.4, // below 0.5 threshold — effectively blocked per backtests
        reason: `Squeeze breakout UP, width ${ind1h.bb.width.toFixed(4)}, price ${ind1h.price} > upper ${ind1h.bb.upper.toFixed(2)}`,
      });
    } else if (ind1h.price < ind1h.bb.lower) {
      signals.push({
        coin,
        side: "short",
        rule: "R5-breakout",
        strategy: "breakout",
        confidence: 0.4,
        reason: `Squeeze breakout DOWN, width ${ind1h.bb.width.toFixed(4)}, price ${ind1h.price} < lower ${ind1h.bb.lower.toFixed(2)}`,
      });
    }
  }

  // Filter out low-confidence signals (blocks R5 which backtests poorly)
  const viable = signals.filter((s) => s.confidence >= 0.5);
  if (viable.length === 0) return null;

  // Return highest confidence signal
  viable.sort((a, b) => b.confidence - a.confidence);
  return viable[0];
}

// ── Exit Signal Evaluation ───────────────────────────────────────────────────

export function evaluateExitSignals(
  position: { coin: string; side: "long" | "short"; entryPx: number; szi: number; rule?: string },
  currentPrice: number,
  ind1h: IndicatorSnapshot,
  state: AgentState,
): ExitSignal | null {
  const { coin, side, entryPx, szi } = position;
  const notional = Math.abs(szi) * entryPx;
  const pnl =
    side === "long"
      ? Math.abs(szi) * (currentPrice - entryPx)
      : Math.abs(szi) * (entryPx - currentPrice);
  const pnlPct = notional > 0 ? pnl / notional : 0;

  // Track peak PnL for trailing stop
  const prevPeak = state.peakPnl.get(coin) ?? 0;
  if (pnl > prevPeak) state.peakPnl.set(coin, pnl);
  const peakPnlPct = notional > 0 ? (state.peakPnl.get(coin) ?? 0) / notional : 0;

  // Wider trailing stops to let winners run — previous arms were too tight,
  // closing at +0.26% avg while stoploss fires at -2% (10:1 loss:win ratio)
  const VOLATILE_COINS = new Set(["MOODENG", "TAO", "HYPE", "WIF", "POPCAT", "DOGE", "SUI"]);
  const isVolatile = VOLATILE_COINS.has(coin);
  const trailArm = isVolatile ? 0.02 : 0.012;      // +2.0% vs +1.2% to arm (was 1.5%/0.8%)
  const trailTrigger = isVolatile ? 0.008 : 0.005;  // +0.8% vs +0.5% to trigger (was 0.6%/0.3%)
  const takeProfitCap = isVolatile ? 0.05 : 0.03;   // +5% vs +3% cap (was 5%/2%)

  // EXIT 1: Trailing stop — peak crossed arm threshold, now dropped to trigger
  if (peakPnlPct > trailArm && pnlPct < trailTrigger) {
    return {
      rule: "EXIT-1-trailing",
      reason: `Trailing stop: peak ${(peakPnlPct * 100).toFixed(2)}%, now ${(pnlPct * 100).toFixed(2)}%${isVolatile ? " (volatile)" : ""}`,
    };
  }
  // EXIT 1b: Hard take-profit cap
  if (pnlPct > takeProfitCap) {
    return {
      rule: "EXIT-1-takeprofit",
      reason: `Take profit cap: ${(pnlPct * 100).toFixed(2)}% (limit ${(takeProfitCap * 100).toFixed(0)}%)`,
    };
  }

  // Extract entry rule for rule-specific exit thresholds
  const rule = position.rule ?? "";

  // EXIT 2: Stop loss — R3-long uses tighter -1.5% (weaker rule), R4/others use -2%
  const isR3Long = rule.includes("R3") && side === "long";
  const stopLossThreshold = isR3Long ? -0.015 : -0.02;
  if (pnlPct < stopLossThreshold) {
    return {
      rule: "EXIT-2-stoploss",
      reason: `Stop loss: ${(pnlPct * 100).toFixed(2)}%${isR3Long ? " (R3-long tighter stop)" : ""}`,
    };
  }

  // EXIT 3: Signal reversal (1h only)
  const isTrend = rule.includes("trend") || rule.includes("R3") || rule.includes("R4");
  if (isTrend) {
    if (ind1h.adx.adx < 20) {
      return {
        rule: "EXIT-3-adx-collapse",
        reason: `ADX collapsed to ${ind1h.adx.adx.toFixed(1)} (< 20)`,
      };
    }
    if (side === "long" && ind1h.adx.minusDI > ind1h.adx.plusDI) {
      return {
        rule: "EXIT-3-di-flip",
        reason: `DI flipped: -DI ${ind1h.adx.minusDI.toFixed(1)} > +DI ${ind1h.adx.plusDI.toFixed(1)}`,
      };
    }
    if (side === "short" && ind1h.adx.plusDI > ind1h.adx.minusDI) {
      return {
        rule: "EXIT-3-di-flip",
        reason: `DI flipped: +DI ${ind1h.adx.plusDI.toFixed(1)} > -DI ${ind1h.adx.minusDI.toFixed(1)}`,
      };
    }
  }
  // RSI extreme exits
  if (side === "long" && ind1h.rsi > 70) {
    return {
      rule: "EXIT-3-rsi-overbought",
      reason: `RSI overbought: ${ind1h.rsi.toFixed(1)}`,
    };
  }
  if (side === "short" && ind1h.rsi < 30) {
    return {
      rule: "EXIT-3-rsi-oversold",
      reason: `RSI oversold: ${ind1h.rsi.toFixed(1)}`,
    };
  }

  // EXIT 4: Time stop — open > 4h with flat PnL
  const entryTime = state.entryTimes.get(coin);
  if (entryTime) {
    const hoursOpen = (Date.now() - entryTime) / 3_600_000;
    if (hoursOpen > 4 && Math.abs(pnlPct) < 0.005) {
      return {
        rule: "EXIT-4-timestop",
        reason: `Time stop: ${hoursOpen.toFixed(1)}h open, PnL ${(pnlPct * 100).toFixed(2)}% (flat)`,
      };
    }
  }

  return null;
}

// ── Position Sizing ──────────────────────────────────────────────────────────

export function computePositionSize(
  availableBalance: number,
  signal: Signal,
  price: number,
  leverage: number,
  maxAllocPct: number,
  szDecimals: number,
): { size: number; notional: number } | null {
  // Scale factor by rule type
  let scaleFactor: number;
  if (signal.strategy === "contrarian") {
    scaleFactor = 0.4; // Contrarian: 40% of allocation (riskier fades)
  } else if (signal.strategy === "sentiment-confirmed") {
    scaleFactor = 0.3; // R6 sentiment-confirmed: 30% of allocation (less technical backing)
  } else if (signal.rule.includes("R4")) {
    scaleFactor = 1.0; // R4-short: best rule, full size
  } else if (signal.rule.includes("R3")) {
    scaleFactor = 0.7; // R3-long: ~50% win rate, reduced size to limit stoploss damage
  } else if (signal.rule.includes("R1") || signal.rule.includes("R2")) {
    scaleFactor = 0.6;
  } else {
    scaleFactor = 0.5; // R5 breakout
  }

  const margin = availableBalance * (maxAllocPct / 100) * scaleFactor;
  const notional = margin * leverage;

  // Minimum notional $10 check
  if (notional < 10) return null;

  const size = notional / price;
  const rounded = parseFloat(size.toFixed(szDecimals));
  if (rounded <= 0) return null;

  return { size: rounded, notional };
}

// ── Near-Miss Detection ──────────────────────────────────────────────────────

/** Detect trades that almost triggered but failed one or two conditions. */
export function detectNearMisses(ind1h: IndicatorSnapshot, coin: string): NearMiss[] {
  const misses: NearMiss[] = [];
  const { regime, adx: adxVal, rsi: rsiVal, macd: macdVal, bb, price } = ind1h;
  const base = {
    coin, price, timestamp: Date.now(),
    indicators: {
      adx: adxVal.adx, plusDI: adxVal.plusDI, minusDI: adxVal.minusDI,
      rsi: rsiVal, macdHist: macdVal.histogram, regime, bbWidth: bb.width,
    },
  };

  // Near-miss R3 long: trending + bullish DI but one condition fails
  if ((regime === "trending" || regime === "volatile_trend") && adxVal.adx > 20) {
    if (adxVal.plusDI > adxVal.minusDI) {
      const failedConditions: string[] = [];
      if (adxVal.adx <= 25) failedConditions.push(`ADX ${adxVal.adx.toFixed(1)} ≤ 25`);
      if (rsiVal <= 45) failedConditions.push(`RSI ${rsiVal.toFixed(1)} ≤ 45`);
      if (macdVal.histogram <= 0) failedConditions.push(`MACD hist ${macdVal.histogram.toFixed(4)} ≤ 0`);
      // Only near-miss if 1-2 conditions failed (close to triggering)
      if (failedConditions.length > 0 && failedConditions.length <= 2) {
        misses.push({ ...base, side: "long", rule: "R3-trend",
          reason: `Bullish DI in trending regime, almost R3`,
          blockedBy: failedConditions.join("; "),
        });
      }
    }
  }

  // Near-miss R4 short: trending + bearish DI but one condition fails
  // ADX threshold lowered to 22 for R4 (with DI spread > 8), so near-miss starts at 18
  if (adxVal.adx > 18 && adxVal.minusDI > adxVal.plusDI) {
    const diSpread = adxVal.minusDI - adxVal.plusDI;
    const failedConditions: string[] = [];
    if (adxVal.adx <= 22) failedConditions.push(`ADX ${adxVal.adx.toFixed(1)} ≤ 22`);
    else if (adxVal.adx <= 25 && diSpread <= 8) failedConditions.push(`ADX ${adxVal.adx.toFixed(1)} ≤ 25, DI spread ${diSpread.toFixed(1)} ≤ 8`);
    if (rsiVal >= 50) failedConditions.push(`RSI ${rsiVal.toFixed(1)} ≥ 50`);
    if (macdVal.histogram >= 0.05) failedConditions.push(`MACD hist ${macdVal.histogram.toFixed(4)} ≥ 0.05`);
    if (failedConditions.length > 0 && failedConditions.length <= 2) {
      misses.push({ ...base, side: "short", rule: "R4-trend",
        reason: `Bearish DI, almost R4 (DI spread ${diSpread.toFixed(1)})`,
        blockedBy: failedConditions.join("; "),
      });
    }
  }

  // Near-miss R1/R2: quiet regime with RSI approaching extremes (within 5 pts)
  if (regime === "quiet" || regime === "ranging") {
    if (rsiVal > 25 && rsiVal < 35) {
      misses.push({ ...base, side: "long", rule: "R1-mean-reversion",
        reason: `RSI ${rsiVal.toFixed(1)} approaching oversold (< 30)`,
        blockedBy: `RSI ${rsiVal.toFixed(1)} > 30`,
      });
    }
    if (rsiVal > 65 && rsiVal < 75) {
      misses.push({ ...base, side: "short", rule: "R2-mean-reversion",
        reason: `RSI ${rsiVal.toFixed(1)} approaching overbought (> 70)`,
        blockedBy: `RSI ${rsiVal.toFixed(1)} < 70`,
      });
    }
  }

  // Near-miss cross-regime: strong DI signal but wrong regime
  // R4 now triggers at ADX 22 (with DI spread > 8), so cross-regime near-miss for R4 is below 22
  if ((regime === "quiet" || regime === "ranging") && adxVal.adx > 18) {
    if (adxVal.minusDI > adxVal.plusDI && adxVal.minusDI - adxVal.plusDI > 5 && rsiVal < 50 && adxVal.adx < 22) {
      misses.push({ ...base, side: "short", rule: "R4-trend",
        reason: `Strong bearish DI but regime=${regime} (ADX too low)`,
        blockedBy: `ADX ${adxVal.adx.toFixed(1)} < 22, regime=${regime}`,
      });
    }
    if (adxVal.plusDI > adxVal.minusDI && adxVal.plusDI - adxVal.minusDI > 5 && rsiVal > 50 && adxVal.adx < 25) {
      misses.push({ ...base, side: "long", rule: "R3-trend",
        reason: `Strong bullish DI but regime=${regime} (ADX transitional)`,
        blockedBy: `ADX ${adxVal.adx.toFixed(1)} < 25, regime=${regime}`,
      });
    }
  }

  return misses;
}

// ── Contrarian Exit Thresholds ──────────────────────────────────────────────

/** Tighter exit parameters for contrarian (fade) trades */
export const CONTRARIAN_EXIT = {
  trailArm: 0.005,     // +0.5% to arm (vs 0.8% normal)
  trailTrigger: 0.002, // +0.2% to trigger (vs 0.3% normal)
  takeProfitCap: 0.015, // +1.5% cap (vs 2% normal)
  stopLoss: -0.015,    // -1.5% stop (vs -2% normal)
  timeStopHours: 2,    // 2h time stop (vs 4h normal)
} as const;
