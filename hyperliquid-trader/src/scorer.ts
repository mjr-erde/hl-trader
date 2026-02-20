/**
 * ML confidence scorer — Node.js wrapper around ml/scorer.py.
 *
 * Spawns a Python subprocess, writes JSON to stdin, reads JSON from stdout.
 * 3-second hard timeout — never blocks a trade. Falls back to rule confidence.
 *
 * Usage:
 *   import { scoreTrade, blendConfidence, triggerRetrain } from "./scorer.js";
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { IndicatorSnapshot } from "./strategy.js";
import type { SentimentSnapshot, FearGreedReading } from "./sentiment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ML_DIR = resolve(__dirname, "..", "ml");
export const MODEL_FILE = resolve(ML_DIR, "model", "confidence_model.pkl");
export const MODEL_META_FILE = resolve(ML_DIR, "model", "training_meta.json");
export const LIVE_TRAIN_PATH = resolve(ML_DIR, "data", "live_trades.jsonl");
export const BACKTEST_DATA_PATH = resolve(ML_DIR, "data", "backtest_export.jsonl");
const DEFAULTS_FILE = resolve(ML_DIR, "defaults.json");

const SCORER_PY = resolve(ML_DIR, "scorer.py");
const VENV_PYTHON = resolve(ML_DIR, ".venv", "bin", "python3");

function getPython(): string {
  return existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
}

interface DefaultsJson {
  rules: Record<string, number>;
  default: number;
}

let _defaults: DefaultsJson | null = null;

function loadDefaults(): DefaultsJson {
  if (_defaults) return _defaults;
  try {
    _defaults = JSON.parse(readFileSync(DEFAULTS_FILE, "utf8")) as DefaultsJson;
  } catch {
    _defaults = { rules: {}, default: 0.50 };
  }
  return _defaults;
}

function defaultScore(rule: string): number {
  const d = loadDefaults();
  // Strip contrarian prefix for lookup, then try full rule name
  const base = rule.replace(/^C-/, "");
  return d.rules[rule] ?? d.rules[base] ?? d.default;
}

export interface ScorerInput {
  coin: string;
  side: "long" | "short";
  rule: string;
  indicators: IndicatorSnapshot;
  sentiment?: SentimentSnapshot | null;
  /** Recent ATR readings for this coin (used to compute atr_percentile). */
  atrHistory?: number[];
  /** Market-wide Fear & Greed reading (from alternative.me). */
  fearGreed?: FearGreedReading | null;
}

export interface ScorerResult {
  score: number | null;
  modelSamples?: number;
  source?: "model" | "default";
  error?: string;
}

/**
 * Score a potential trade entry using the trained ML model.
 * Falls back to static default scores (from ml/defaults.json) when no model is trained.
 * 3-second hard timeout — never blocks a trade.
 */
export async function scoreTrade(input: ScorerInput): Promise<ScorerResult> {
  if (!existsSync(MODEL_FILE) || !existsSync(SCORER_PY)) {
    // No trained model yet — use static defaults derived from backtests
    return { score: defaultScore(input.rule), modelSamples: 0, source: "default" };
  }

  const ind = input.indicators;
  const sent = input.sentiment ?? null;

  // Derived features
  const bbRange = ind.bb.upper - ind.bb.lower;
  const bbPosition = bbRange > 0 ? (ind.price - ind.bb.lower) / bbRange : 0.5;

  let atrPercentile = 0.5;
  if (input.atrHistory && input.atrHistory.length >= 5) {
    const below = input.atrHistory.filter((h) => h <= ind.atr).length;
    atrPercentile = below / input.atrHistory.length;
  }

  const payload = {
    coin: input.coin,
    side: input.side,
    rule: input.rule,
    adx: ind.adx.adx,
    plus_di: ind.adx.plusDI,
    minus_di: ind.adx.minusDI,
    rsi: ind.rsi,
    macd_histogram: ind.macd.histogram,
    macd_line: ind.macd.macd,
    bb_width: ind.bb.width,
    bb_position: bbPosition,
    atr_pct: ind.price > 0 ? ind.atr / ind.price : 0,
    atr_percentile: atrPercentile,
    regime: ind.regime,
    galaxy_score: sent?.galaxyScore ?? 0,
    sentiment_pct: sent?.sentiment ?? 50,
    alt_rank: sent?.altRank ?? 500,
    has_sentiment: sent != null ? 1 : 0,
    funding_rate: sent?.fundingRate ?? 0,
    fear_greed: input.fearGreed?.value ?? 50,
  };

  return new Promise((resolve) => {
    const python = getPython();
    let settled = false;

    const child = spawn(python, [SCORER_PY, "--mode", "score"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ score: defaultScore(input.rule), modelSamples: 0, source: "default", error: "timeout" });
      }
    }, 3000);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        const result = JSON.parse(stdout.trim()) as ScorerResult;
        resolve({ ...result, source: "model" });
      } catch {
        resolve({ score: defaultScore(input.rule), modelSamples: 0, source: "default", error: `parse error: ${stdout.slice(0, 100)}` });
      }
    });

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ score: defaultScore(input.rule), modelSamples: 0, source: "default", error: err.message });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Blend rule-based confidence with ML probability score.
 * ML weight grows with sample count, max 60% at 500+ samples.
 *
 * Examples:
 *   0 samples → pure rule confidence
 *   100 samples → 12% ML, 88% rule
 *   500 samples → 60% ML, 40% rule
 */
export function blendConfidence(ruleConf: number, ml: ScorerResult): number {
  if (ml.score === null) return ruleConf;
  const samples = ml.modelSamples ?? 0;
  const mlWeight = Math.min(samples / 500, 0.6);
  return ruleConf * (1 - mlWeight) + ml.score * mlWeight;
}

/**
 * Trigger retraining of the ML model in the background (non-blocking).
 * Trains on backtest_export.jsonl + live_trades.jsonl.
 */
export function triggerRetrain(logFn: (s: string) => void): void {
  if (!existsSync(SCORER_PY)) {
    logFn("[ML] scorer.py not found — skipping retrain");
    return;
  }
  if (!existsSync(BACKTEST_DATA_PATH)) {
    logFn("[ML] No backtest data — skipping retrain (run backtest-export.ts first)");
    return;
  }

  // Ensure data dir exists for live trade file
  mkdirSync(resolve(ML_DIR, "data"), { recursive: true });

  const python = getPython();
  const args = ["--mode", "train", "--data", BACKTEST_DATA_PATH];
  if (existsSync(LIVE_TRAIN_PATH)) {
    args.push("--live", LIVE_TRAIN_PATH);
  }

  const child = spawn(python, [SCORER_PY, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let out = "";
  let err = "";
  child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { err += d.toString(); });

  child.on("close", (code) => {
    try {
      const result = JSON.parse(out.trim());
      if (result.ok) {
        logFn(`[ML] Retrain complete: ${result.sampleCount} samples, accuracy=${(result.accuracy * 100).toFixed(1)}%`);
      } else {
        logFn(`[ML] Retrain result: ${JSON.stringify(result)}`);
      }
    } catch {
      logFn(`[ML] Retrain exited ${code}: ${out.slice(0, 200)}${err ? ` | stderr: ${err.slice(0, 100)}` : ""}`);
    }
  });

  child.unref();
  logFn("[ML] Retrain triggered (background)");
}

/**
 * Build a flat indicator fields object for JSONL output.
 * Used to capture the entry indicator state for live training data.
 *
 * @param atrHistory  Recent ATR readings for this coin (enables atr_percentile feature).
 * @param extras      Additional context fields (fundingRate, fearGreed) to include.
 */
export function flatIndicatorFields(
  ind: IndicatorSnapshot,
  atrHistory?: number[],
  extras?: { fundingRate?: number; fearGreed?: number }
): Record<string, number | string> {
  const bbRange = ind.bb.upper - ind.bb.lower;
  const bbPosition = bbRange > 0 ? (ind.price - ind.bb.lower) / bbRange : 0.5;

  let atrPercentile = 0.5;
  if (atrHistory && atrHistory.length >= 5) {
    const below = atrHistory.filter((h) => h <= ind.atr).length;
    atrPercentile = below / atrHistory.length;
  }

  return {
    adx: ind.adx.adx,
    plus_di: ind.adx.plusDI,
    minus_di: ind.adx.minusDI,
    rsi: ind.rsi,
    macd_histogram: ind.macd.histogram,
    macd_line: ind.macd.macd,
    bb_width: ind.bb.width,
    bb_position: bbPosition,
    atr_pct: ind.price > 0 ? ind.atr / ind.price : 0,
    atr_percentile: atrPercentile,
    regime: ind.regime,
    ...(extras?.fundingRate != null ? { funding_rate: extras.fundingRate } : {}),
    ...(extras?.fearGreed != null ? { fear_greed: extras.fearGreed } : {}),
  };
}
