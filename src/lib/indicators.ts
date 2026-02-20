/**
 * Technical indicators — pure math functions.
 * Formulas from knowledge/crypto-trading-strategies.md §4.7.
 */

export function sma(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Compute full EMA series. Seed with SMA of first `period` values. */
export function emaSeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const alpha = 2 / (period + 1);
  const result: number[] = [];
  let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < data.length; i++) {
    prev = data[i] * alpha + prev * (1 - alpha);
    result.push(prev);
  }
  return result;
}

/** Final EMA value. */
export function ema(data: number[], period: number): number {
  const series = emaSeries(data, period);
  return series.length > 0 ? series[series.length - 1] : NaN;
}

export function rsi(data: number[], period: number = 14): number {
  if (data.length < period + 1) return NaN;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(data: number[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  const ema12 = emaSeries(data, 12);
  const ema26 = emaSeries(data, 26);
  if (ema26.length === 0) return { macd: NaN, signal: NaN, histogram: NaN };
  // Align: ema12 starts at index 12, ema26 starts at index 26.
  // MACD line = ema12 - ema26, aligned from index 26 onward.
  const offset = 26 - 12; // ema12 has 14 more entries than ema26
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  const signalSeries = emaSeries(macdLine, 9);
  if (signalSeries.length === 0)
    return { macd: macdLine[macdLine.length - 1], signal: NaN, histogram: NaN };
  const m = macdLine[macdLine.length - 1];
  const s = signalSeries[signalSeries.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

export function bollingerBands(
  data: number[],
  period: number = 20,
  k: number = 2
): { upper: number; middle: number; lower: number; width: number } {
  if (data.length < period)
    return { upper: NaN, middle: NaN, lower: NaN, width: NaN };
  const slice = data.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + k * std;
  const lower = middle - k * std;
  const width = middle !== 0 ? (upper - lower) / middle : 0;
  return { upper, middle, lower, width };
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < period + 1) return NaN;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return NaN;
  // Wilder's smoothing: first ATR is SMA, then smoothed
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): { adx: number; plusDI: number; minusDI: number } {
  const nan = { adx: NaN, plusDI: NaN, minusDI: NaN };
  if (highs.length < period * 2 + 1) return nan;

  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }

  // Wilder's smoothing for +DM, -DM, TR
  let smoothPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];

  for (let i = period; i < trs.length; i++) {
    if (i > period) {
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMs[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMs[i];
      smoothTR = smoothTR - smoothTR / period + trs[i];
    }
    const plusDI = smoothTR !== 0 ? (100 * smoothPlusDM) / smoothTR : 0;
    const minusDI = smoothTR !== 0 ? (100 * smoothMinusDM) / smoothTR : 0;
    const diSum = plusDI + minusDI;
    const dx = diSum !== 0 ? (100 * Math.abs(plusDI - minusDI)) / diSum : 0;
    dxValues.push(dx);
  }

  if (dxValues.length < period) return nan;

  // ADX = smoothed average of DX
  let adxVal = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
  }

  // Final +DI / -DI
  const finalPlusDI =
    smoothTR !== 0 ? (100 * smoothPlusDM) / smoothTR : 0;
  const finalMinusDI =
    smoothTR !== 0 ? (100 * smoothMinusDM) / smoothTR : 0;

  return { adx: adxVal, plusDI: finalPlusDI, minusDI: finalMinusDI };
}

export function detectRegime(adxValue: number, bbWidth: number): string {
  if (adxValue > 25) return bbWidth > 0.06 ? "volatile_trend" : "trending";
  return bbWidth < 0.03 ? "quiet" : "ranging";
}
