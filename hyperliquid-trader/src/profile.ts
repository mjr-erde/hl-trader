/**
 * Trading profile — first-run wizard, profile persistence, and config defaults.
 *
 * Profile is saved to hyperliquid-trader/.trading-profile.json (gitignored).
 * Run the wizard with --help-me, skip with --no-wizard.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROFILE_PATH = resolve(__dirname, "..", ".trading-profile.json");

export interface TradingProfile {
  displayName: string;
  riskAppetite: "conservative" | "moderate" | "aggressive";
  strategyPreference: "trend" | "mixed" | "contrarian-heavy";
  coinset: "bluechip" | "midcap" | "meme" | "full" | "custom";
  customCoins?: string[];
  createdAt: string;
  // Derived settings applied as overrides
  leverage: number;
  maxAllocPct: number;
  circuitBreakerUsd: number;
  contrarianPct: number;
  coins: string[];
  // Paper trading
  paperBalance: number;
}

const RISK_PRESETS: Record<
  TradingProfile["riskAppetite"],
  { leverage: number; maxAllocPct: number; circuitBreakerUsd: number }
> = {
  conservative: { leverage: 2, maxAllocPct: 15, circuitBreakerUsd: 20 },
  moderate:     { leverage: 3, maxAllocPct: 20, circuitBreakerUsd: 30 },
  aggressive:   { leverage: 5, maxAllocPct: 25, circuitBreakerUsd: 50 },
};

const STRATEGY_PRESETS: Record<
  TradingProfile["strategyPreference"],
  { contrarianPct: number }
> = {
  "trend":            { contrarianPct: 0  },
  "mixed":            { contrarianPct: 20 },
  "contrarian-heavy": { contrarianPct: 40 },
};

export const COIN_PRESETS: Record<TradingProfile["coinset"], string[]> = {
  bluechip: ["BTC", "ETH", "SOL"],
  midcap:   ["BTC", "ETH", "SOL", "SUI", "AVAX"],
  meme:     ["DOGE", "SUI", "WIF", "POPCAT", "MOODENG"],
  full:     ["BTC", "ETH", "SOL", "SUI", "DOGE", "MOODENG", "TAO", "HYPE", "WIF", "POPCAT"],
  custom:   [],
};

export function loadProfile(): TradingProfile | null {
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as TradingProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: TradingProfile): void {
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
}

/**
 * Prompt a single line from stdin with a timeout.
 * Resolves with the user's trimmed input, or null on timeout / non-TTY.
 */
function promptLine(question: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve(null); return; }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const timer = setTimeout(() => {
      rl.close();
      resolve(null);
    }, timeoutMs);
    rl.question(question, (answer) => {
      clearTimeout(timer);
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

/** Parse a numeric menu choice, return the 0-based index or defaultIdx on invalid input. */
function parseMenuChoice(answer: string | null, count: number, defaultIdx: number): number {
  if (answer === null) return defaultIdx;
  const n = parseInt(answer, 10);
  return n >= 1 && n <= count ? n - 1 : defaultIdx;
}

/**
 * Run the interactive first-time wizard.
 * Returns a TradingProfile with all derived settings applied.
 * In non-TTY contexts, returns the moderate/mixed/midcap defaults.
 */
export async function runWizard(isTTY: boolean): Promise<TradingProfile> {
  const defaultProfile: TradingProfile = {
    displayName: "Matt",
    riskAppetite: "moderate",
    strategyPreference: "mixed",
    coinset: "midcap",
    createdAt: new Date().toISOString(),
    ...RISK_PRESETS.moderate,
    ...STRATEGY_PRESETS.mixed,
    coins: COIN_PRESETS.midcap,
    paperBalance: 200,
  };

  if (!isTTY) {
    console.log("");
    console.log("  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  Profile wizard skipped — no interactive terminal found  │");
    console.log("  └─────────────────────────────────────────────────────────┘");
    console.log("");
    console.log("  This happens when the agent is started from Claude Code or");
    console.log("  a piped/non-interactive shell. The wizard needs a real TTY.");
    console.log("");
    console.log("  To run the wizard, open a regular terminal and run:");
    console.log("    npx tsx hyperliquid-trader/src/agent.ts --help-me");
    console.log("");
    console.log("  Running with default settings for now:");
    console.log("    Risk: moderate — 3x leverage, 20% alloc, $30 circuit breaker");
    console.log("    Strategy: mixed — R3/R4 + 20% contrarian");
    console.log("    Coins: BTC, ETH, SOL, SUI, AVAX");
    console.log("");
    return defaultProfile;
  }

  console.log("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  First-time setup (Ctrl+C to skip, auto-proceeds in 30s)");
  console.log("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Q0: Who are you?
  console.log("  What should I call you? (default: Matt)");
  const nameAnswer = await promptLine("  > ", 30_000);
  const displayName = nameAnswer || "Matt";
  console.log(`\n  Hey ${displayName}! Let's get you set up.\n`);

  // Q1: Risk appetite
  console.log("  Risk appetite?");
  console.log("    [1] Conservative — 2x leverage, 15% alloc, $20 circuit breaker");
  console.log("    [2] Moderate     — 3x leverage, 20% alloc, $30 circuit breaker  (default)");
  console.log("    [3] Aggressive   — 5x leverage, 25% alloc, $50 circuit breaker");
  const riskAnswer = await promptLine("  > ", 30_000);
  const riskOptions: TradingProfile["riskAppetite"][] = ["conservative", "moderate", "aggressive"];
  const riskAppetite = riskOptions[parseMenuChoice(riskAnswer, 3, 1)];

  // Q2: Strategy focus
  console.log("\n  Strategy focus?");
  console.log("    [1] Trend-only       — R3/R4 only, no contrarian");
  console.log("    [2] Mixed            — R3/R4 + 20% contrarian signals  (default)");
  console.log("    [3] Contrarian-heavy — R3/R4 + 40% contrarian signals");
  const stratAnswer = await promptLine("  > ", 30_000);
  const stratOptions: TradingProfile["strategyPreference"][] = ["trend", "mixed", "contrarian-heavy"];
  const strategyPreference = stratOptions[parseMenuChoice(stratAnswer, 3, 1)];

  // Q3: Coin selection
  console.log("\n  Coin selection?");
  console.log("    [1] Blue-chip   — BTC, ETH, SOL");
  console.log("    [2] Mid-cap     — BTC, ETH, SOL, SUI, AVAX  (default)");
  console.log("    [3] Meme-heavy  — DOGE, SUI, WIF, POPCAT, MOODENG");
  console.log("    [4] Full list   — BTC ETH SOL SUI DOGE MOODENG TAO HYPE WIF POPCAT");
  console.log("    [5] Custom      — enter comma-separated coins");
  const coinAnswer = await promptLine("  > ", 30_000);
  const coinsetOptions: TradingProfile["coinset"][] = ["bluechip", "midcap", "meme", "full", "custom"];
  const coinset = coinsetOptions[parseMenuChoice(coinAnswer, 5, 1)];

  let customCoins: string[] | undefined;
  let coins: string[];

  if (coinset === "custom") {
    console.log("\n  Enter coins (comma-separated, e.g. BTC,ETH,SOL,DOGE):");
    const customAnswer = await promptLine("  > ", 30_000);
    customCoins = (customAnswer ?? "BTC,ETH,SOL")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    coins = customCoins;
  } else {
    coins = COIN_PRESETS[coinset];
  }

  // Q4: Paper trading starting capital
  console.log("\n  Paper trading starting capital?");
  console.log("    How much virtual money to practice with. Pick an amount close to");
  console.log("    your real balance so the sizing feels realistic.");
  console.log("    Enter a number in USD (default: 200):");
  const balanceAnswer = await promptLine("  > $", 30_000);
  const parsedBalance = parseFloat((balanceAnswer ?? "").trim());
  const paperBalance = isNaN(parsedBalance) || parsedBalance <= 0 ? 200 : parsedBalance;

  const profile: TradingProfile = {
    displayName,
    riskAppetite,
    strategyPreference,
    coinset,
    ...(customCoins ? { customCoins } : {}),
    createdAt: new Date().toISOString(),
    ...RISK_PRESETS[riskAppetite],
    ...STRATEGY_PRESETS[strategyPreference],
    coins,
    paperBalance,
  };

  console.log(`\n  All set, ${displayName}! Settings saved:`);
  console.log(`    Risk:          ${riskAppetite} — ${profile.leverage}x lev, ${profile.maxAllocPct}% alloc, $${profile.circuitBreakerUsd} breaker`);
  console.log(`    Strategy:      ${strategyPreference} — contrarian ${profile.contrarianPct}%`);
  console.log(`    Coins:         ${profile.coins.join(", ")}`);
  console.log(`    Paper capital: $${profile.paperBalance}`);
  console.log("\n  Use --no-wizard to skip setup, --help-me to re-run.\n");

  return profile;
}
