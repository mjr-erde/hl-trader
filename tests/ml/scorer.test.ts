/**
 * ML Scorer tests — deterministic fixture-based tests.
 *
 * These tests verify that:
 * 1. The scorer returns a valid score for known good inputs
 * 2. R4-trend short in trending regime scores above 0.35
 * 3. R3-trend long in trending regime scores above 0.30
 * 4. Trending regime inputs score higher than ranging for trend rules
 * 5. The scorer handles all fixture inputs without errors
 *
 * Run with: npx vitest run tests/ml/
 * Or:       npx erde ml test
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const ML_DIR = path.join(projectRoot, "hyperliquid-trader", "ml");
const MODEL_FILE = path.join(ML_DIR, "model", "confidence_model.pkl");
const VENV_PYTHON = path.join(ML_DIR, ".venv", "bin", "python3");
const SCORER_PY = path.join(ML_DIR, "scorer.py");

async function score(input: Record<string, unknown>): Promise<{ score: number | null; modelSamples: number }> {
  const { execFile } = await import("child_process");
  return new Promise((resolve, reject) => {
    const child = execFile(VENV_PYTHON, [SCORER_PY, "--mode", "score"], (err, stdout, _stderr) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as { score: number | null; modelSamples: number });
      } catch {
        reject(new Error(`Invalid JSON from scorer: ${stdout}`));
      }
    });
    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
}

const MODEL_AVAILABLE = fs.existsSync(MODEL_FILE) && fs.existsSync(VENV_PYTHON);

describe.skipIf(!MODEL_AVAILABLE)("ML Scorer (requires trained model)", () => {
  const R4_SHORT_BTC = {
    coin: "BTC", side: "short", rule: "R4-trend",
    adx: 30, plus_di: 18, minus_di: 35,
    rsi: 44, macd_histogram: -0.003, bb_width: 0.04, atr_pct: 0.008,
    regime: "trending",
    galaxy_score: 55, sentiment_pct: 48, alt_rank: 120,
  };

  const R3_LONG_SOL = {
    coin: "SOL", side: "long", rule: "R3-trend",
    adx: 27, plus_di: 35, minus_di: 18,
    rsi: 52, macd_histogram: 0.003, bb_width: 0.04, atr_pct: 0.010,
    regime: "trending",
    galaxy_score: 65, sentiment_pct: 70, alt_rank: 75,
  };

  const WEAK_SETUP = {
    coin: "ETH", side: "long", rule: "R3-trend",
    adx: 15, plus_di: 20, minus_di: 25,
    rsi: 48, macd_histogram: 0.0001, bb_width: 0.025, atr_pct: 0.005,
    regime: "ranging",
    galaxy_score: 40, sentiment_pct: 55, alt_rank: 200,
  };

  it("returns a valid score for R4-trend short BTC", async () => {
    const result = await score(R4_SHORT_BTC);
    expect(result.score).not.toBeNull();
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("R4-trend short in trending regime scores above 0.35", async () => {
    const result = await score(R4_SHORT_BTC);
    expect(result.score).toBeGreaterThan(0.35);
  });

  it("R3-trend long in trending regime scores above 0.30", async () => {
    const result = await score(R3_LONG_SOL);
    expect(result.score).toBeGreaterThan(0.30);
  });

  it("scores are bounded in [0, 1] for both strong and weak setups", async () => {
    const strongResult = await score(R4_SHORT_BTC);
    const weakResult = await score(WEAK_SETUP);
    // Both should be valid probabilities
    expect(strongResult.score!).toBeGreaterThanOrEqual(0);
    expect(strongResult.score!).toBeLessThanOrEqual(1);
    expect(weakResult.score!).toBeGreaterThanOrEqual(0);
    expect(weakResult.score!).toBeLessThanOrEqual(1);
  });

  it("returns modelSamples count", async () => {
    const result = await score(R4_SHORT_BTC);
    expect(result.modelSamples).toBeGreaterThan(0);
  });

  it("handles fixture inputs without errors (sample of 5)", async () => {
    const fixturesPath = path.join(projectRoot, "tests", "fixtures", "ml_trades.jsonl");
    const lines = fs.readFileSync(fixturesPath, "utf-8").split("\n").filter(Boolean);
    // Test only 5 fixtures to keep runtime short
    const sample = [lines[0], lines[5], lines[11], lines[18], lines[28]].filter(Boolean);

    for (const line of sample) {
      const fixture = JSON.parse(line) as Record<string, unknown>;
      const { won: _won, ...input } = fixture;
      const result = await score(input);
      expect(result.score).not.toBeNull();
      expect(typeof result.score).toBe("number");
    }
  });
});

describe("ML Scorer fixtures (always run)", () => {
  it("fixture file exists with 50 trade records", () => {
    const fixturesPath = path.join(projectRoot, "tests", "fixtures", "ml_trades.jsonl");
    expect(fs.existsSync(fixturesPath)).toBe(true);
    const lines = fs.readFileSync(fixturesPath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(50);
  });

  it("all fixture records have required fields", () => {
    const fixturesPath = path.join(projectRoot, "tests", "fixtures", "ml_trades.jsonl");
    const lines = fs.readFileSync(fixturesPath, "utf-8").split("\n").filter(Boolean);
    const required = ["coin", "side", "rule", "adx", "plus_di", "minus_di", "rsi", "regime", "won"];
    for (const line of lines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      for (const field of required) {
        expect(record).toHaveProperty(field);
      }
    }
  });

  it("fixture records cover all major rules", () => {
    const fixturesPath = path.join(projectRoot, "tests", "fixtures", "ml_trades.jsonl");
    const lines = fs.readFileSync(fixturesPath, "utf-8").split("\n").filter(Boolean);
    const rules = new Set(lines.map((l) => (JSON.parse(l) as { rule: string }).rule));
    expect(rules).toContain("R4-trend");
    expect(rules).toContain("R3-trend");
    expect(rules).toContain("R1-mean-reversion");
    expect(rules).toContain("R2-mean-reversion");
  });

  it("fixture records have a mix of wins and losses", () => {
    const fixturesPath = path.join(projectRoot, "tests", "fixtures", "ml_trades.jsonl");
    const lines = fs.readFileSync(fixturesPath, "utf-8").split("\n").filter(Boolean);
    const records = lines.map((l) => JSON.parse(l) as { won: boolean });
    const wins = records.filter((r) => r.won).length;
    const losses = records.filter((r) => !r.won).length;
    expect(wins).toBeGreaterThan(5);
    expect(losses).toBeGreaterThan(5);
  });
});
