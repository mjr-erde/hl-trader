#!/usr/bin/env node
/**
 * Backtest Export — generates ML training data from historical candles.
 *
 * For each coin, fetches 14 days of 1h candles and replays bar-by-bar.
 * At each entry signal, captures the indicator snapshot and simulates the exit
 * (look-ahead: checks next 12 bars for +2% TP or -2% SL hit).
 *
 * Output: ml/data/backtest_export.jsonl
 *
 * Usage:
 *   npx tsx hyperliquid-trader/src/backtest-export.ts
 *   npx tsx hyperliquid-trader/src/backtest-export.ts --coins BTC,ETH,SOL --days 30
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { Command } from "commander";
import { getCandles, type Candle } from "./candles.js";
import {
  rsi,
  macd,
  bollingerBands,
  atr,
  adx,
  detectRegime,
} from "../../src/lib/indicators.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

// ── CLI ──────────────────────────────────────────────────────────────────────

const program = new Command();
program
  .option("--coins <list>", "Coins to process (comma-separated)", "BTC,ETH,SOL,SUI,DOGE,MOODENG,TAO,HYPE,WIF,POPCAT")
  .option("--days <n>", "Days of history to process", "14")
  .option("--testnet", "Use testnet candles", false)
  .option("--out <path>", "Output file path", resolve(__dirname, "..", "ml", "data", "backtest_export.jsonl"))
  .parse();

const opts = program.opts();
const COINS: string[] = opts.coins.split(",").map((c: string) => c.trim().toUpperCase());
const DAYS = parseInt(opts.days, 10);
const OUTPUT_PATH: string = opts.out;
const USE_TESTNET: boolean = opts.testnet;

// ── Indicator Computation (bar-by-bar, no live API) ──────────────────────────

interface IndSnapshot {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  bb: { upper: number; middle: number; lower: number; width: number };
  atr: number;
  adx: { adx: number; plusDI: number; minusDI: number };
  regime: string;
  price: number;
}

function computeIndAt(
  candles: Candle[],
  idx: number
): IndSnapshot | null {
  if (idx < 50) return null;
  const slice = candles.slice(0, idx + 1);
  const closes = slice.map((c) => parseFloat(c.c));
  const highs = slice.map((c) => parseFloat(c.h));
  const lows = slice.map((c) => parseFloat(c.l));
  const price = closes[closes.length - 1];

  try {
    const rsiVal = rsi(closes, 14);
    const macdVal = macd(closes);
    const bbVal = bollingerBands(closes, 20, 2);
    const atrVal = atr(highs, lows, closes, 14);
    const adxVal = adx(highs, lows, closes, 14);
    const regime = detectRegime(adxVal.adx, bbVal.width);
    return { rsi: rsiVal, macd: macdVal, bb: bbVal, atr: atrVal, adx: adxVal, regime, price };
  } catch {
    return null;
  }
}

// ── Entry Rules (matches agent's strategy.ts thresholds) ─────────────────────

interface EntrySignal {
  side: "long" | "short";
  rule: string;
}

function checkEntries(ind: IndSnapshot): EntrySignal | null {
  const { regime } = ind;
  const adxVal = ind.adx.adx;
  const plusDI = ind.adx.plusDI;
  const minusDI = ind.adx.minusDI;
  const diSpreadBear = minusDI - plusDI;

  // R1: RSI Oversold Bounce (long)
  if ((regime === "quiet" || regime === "ranging") && ind.rsi < 30) {
    return { side: "long", rule: "R1-mean-reversion" };
  }

  // R2: RSI Overbought Fade (short)
  if ((regime === "quiet" || regime === "ranging") && ind.rsi > 70) {
    return { side: "short", rule: "R2-mean-reversion" };
  }

  // R3: Trend Follow Long
  if (
    (regime === "trending" || regime === "volatile_trend") &&
    adxVal > 25 &&
    plusDI > minusDI &&
    ind.rsi > 45 &&
    ind.macd.histogram > 0
  ) {
    return { side: "long", rule: "R3-trend" };
  }

  // R4: Trend Follow Short (ADX >= 22 with DI spread > 8, or ADX > 25)
  {
    const adxOk = adxVal > 25 || (adxVal > 22 && diSpreadBear > 8);
    const regimeOk =
      regime === "trending" ||
      regime === "volatile_trend" ||
      (adxVal > 22 && adxVal <= 25);
    const macdOk = ind.macd.histogram < 0.05 || (adxVal > 35 && diSpreadBear > 10);

    if (
      regimeOk &&
      adxOk &&
      minusDI > plusDI &&
      ind.rsi < 50 &&
      macdOk
    ) {
      return { side: "short", rule: "R4-trend" };
    }
  }

  return null;
}

// ── Exit Simulation (look-ahead TP/SL) ───────────────────────────────────────

function simulateExit(
  candles: Candle[],
  entryIdx: number,
  side: "long" | "short",
  entryPrice: number,
  tpPct = 0.02,
  slPct = 0.02,
  maxBars = 12
): { won: boolean; pnl: number; exitBar: number } {
  for (let i = 1; i <= maxBars; i++) {
    const barIdx = entryIdx + i;
    if (barIdx >= candles.length) break;

    const high = parseFloat(candles[barIdx].h);
    const low = parseFloat(candles[barIdx].l);
    const close = parseFloat(candles[barIdx].c);

    // Check TP and SL on the bar's range
    if (side === "long") {
      const upPct = (high - entryPrice) / entryPrice;
      const downPct = (entryPrice - low) / entryPrice;
      if (upPct >= tpPct) return { won: true, pnl: entryPrice * tpPct, exitBar: i };
      if (downPct >= slPct) return { won: false, pnl: -entryPrice * slPct, exitBar: i };
    } else {
      const downPct = (entryPrice - low) / entryPrice;
      const upPct = (high - entryPrice) / entryPrice;
      if (downPct >= tpPct) return { won: true, pnl: entryPrice * tpPct, exitBar: i };
      if (upPct >= slPct) return { won: false, pnl: -entryPrice * slPct, exitBar: i };
    }

    // Time stop: use final close
    if (i === maxBars) {
      const pnl = side === "long"
        ? (close - entryPrice) / entryPrice
        : (entryPrice - close) / entryPrice;
      return { won: pnl >= 0, pnl: pnl * entryPrice, exitBar: i };
    }
  }
  return { won: false, pnl: 0, exitBar: 0 };
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface TradeRecord {
  coin: string;
  side: "long" | "short";
  rule: string;
  won: number;
  pnl: number;
  source: "backtest";
  adx: number;
  plus_di: number;
  minus_di: number;
  rsi: number;
  macd_histogram: number;
  bb_width: number;
  atr_pct: number;
  regime: string;
  galaxy_score: number;
  sentiment_pct: number;
  alt_rank: number;
}

async function main() {
  console.log(`[backtest-export] Processing ${COINS.length} coins × ${DAYS} days of 1h candles`);

  // Ensure output directory exists
  const outDir = resolve(OUTPUT_PATH, "..");
  mkdirSync(outDir, { recursive: true });

  const allRecords: TradeRecord[] = [];
  const now = Date.now();
  const startTime = now - DAYS * 24 * 3_600_000;

  for (const coin of COINS) {
    process.stdout.write(`  ${coin}... `);
    try {
      const candles = await getCandles(coin, "1h", startTime, now, USE_TESTNET);
      if (candles.length < 60) {
        console.log(`skipped (only ${candles.length} candles)`);
        continue;
      }

      let openBar: number | null = null;
      let openSide: "long" | "short" | null = null;
      let openRule: string | null = null;
      let openPrice: number | null = null;
      let openInd: IndSnapshot | null = null;
      let coinTrades = 0;

      // Replay bars (allow at least 12 look-ahead bars for exit simulation)
      for (let i = 50; i < candles.length - 12; i++) {
        // If a position is open, check if we've reached the exit bar
        if (openBar !== null && openSide !== null && openRule !== null && openPrice !== null && openInd !== null) {
          const exit = simulateExit(candles, openBar, openSide, openPrice);
          if (i >= openBar + Math.max(1, exit.exitBar)) {
            // Trade is closed — record it
            const record: TradeRecord = {
              coin,
              side: openSide,
              rule: openRule,
              won: exit.won ? 1 : 0,
              pnl: exit.pnl,
              source: "backtest",
              adx: openInd.adx.adx,
              plus_di: openInd.adx.plusDI,
              minus_di: openInd.adx.minusDI,
              rsi: openInd.rsi,
              macd_histogram: openInd.macd.histogram,
              bb_width: openInd.bb.width,
              atr_pct: openInd.price > 0 ? openInd.atr / openInd.price : 0,
              regime: openInd.regime,
              galaxy_score: 0,
              sentiment_pct: 50,
              alt_rank: 500,
            };
            allRecords.push(record);
            coinTrades++;
            openBar = null;
            openSide = null;
            openRule = null;
            openPrice = null;
            openInd = null;
          }
          continue; // Don't scan for new entries while position is open
        }

        // No open position — scan for entry
        const ind = computeIndAt(candles, i);
        if (!ind) continue;

        const signal = checkEntries(ind);
        if (!signal) continue;

        // Open position
        openBar = i;
        openSide = signal.side;
        openRule = signal.rule;
        openPrice = ind.price;
        openInd = ind;
      }

      // Handle any remaining open position at end of candles
      if (openBar !== null && openSide !== null && openRule !== null && openPrice !== null && openInd !== null) {
        const lastIdx = candles.length - 1;
        const lastClose = parseFloat(candles[lastIdx].c);
        const pnlPct = openSide === "long"
          ? (lastClose - openPrice) / openPrice
          : (openPrice - lastClose) / openPrice;
        allRecords.push({
          coin,
          side: openSide,
          rule: openRule,
          won: pnlPct >= 0 ? 1 : 0,
          pnl: pnlPct * openPrice,
          source: "backtest",
          adx: openInd.adx.adx,
          plus_di: openInd.adx.plusDI,
          minus_di: openInd.adx.minusDI,
          rsi: openInd.rsi,
          macd_histogram: openInd.macd.histogram,
          bb_width: openInd.bb.width,
          atr_pct: openInd.price > 0 ? openInd.atr / openInd.price : 0,
          regime: openInd.regime,
          galaxy_score: 0,
          sentiment_pct: 50,
          alt_rank: 500,
        });
        coinTrades++;
      }

      console.log(`${candles.length} candles → ${coinTrades} trades`);
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
    }
  }

  if (allRecords.length === 0) {
    console.error("[backtest-export] No trades generated — check coin list and API connectivity");
    process.exit(1);
  }

  // Write JSONL
  const lines = allRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(OUTPUT_PATH, lines, "utf8");

  // Summary by rule
  const byRule: Record<string, { total: number; wins: number }> = {};
  for (const r of allRecords) {
    if (!byRule[r.rule]) byRule[r.rule] = { total: 0, wins: 0 };
    byRule[r.rule].total++;
    if (r.won) byRule[r.rule].wins++;
  }

  console.log(`\n[backtest-export] Done: ${allRecords.length} trades → ${OUTPUT_PATH}`);
  console.log("\nBy rule:");
  for (const [rule, stats] of Object.entries(byRule)) {
    const wr = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(0) : "—";
    console.log(`  ${rule}: ${stats.total} trades, ${wr}% win rate`);
  }

  console.log("\nNext: run training with:");
  console.log(`  hyperliquid-trader/ml/.venv/bin/python3 hyperliquid-trader/ml/scorer.py --mode train --data ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("[backtest-export] Fatal:", err);
  process.exit(1);
});
