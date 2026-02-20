#!/usr/bin/env node
/**
 * Automated Hyperliquid trading agent.
 * Runs R1-R5 entry rules and EXIT 1-5 exit rules against live perp markets.
 *
 * Usage:
 *   npx tsx hyperliquid-trader/src/agent.ts --dry-run --interval 1 --verbose
 *   npx tsx hyperliquid-trader/src/agent.ts --interval 5
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync, statSync } from "fs";
import { createInterface as createReadline } from "readline";
import { execFile, spawn } from "child_process";
import { Command } from "commander";

// Load .env from the hyperliquid-trader directory regardless of CWD
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

import {
  createClients,
  getBalance,
  getMeta,
  getMidPrice,
  getPositions,
  placeMarketOrder,
  closePosition,
  cancelOpenOrders,
  type Position,
  type MetaAsset,
  type TpSlConfig,
} from "./exchange.js";
import { loadPrivateKey } from "./keyloader.js";
import {
  computeIndicators,
  evaluateEntrySignals,
  evaluateExitSignals,
  computePositionSize,
  detectNearMisses,
  CONTRARIAN_EXIT,
  type AgentState,
  type Signal,
  type NearMiss,
  type IndicatorSnapshot,
} from "./strategy.js";
import { logTradeOpen, logTradeClose, registerSession, closeSession } from "./tradelog.js";
import {
  scoreTrade,
  blendConfidence,
  triggerRetrain,
  flatIndicatorFields,
  LIVE_TRAIN_PATH,
  MODEL_FILE,
  MODEL_META_FILE,
  ML_DIR,
} from "./scorer.js";
import {
  fetchSentiment,
  detectSentimentSignals,
  discoverSentimentCoins,
  type SentimentSnapshot,
  type SentimentSignal,
} from "./sentiment.js";
import {
  loadProfile,
  saveProfile,
  runWizard,
  type TradingProfile,
} from "./profile.js";

// ── CLI ──────────────────────────────────────────────────────────────────────

const program = new Command();
const DEFAULT_ACCOUNT_ENV = "HYPERLIQUID_ACCOUNT_ADDRESS";

program
  .name("trading-agent")
  .description("Automated Hyperliquid perp trading agent")
  .option("--dry-run", "Log trades without executing", false)
  .option("--interval <min>", "Loop interval in minutes", "5")
  .option("--coins <list>", "Coins to scan (comma-separated)", "BTC,ETH,SOL,SUI,DOGE")
  .option("--max-positions <n>", "Max simultaneous positions", "3")
  .option("--max-alloc <pct>", "Max % of balance per trade", "20")
  .option("--leverage <n>", "Leverage for new positions", "3")
  .option("--circuit-breaker <$>", "Session loss limit in USD", "30")
  .option("--session-hours <n>", "Auto-shutdown after N hours", "24")
  .option("--testnet", "Use testnet")
  .option("--key-file <path>", "Private key file")
  .option("--key-env <name>", "Env var for private key", "HYPERLIQUID_PRIVATE_KEY")
  .option("--account <address>", "Main wallet address (for balance/positions)")
  .option("--account-env <name>", "Env var for main wallet address", DEFAULT_ACCOUNT_ENV)
  .option("--no-notify", "Disable ntfy notifications")
  .option("--contrarian-pct <n>", "% of qualifying signals to trade contrarian (0=off)", "20")
  .option("--vol-detect", "Enable volatility detection + dynamic interval")
  .option("--no-vol-detect", "Disable volatility detection")
  .option("--no-wizard", "Skip wizard and profile loading (for automated/background runs)")
  .option("--help-me", "Re-run wizard to update profile settings")
  .option("--wizard-only", "Run the profile wizard and exit (used by start-erde)")
  .option("--paper-balance <$>", "Starting virtual balance for paper/dry-run trading", "200")
  .option("--verbose", "Extra logging", false);

program.parse();
const opts = program.opts();

// ── Config ───────────────────────────────────────────────────────────────────

// Unique agent name: model + session start time (e.g. claude-opus-4-6-20260216-1930)
const SESSION_START = new Date();
const AGENT_NAME = `claude-opus-4-6-${SESSION_START.toISOString().slice(0, 16).replace(/[-T:]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2")}`;
const DRY_RUN: boolean = opts.dryRun;
const INTERVAL_MS = parseFloat(opts.interval) * 60_000;
let COINS: string[] = opts.coins.split(",").map((c: string) => c.trim().toUpperCase());
let MAX_POSITIONS = parseInt(opts.maxPositions, 10);
let MAX_ALLOC_PCT = parseFloat(opts.maxAlloc);
let LEVERAGE = parseInt(opts.leverage, 10);
let CIRCUIT_BREAKER_USD = parseFloat(opts.circuitBreaker);
const SESSION_HOURS = parseFloat(opts.sessionHours);
const NOTIFY = opts.notify !== false;
const VERBOSE: boolean = opts.verbose;
let CONTRARIAN_PCT = parseInt(opts.contrarianPct ?? "20", 10);
let MAX_CONTRARIAN_POS = Math.ceil(MAX_POSITIONS * CONTRARIAN_PCT / 100);
const PAPER_BALANCE_USD = parseFloat(opts.paperBalance ?? "200");
let DISPLAY_NAME = "Matt"; // default, overridden by wizard profile
// Vol-detect: true if --vol-detect, false if --no-vol-detect, undefined if neither (prompt at startup)
const VOL_DETECT_EXPLICIT = process.argv.some(a => a === "--vol-detect" || a === "--no-vol-detect");
// Paper balance: true if --paper-balance explicitly passed (skip interactive prompt)
const PAPER_BALANCE_EXPLICIT = process.argv.some(a => a === "--paper-balance");
let VOL_DETECT: boolean = opts.volDetect !== false; // default true, overridden by prompt if not explicit

// Track which flags were explicitly passed (used to detect profile vs CLI flag conflicts)
const EXPLICIT_FLAGS = new Set(process.argv.filter(a => a.startsWith("--")));

// Style check-in: every 6h of cycles
const STYLE_CHECKIN_CYCLES = Math.max(1, Math.floor(6 * 60 * 60_000 / INTERVAL_MS));

// ── Log File ─────────────────────────────────────────────────────────────────

const projectRoot = resolve(__dirname, "..", "..");
const logsDir = resolve(projectRoot, "logs");
mkdirSync(logsDir, { recursive: true });

const LOG_FILE = resolve(logsDir, `${AGENT_NAME}.log`);

function writeLog(line: string) {
  const full = `${new Date().toISOString()} ${line}\n`;
  appendFileSync(LOG_FILE, full);
}

// ── Clients ──────────────────────────────────────────────────────────────────

const key = loadPrivateKey({ keyFile: opts.keyFile, keyEnv: opts.keyEnv });
const { info, exchange, wallet } = createClients({
  privateKey: key,
  testnet: opts.testnet,
});
// In paper mode, wallet may be null — fall back to configured address or a placeholder
const accountAddress = (
  opts.account ??
  process.env[opts.accountEnv ?? DEFAULT_ACCOUNT_ENV] ??
  wallet?.address ??
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

// ── State ────────────────────────────────────────────────────────────────────

const state: AgentState = {
  peakPnl: new Map(),
  squeezeForming: new Map(),
  entryTimes: new Map(),
};

let totalRealizedPnl = 0;
let sessionWins = 0;
let sessionLosses = 0;
let sessionContrWins = 0;
let sessionContrLosses = 0;
let cycleCount = 0;
let consecutiveErrors = 0;
const sessionStartTime = SESSION_START.getTime();

// Contrarian mode: tracks which positions are contrarian fades
const contrarianPositions = new Set<string>();

// Paper trading: virtual positions + balance (only used when DRY_RUN)
const virtualPositions: Map<string, Position> = new Map();
let virtualBalance = 0; // initialized from --paper-balance in main()
let virtualMarginUsed = 0; // total margin currently deployed in virtual positions
let initialCapital = 0; // starting balance (paper or real) — set in main() after prompt/fetch

// Track which coins we have open positions for
const heldCoins = new Set<string>();

// Track entry signal per coin for database logging, exit labeling, and ML training data
const entrySignals: Map<string, { rule: string; strategy: string; reason: string; confidence: number; entryPrice: number; size: number; ind1hFlat?: Record<string, number | string>; tradeId?: string | null }> = new Map();

// ML retrain tracking
let liveTradesSinceRetrain = 0;
// Ensure ML data directory exists (for live training data writes)
mkdirSync(resolve(ML_DIR, "data"), { recursive: true });
const tradelogUser = AGENT_NAME;

// Per-rule win/loss tracking for style check-in suggestions
const ruleStats = new Map<string, { wins: number; losses: number }>();
// Per-rule PnL tracking for backtrade analysis
const pnlByRule = new Map<string, { wins: number; losses: number; totalPnl: number; totalTrades: number }>();

// Volatility tracking
const atrHistory: Map<string, number[]> = new Map(); // last 20 ATR readings per coin
type VolClass = "calm" | "normal" | "elevated" | "spike";
const coinVolClass: Map<string, VolClass> = new Map(); // latest classification per coin
let prevVolState: "normal" | "elevated" | "spike" = "normal";
let volSummary = ""; // summary string for ntfy
let sleepMultiplier = 1.0; // dynamic interval multiplier

// Near-miss tracking: trades we considered but didn't take
const nearMisses: NearMiss[] = [];
// ML scores for near-misses (keyed by miss.timestamp) — what the model would have said
const nearMissMLScores: Map<number, number | null> = new Map();
// Near-miss outcome tracking: price at time of miss → price later
const nearMissOutcomes: Array<{
  miss: NearMiss;
  priceAtMiss: number;
  priceLater: number;
  pnlPct: number;
  wouldHaveWon: boolean;
  checkedAt: number;
}> = [];

// Sentiment tracking (LunarCrush)
let prevSentiment: SentimentSnapshot[] = [];
let currentSentiment: SentimentSnapshot[] = [];
let sentimentSignals: SentimentSignal[] = [];
let sentimentAvailable = false; // set true after first successful fetch

// Dynamic coin discovery — coins added temporarily based on extreme sentiment
let dynamicCoins: Set<string> = new Set();

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  writeLog(msg);
}

function verbose(msg: string) {
  // Always write to log file; only print to console if --verbose
  writeLog(`  [verbose] ${msg}`);
  if (VERBOSE) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}]   ${msg}`);
  }
}

interface NtfyOpts {
  title: string;
  body: string;
  tags?: string;
  priority?: "default" | "high";
}

function identityPrefix(): string {
  const walletShort = accountAddress.slice(-6);
  const mode = DRY_RUN ? "Paper Trading" : "Hyperliquid REAL $";
  return `[${AGENT_NAME} · ${walletShort} · ${mode}]`;
}

async function notify(opts: NtfyOpts) {
  const fullBody = `${identityPrefix()}\n\n${opts.body}`;
  writeLog(`[ntfy${opts.priority === "high" ? " HIGH" : ""}] ${opts.title} | ${opts.body.replace(/\n/g, " ")}`);
  if (!NOTIFY) return;
  try {
    // HTTP headers must be ASCII — strip emoji from title
    const safeTitle = opts.title.replace(/[^\x20-\x7E]/g, "").trim();
    const headers: Record<string, string> = {
      "Markdown": "yes",
      "Title": safeTitle,
    };
    const ntfyToken = process.env.NTFY_TOKEN;
    if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
    if (opts.tags) headers["Tags"] = opts.tags;
    if (opts.priority) headers["Priority"] = opts.priority;
    const ntfyChannel = process.env.NTFY_CHANNEL ?? "my-trader";
    if (!ntfyChannel) { writeLog("[WARN] NTFY_CHANNEL not set, skipping notification"); return; }
    await fetch(`https://ntfy.sh/${ntfyChannel}`, {
      method: "POST",
      headers,
      body: fullBody,
    });
  } catch (e) {
    const errMsg = `ntfy send failed: ${e}`;
    writeLog(`[ERROR] ${errMsg}`);
    if (VERBOSE) console.error(errMsg);
  }
}

async function retry<T>(fn: () => Promise<T>, retries = 2, delayMs = 3000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const msg = `Retry ${attempt + 1}/${retries}: ${err}`;
      writeLog(`[RETRY] ${msg}`);
      if (VERBOSE) {
        const ts = new Date().toISOString().slice(11, 19);
        console.log(`[${ts}]   ${msg}`);
      }
      await sleep(delayMs);
    }
  }
  throw new Error("unreachable");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUsd(n: number): string {
  return n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

function formatRecord(): string {
  const total = sessionWins + sessionLosses;
  const winRate = total > 0 ? ` (${((sessionWins / total) * 100).toFixed(0)}% win rate)` : "";
  const contrTotal = sessionContrWins + sessionContrLosses;
  const contrStr = CONTRARIAN_PCT > 0 && contrTotal > 0
    ? ` | **Contrarian:** ${sessionContrWins}W-${sessionContrLosses}L`
    : "";
  return `${sessionWins}W-${sessionLosses}L${winRate}${contrStr}`;
}

function formatDeltaFromStart(current: number): string {
  if (initialCapital <= 0) return "";
  const d = current - initialCapital;
  const pct = (d / initialCapital) * 100;
  return `${d >= 0 ? "+" : ""}${pct.toFixed(2)}% (${formatUsd(d)})`;
}

// Balance cache — reset each cycle to avoid redundant API calls within a single cycle
let _balCache: { available: number; accountValue: number; marginUsed: number; spotTotal: number; perpValue: number } | null = null;
let _balCacheCycle = -1;

/** Get effective available balance — sums all spot + perp value. Cached within a cycle. */
async function getAvailableBalance(): Promise<{ available: number; accountValue: number; marginUsed: number; spotTotal: number; perpValue: number }> {
  if (_balCache && _balCacheCycle === cycleCount) return _balCache;
  const bal = await retry(() => getBalance(info, accountAddress));
  const perpWithdrawable = parseFloat(bal.perp.withdrawable);
  const perpAccountValue = parseFloat(bal.perp.accountValue);
  const perpMarginUsed = parseFloat(bal.perp.totalMarginUsed);

  // Sum all spot balances (USDC + any other tokens at face value)
  let spotTotal = 0;
  for (const b of bal.spot) {
    spotTotal += parseFloat(b.total);
  }

  // Unified account: perp withdrawable is unreliable (0 or tiny), use max of both approaches
  const available = Math.max(
    perpWithdrawable,
    spotTotal > 0 ? spotTotal - perpMarginUsed : 0,
  );
  // Total account = spot + perp (avoid double-counting on unified accounts)
  const accountValue = spotTotal > 0 && perpAccountValue > 0
    ? Math.max(spotTotal, spotTotal + perpAccountValue - perpMarginUsed)
    : spotTotal + perpAccountValue;

  const result = { available: Math.max(available, 0), accountValue, marginUsed: perpMarginUsed, spotTotal, perpValue: perpAccountValue };
  _balCache = result;
  _balCacheCycle = cycleCount;
  return result;
}

// ── Volatility Setup Prompt ──────────────────────────────────────────────────

async function promptVolatilitySetup(): Promise<boolean> {
  // Non-interactive (piped, background) → default to enabled
  if (!process.stdin.isTTY) {
    log("[VOL] Non-interactive session — volatility detection enabled by default");
    return true;
  }

  return new Promise((resolve) => {
    const rl = createReadline({ input: process.stdin, output: process.stdout });
    const timeout = setTimeout(() => {
      rl.close();
      console.log("\n  (auto-enabled after 15s)");
      resolve(true);
    }, 15_000);

    console.log("\n  Volatility detection tracks ATR spikes and automatically");
    console.log("  increases check frequency during high-volatility periods.");
    console.log("  Disable anytime with --no-vol-detect.\n");
    rl.question("  Enable volatility detection? [Y/n] ", (answer) => {
      clearTimeout(timeout);
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized !== "n" && normalized !== "no");
    });
  });
}

// ── Paper Balance Prompt ──────────────────────────────────────────────────────

async function promptPaperBalance(profileDefault?: number): Promise<number> {
  const fallback = profileDefault ?? 200;
  if (!process.stdin.isTTY) {
    console.log(`\n  Paper trading — starting capital: $${fallback}${profileDefault ? " (from profile)" : " (default)"}`);
    console.log("  Run with --help-me to change, or pass --paper-balance <$> to override.\n");
    return fallback;
  }
  return new Promise((resolve) => {
    const rl = createReadline({ input: process.stdin, output: process.stdout });
    const timeout = setTimeout(() => {
      rl.close();
      console.log(`\n  (using $${fallback} after 15s)`);
      resolve(fallback);
    }, 15_000);
    console.log("\n  Starting paper trading session.");
    rl.question(`  Starting capital? [$${fallback}] `, (answer) => {
      clearTimeout(timeout);
      rl.close();
      const parsed = parseFloat(answer.trim());
      resolve(isNaN(parsed) || parsed <= 0 ? fallback : parsed);
    });
  });
}

// ── Volatility Detection ─────────────────────────────────────────────────────

const ATR_HISTORY_SIZE = 20; // ~1h of data at 3min intervals

function updateVolatility(coin: string, atr: number): VolClass {
  let history = atrHistory.get(coin);
  if (!history) {
    history = [];
    atrHistory.set(coin, history);
  }
  history.push(atr);
  if (history.length > ATR_HISTORY_SIZE) history.shift();

  // Need enough history to compute a meaningful average
  if (history.length < 5) {
    coinVolClass.set(coin, "normal");
    return "normal";
  }

  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  const ratio = avg > 0 ? atr / avg : 1;

  let cls: VolClass;
  if (ratio > 2.5) cls = "spike";
  else if (ratio > 1.5) cls = "elevated";
  else if (ratio < 1.0) cls = "calm";
  else cls = "normal";

  verbose(`[VOL] ${coin}: ATR=${atr.toFixed(4)} avg=${avg.toFixed(4)} ratio=${ratio.toFixed(2)} → ${cls}`);
  coinVolClass.set(coin, cls);
  return cls;
}

async function assessMarketVolatility(): Promise<void> {
  const elevated: string[] = [];
  const spiked: string[] = [];

  for (const [coin, cls] of coinVolClass) {
    if (cls === "spike") spiked.push(coin);
    else if (cls === "elevated") elevated.push(coin);
  }

  const totalHot = elevated.length + spiked.length;

  // Determine market state
  let newState: "normal" | "elevated" | "spike";
  if (spiked.length > 0 || totalHot >= 3) {
    newState = "spike";
    sleepMultiplier = 0.33;
  } else if (totalHot > 0) {
    newState = "elevated";
    sleepMultiplier = 0.5;
  } else {
    newState = "normal";
    sleepMultiplier = 1.0;
  }

  // Build summary string for ntfy
  if (totalHot > 0) {
    const parts: string[] = [];
    if (spiked.length > 0) parts.push(`${spiked.length} spike (${spiked.join(",")})`);
    if (elevated.length > 0) parts.push(`${elevated.length} elevated (${elevated.join(",")})`);
    volSummary = `VOL: ${parts.join(", ")}`;
  } else {
    volSummary = "";
  }

  // Notify on state transitions
  if (newState !== prevVolState) {
    const effectiveInterval = (INTERVAL_MS * sleepMultiplier / 1000).toFixed(0);
    if (newState === "spike") {
      log(`[VOL] SPIKE — ${spiked.join(",")} spiking, ${elevated.join(",")} elevated → interval ${effectiveInterval}s`);
      await notify({
        title: `Volatility Spike — rapid monitoring`,
        tags: "zap,warning",
        priority: "default",
        body: `**Market volatility spiking!**\n\n${spiked.map(c => {
          const h = atrHistory.get(c);
          const ratio = h && h.length >= 5 ? (h[h.length - 1] / (h.reduce((a, b) => a + b, 0) / h.length)).toFixed(1) : "?";
          return `- **${c}** ATR ${ratio}x normal`;
        }).join("\n")}${elevated.length > 0 ? `\n\nAlso elevated: ${elevated.join(", ")}` : ""}\n\n_Interval → ${effectiveInterval}s for rapid exit checks._`,
      });
    } else if (newState === "elevated") {
      log(`[VOL] ELEVATED — ${elevated.join(",")} elevated → interval ${effectiveInterval}s`);
      await notify({
        title: `Volatility Rising — faster checks`,
        tags: "zap",
        body: `**Elevated volatility detected.**\n\n${elevated.map(c => {
          const h = atrHistory.get(c);
          const ratio = h && h.length >= 5 ? (h[h.length - 1] / (h.reduce((a, b) => a + b, 0) / h.length)).toFixed(1) : "?";
          return `- **${c}** ATR ${ratio}x normal`;
        }).join("\n")}\n\n_Interval → ${effectiveInterval}s._`,
      });
    } else {
      log(`[VOL] NORMAL — all coins calm/normal → interval ${effectiveInterval}s`);
      await notify({
        title: `Volatility Normal — back to standard`,
        tags: "leaves",
        body: `**Markets calmed down.** All coins back to normal volatility.\n\n_Interval → ${effectiveInterval}s._`,
      });
    }
    prevVolState = newState;
  }
}

// ── Doctor — Health Check ────────────────────────────────────────────────────

interface DoctorResult {
  check: string;
  status: "ok" | "fixed" | "warn" | "fail";
  message?: string;
}

function execPromise(cmd: string, args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((res, rej) => {
    execFile(cmd, args, {
      timeout: timeoutMs,
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin` },
    }, (err, stdout, stderr) => {
      if (err) rej(new Error(`${cmd} ${args.join(" ")}: ${err.message}${stderr ? ` | ${stderr.trim()}` : ""}`));
      else res(stdout);
    });
  });
}

async function runDoctor(isStartup: boolean): Promise<DoctorResult[]> {
  const results: DoctorResult[] = [];
  log(`[DOCTOR] Running ${isStartup ? "startup" : "hourly"} checks...`);

  // 1-3. Config checks
  // Config checks — log details locally but never expose key/token names in notifications
  if (!process.env.HYPERLIQUID_PRIVATE_KEY) {
    // Missing key is only fatal in live mode — paper/dry-run is fine without it
    const keyStatus = DRY_RUN ? "warn" : "fail";
    const keyMsg = DRY_RUN
      ? "No wallet key — paper trading only"
      : "Internal auth error — check config";
    results.push({ check: "Exchange auth", status: keyStatus, message: keyMsg });
    writeLog(`[DOCTOR DETAIL] HYPERLIQUID_PRIVATE_KEY not set in .env (mode: ${DRY_RUN ? "paper" : "live"})`);
  } else {
    results.push({ check: "Exchange auth", status: "ok" });
  }

  if (!process.env.HYPERLIQUID_ACCOUNT_ADDRESS && !opts.account) {
    results.push({ check: "Account config", status: "warn", message: "Using wallet fallback — may show $0 on unified accounts" });
    writeLog("[DOCTOR DETAIL] HYPERLIQUID_ACCOUNT_ADDRESS not set, falling back to wallet.address");
  } else {
    results.push({ check: "Account config", status: "ok" });
  }

  const ntfyChannel = process.env.NTFY_CHANNEL ?? "my-trader";
  if (!process.env.NTFY_TOKEN) {
    results.push({ check: "Notifications", status: "ok", message: `Sending to ntfy.sh/${ntfyChannel} (public, no auth — run ./start-erde to add a private channel)` });
    writeLog("[DOCTOR DETAIL] NTFY_TOKEN not set — using public channel");
  } else {
    results.push({ check: "Notifications", status: "ok", message: `Authenticated → ntfy.sh/${ntfyChannel}` });
  }

  // 4. Hyperliquid API reachable
  try {
    await retry(() => getMeta(info), 2, 2000);
    results.push({ check: "Hyperliquid API", status: "ok" });
  } catch (err) {
    results.push({ check: "Hyperliquid API", status: "fail", message: `Unreachable after retries: ${err}` });
  }

  // 5. Balance fetch
  try {
    await getAvailableBalance();
    results.push({ check: "Balance", status: "ok" });
  } catch (err) {
    results.push({ check: "Balance", status: "fail", message: `Cannot fetch balance: ${err}` });
  }

  // 6. Express server on port 3000
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch("http://localhost:3000/api/hl/trades/usernames", { signal: ctrl.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      results.push({ check: "Express server", status: "ok" });
    } else {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch {
    if (isStartup) {
      // Auto-fix: start server in background
      try {
        const child = spawn("npm", ["run", "server"], {
          cwd: projectRoot,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        log("[DOCTOR] Express server down — starting in background...");
        await sleep(3000);
        // Retry
        try {
          const ctrl2 = new AbortController();
          const timeout2 = setTimeout(() => ctrl2.abort(), 3000);
          await fetch("http://localhost:3000/api/hl/trades/usernames", { signal: ctrl2.signal });
          clearTimeout(timeout2);
          results.push({ check: "Express server", status: "fixed", message: "Was down — auto-started" });
        } catch {
          results.push({ check: "Express server", status: "warn", message: "Started but not responding yet — trade logging degraded" });
        }
      } catch (err) {
        results.push({ check: "Express server", status: "warn", message: `Failed to auto-start: ${err}` });
      }
    } else {
      results.push({ check: "Express server", status: "warn", message: "Not reachable — trade logging degraded" });
    }
  }

  // 7-8. Ollama binary + model (startup only — won't change at runtime)
  let ollamaAvailable = false;
  if (isStartup) {
    try {
      await execPromise("which", ["ollama"], 5000);
      ollamaAvailable = true;
      results.push({ check: "Ollama binary", status: "ok" });
    } catch {
      results.push({ check: "Ollama binary", status: "warn", message: "Not found in PATH — log analysis unavailable" });
    }
  }

  if (isStartup && ollamaAvailable) {
    try {
      const ollamaList = await execPromise("ollama", ["list"], 10_000);
      if (ollamaList.includes("llama3.2")) {
        results.push({ check: "Ollama model", status: "ok" });
      } else {
        // Auto-fix: pull the model
        if (isStartup) {
          try {
            log("[DOCTOR] Ollama model llama3.2 missing — pulling...");
            await execPromise("ollama", ["pull", "llama3.2"], 120_000);
            results.push({ check: "Ollama model", status: "fixed", message: "Pulled llama3.2" });
          } catch (err) {
            results.push({ check: "Ollama model", status: "warn", message: `Failed to pull llama3.2: ${err}` });
          }
        } else {
          results.push({ check: "Ollama model", status: "warn", message: "llama3.2 not found — log analysis degraded" });
        }
      }
    } catch {
      results.push({ check: "Ollama model", status: "warn", message: "Could not list models (Ollama not running?)" });
    }
  }

  // 9. Logs directory writable + process-logs.sh present
  try {
    mkdirSync(logsDir, { recursive: true });
    const testFile = resolve(logsDir, ".doctor-test");
    writeFileSync(testFile, "ok");
    unlinkSync(testFile);
    results.push({ check: "Logs directory", status: "ok" });
  } catch (err) {
    results.push({ check: "Logs directory", status: "warn", message: `Not writable: ${err}` });
  }

  if (isStartup) {
    if (existsSync(LOG_PROCESSOR_SCRIPT)) {
      results.push({ check: "Log processor script", status: "ok" });
    } else {
      results.push({ check: "Log processor script", status: "warn", message: "process-logs.sh not found in logs/ — Ollama log analysis unavailable (git clone includes it)" });
    }
  }

  // 10. Disk space > 500MB
  try {
    const dfOutput = await execPromise("df", ["-k", logsDir], 5000);
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const cols = lines[1].split(/\s+/);
      const availKB = parseInt(cols[3], 10);
      const availGB = availKB / 1024 / 1024;
      if (availGB < 150) {
        results.push({ check: "Disk space", status: "warn", message: `${availGB.toFixed(1)}GB free (< 150GB)` });
      } else {
        results.push({ check: "Disk space", status: "ok" });
      }
    }
  } catch {
    results.push({ check: "Disk space", status: "warn", message: "Could not check disk space" });
  }

  // 11. Claude CLI available (startup only — won't change at runtime)
  if (isStartup) {
    try {
      await execPromise("claude", ["--version"], 5000);
      results.push({ check: "Claude CLI", status: "ok" });
    } catch {
      results.push({ check: "Claude CLI", status: "warn", message: "claude CLI not found in PATH" });
    }
  }

  // 12. LunarCrush API key (advisory — sentiment is optional)
  if (!process.env.LUNARCRUSH_API_KEY) {
    results.push({ check: "LunarCrush API", status: "warn", message: "API key not set — sentiment data unavailable" });
    writeLog("[DOCTOR DETAIL] LUNARCRUSH_API_KEY not set in .env");
  } else {
    results.push({ check: "LunarCrush API", status: "ok" });
  }

  // 13a. ML: Model integrity — file present, metadata valid, not stale
  let mlSampleCount = 0;
  let mlModelPresent = false;
  try {
    if (!existsSync(MODEL_FILE)) {
      results.push({ check: "ML: Model", status: "ok", message: "Using built-in defaults — live model trains automatically as trades close" });
    } else {
      mlModelPresent = true;
      if (!existsSync(MODEL_META_FILE)) {
        results.push({ check: "ML: Model", status: "warn", message: "Model present but no training_meta.json — retrain to generate metadata" });
      } else {
        const meta = JSON.parse(readFileSync(MODEL_META_FILE, "utf8")) as { sampleCount: number; accuracy: number; lastTrainedAt: string; cvScores?: number[] };
        mlSampleCount = meta.sampleCount;
        const daysSinceTrain = (Date.now() - new Date(meta.lastTrainedAt).getTime()) / 86_400_000;
        const cvVariance = meta.cvScores
          ? Math.sqrt(meta.cvScores.reduce((s, v) => s + (v - meta.accuracy) ** 2, 0) / meta.cvScores.length)
          : null;
        const varianceNote = cvVariance !== null ? ` cv±${(cvVariance * 100).toFixed(1)}%` : "";
        if (meta.accuracy < 0.50) {
          results.push({ check: "ML: Model", status: "warn", message: `Accuracy ${(meta.accuracy * 100).toFixed(1)}% below chance — model may be noisy at ${meta.sampleCount} samples${varianceNote}` });
        } else if (daysSinceTrain > 30) {
          results.push({ check: "ML: Model", status: "warn", message: `Model is ${daysSinceTrain.toFixed(0)} days old — consider refreshing backtest data and retraining` });
        } else {
          results.push({ check: "ML: Model", status: "ok", message: `${meta.sampleCount} samples, acc=${(meta.accuracy * 100).toFixed(1)}%${varianceNote}, trained ${daysSinceTrain.toFixed(0)}d ago` });
        }
      }
    }
  } catch (err) {
    results.push({ check: "ML: Model", status: "warn", message: `Metadata read failed: ${err}` });
  }

  // 13b. ML: Scorer subprocess — spawn scorer.py and verify it returns a valid score (startup only — too expensive hourly)
  if (mlModelPresent && isStartup) {
    try {
      const t0 = Date.now();
      // Synthetic BTC R4-short input — representative of our most common entry
      const testSnapshot: IndicatorSnapshot = {
        coin: "BTC", interval: "1h", price: 50000,
        rsi: 44,
        macd: { macd: -0.002, signal: -0.001, histogram: -0.002 },
        bb: { upper: 51000, middle: 50000, lower: 49000, width: 0.04 },
        atr: 400,
        adx: { adx: 28, plusDI: 18, minusDI: 31 },
        regime: "trending",
      };
      const testResult = await scoreTrade({ coin: "BTC", side: "short", rule: "R4-trend", indicators: testSnapshot });
      const elapsed = Date.now() - t0;
      if (testResult.score === null) {
        const reason = testResult.error ?? "unknown";
        // ML is advisory — timeouts/errors are never fatal, agent trades on rule confidence alone
        results.push({ check: "ML: Scorer", status: "warn", message: `Subprocess returned null — ${reason} (${elapsed}ms). Agent will use rule confidence only.` });
      } else if (testResult.score < 0 || testResult.score > 1) {
        results.push({ check: "ML: Scorer", status: "warn", message: `Score out of range: ${testResult.score} — model may be corrupt, using rule confidence only` });
      } else {
        results.push({ check: "ML: Scorer", status: "ok", message: `score=${testResult.score.toFixed(3)} for synthetic R4-short (${elapsed}ms, ${testResult.modelSamples} samples)` });
      }
    } catch (err) {
      // Non-fatal — ML scorer errors should never prevent trading
      results.push({ check: "ML: Scorer", status: "warn", message: `Scorer subprocess threw: ${err}. Agent will use rule confidence only.` });
    }
  } else {
    results.push({ check: "ML: Scorer", status: "ok", message: "Using built-in defaults (no trained model yet)" });
  }

  // 13c. ML: Blend weight calibration — verify formula gives expected influence (startup only — pure math, never changes)
  if (isStartup) {
    const sampleCount = mlSampleCount || 0;
    const mlWeight = Math.min(sampleCount / 500, 0.6);
    // Spot-check: blendConfidence(0.7, {score: 0.6, modelSamples}) should equal 0.7*(1-w) + 0.6*w
    const ruleConf = 0.7;
    const mlScore = 0.6;
    const expected = ruleConf * (1 - mlWeight) + mlScore * mlWeight;
    const actual = blendConfidence(ruleConf, { score: mlScore, modelSamples: sampleCount });
    const delta = Math.abs(actual - expected);
    if (delta > 0.0001) {
      results.push({ check: "ML: Blend weight", status: "warn", message: `Blend formula mismatch: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)} — blendConfidence() may be broken` });
    } else if (sampleCount === 0) {
      results.push({ check: "ML: Blend weight", status: "ok", message: "0 samples — using built-in defaults + rule confidence (normal on first run)" });
    } else {
      const pct = (mlWeight * 100).toFixed(1);
      const samplesFor60 = Math.max(0, 500 - sampleCount);
      results.push({ check: "ML: Blend weight", status: "ok", message: `${pct}% ML / ${(100 - mlWeight * 100).toFixed(1)}% rule at ${sampleCount} samples. Needs ${samplesFor60} more for max 60% ML.` });
    }
  }

  // 13d. ML: Live training data — verify rows accumulate and have correct field shape
  try {
    if (!existsSync(LIVE_TRAIN_PATH)) {
      results.push({ check: "ML: Live data", status: "ok", message: "No live data yet — will accumulate as trades close (normal on first run)" });
    } else {
      const liveContent = readFileSync(LIVE_TRAIN_PATH, "utf8").trim();
      const liveLines = liveContent ? liveContent.split("\n").filter(Boolean) : [];
      const liveCount = liveLines.length;

      // Parse last 3 rows and validate required fields
      const required = ["coin", "side", "rule", "won", "adx", "rsi", "macd_histogram", "bb_width", "atr_pct", "regime"];
      const lastRows = liveLines.slice(-3);
      const badFields: string[] = [];
      for (const line of lastRows) {
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          const missing = required.filter(f => !(f in row));
          if (missing.length > 0) badFields.push(missing.join(","));
        } catch {
          badFields.push("parse_error");
        }
      }

      // Check staleness: how many live trades have accumulated since last retrain
      const pendingRetrain = liveTradesSinceRetrain;

      if (badFields.length > 0) {
        results.push({ check: "ML: Live data", status: "fail", message: `${liveCount} rows but last entries have missing fields: ${[...new Set(badFields)].join("; ")} — live training data is malformed` });
      } else if (pendingRetrain >= 20) {
        results.push({ check: "ML: Live data", status: "warn", message: `${liveCount} rows captured, but ${pendingRetrain} trades since last retrain — model is stale, retrain pending` });
      } else {
        const pendingNote = pendingRetrain > 0 ? `, ${pendingRetrain} since last retrain` : "";
        results.push({ check: "ML: Live data", status: "ok", message: `${liveCount} trade${liveCount !== 1 ? "s" : ""} captured, fields valid${pendingNote}` });
      }
    }
  } catch (err) {
    results.push({ check: "ML: Live data", status: "warn", message: `Live data check failed: ${err}` });
  }

  // Summarize
  const fails = results.filter(r => r.status === "fail");
  const warns = results.filter(r => r.status === "warn");
  const fixed = results.filter(r => r.status === "fixed");
  const oks = results.filter(r => r.status === "ok");

  if (fails.length === 0 && warns.length === 0 && fixed.length === 0) {
    log(`[DOCTOR] All ${results.length} checks passed`);
  } else {
    for (const r of results) {
      if (r.status !== "ok") {
        log(`[DOCTOR] ${r.status.toUpperCase()}: ${r.check} — ${r.message}`);
      }
    }

    // Build notification (only when something is wrong or fixed)
    const sections: string[] = [];
    if (fixed.length > 0) {
      sections.push(`**Auto-fixed:**\n${fixed.map(r => `- ${r.check} — ${r.message}`).join("\n")}`);
    }
    if (warns.length > 0) {
      sections.push(`**Needs attention:**\n${warns.map(r => `- ${r.check} — ${r.message}`).join("\n")}`);
    }
    if (fails.length > 0) {
      sections.push(`**Failed${isStartup ? " (startup blocked)" : ""}:**\n${fails.map(r => `- ${r.check} — ${r.message}`).join("\n")}`);
    }

    const issueCount = fails.length + warns.length + fixed.length;
    await notify({
      title: `Doctor Report — ${issueCount} issue${issueCount !== 1 ? "s" : ""}`,
      tags: "stethoscope,warning",
      priority: fails.length > 0 ? "high" : "default",
      body: sections.join("\n\n") + `\n\n_${oks.length}/${results.length} checks OK._`,
    });
  }

  return results;
}

// ── Core Loop ────────────────────────────────────────────────────────────────

async function adoptExistingPositions() {
  if (DRY_RUN) {
    log("[PAPER] Paper mode — starting with empty virtual positions");
    return;
  }
  const positions = await retry(() => getPositions(info, accountAddress));
  for (const pos of positions) {
    heldCoins.add(pos.coin);
    state.peakPnl.set(pos.coin, 0);
    state.entryTimes.set(pos.coin, Date.now());
    log(`[ADOPT] ${pos.coin} ${pos.side} size=${pos.szi} entry=${pos.entryPx} lev=${pos.leverage.value}x`);
  }
  return positions;
}

async function checkExits(
  positions: Position[],
  meta: { universe: MetaAsset[] },
) {
  for (const pos of positions) {
    try {
      const midStr = await retry(() => getMidPrice(info, pos.coin));
      const currentPrice = parseFloat(midStr);
      const entryPx = parseFloat(pos.entryPx);
      const szi = parseFloat(pos.szi);

      const ind1h = await retry(() => computeIndicators(pos.coin, "1h", opts.testnet));
      if (!ind1h) {
        verbose(`${pos.coin}: insufficient data for exit check`);
        continue;
      }

      // Track ATR for volatility detection
      if (VOL_DETECT) updateVolatility(pos.coin, ind1h.atr);

      verbose(`${pos.coin} exit check: price=${currentPrice.toFixed(2)} regime=${ind1h.regime} ADX=${ind1h.adx.adx.toFixed(1)} RSI=${ind1h.rsi.toFixed(1)}`);

      // Use tracked entry rule if available, otherwise infer from side
      const entryInfo = entrySignals.get(pos.coin);
      const entryRule = entryInfo?.rule ?? (pos.side === "long" ? "R3-trend" : "R4-trend");
      const isContrarian = contrarianPositions.has(pos.coin);

      // Contrarian positions use tighter exit thresholds — check before standard exits
      let exitSignal: ReturnType<typeof evaluateExitSignals> = null;
      if (isContrarian) {
        const notional = Math.abs(szi) * entryPx;
        const pnl = pos.side === "long"
          ? Math.abs(szi) * (currentPrice - entryPx)
          : Math.abs(szi) * (entryPx - currentPrice);
        const pnlPct = notional > 0 ? pnl / notional : 0;
        const prevPeak = state.peakPnl.get(pos.coin) ?? 0;
        if (pnl > prevPeak) state.peakPnl.set(pos.coin, pnl);
        const peakPnlPct = notional > 0 ? (state.peakPnl.get(pos.coin) ?? 0) / notional : 0;

        // Contrarian trailing stop: arm at +0.5%, trigger at +0.2%, cap at +1.5%
        if (peakPnlPct > CONTRARIAN_EXIT.trailArm && pnlPct < CONTRARIAN_EXIT.trailTrigger) {
          exitSignal = { rule: "EXIT-1-trailing-C", reason: `Contrarian trailing: peak ${(peakPnlPct * 100).toFixed(2)}%, now ${(pnlPct * 100).toFixed(2)}%` };
        } else if (pnlPct > CONTRARIAN_EXIT.takeProfitCap) {
          exitSignal = { rule: "EXIT-1-takeprofit-C", reason: `Contrarian take profit: ${(pnlPct * 100).toFixed(2)}% (cap ${(CONTRARIAN_EXIT.takeProfitCap * 100).toFixed(1)}%)` };
        }
        // Contrarian stop loss: -1.5%
        if (!exitSignal && pnlPct < CONTRARIAN_EXIT.stopLoss) {
          exitSignal = { rule: "EXIT-2-stoploss-C", reason: `Contrarian stop loss: ${(pnlPct * 100).toFixed(2)}%` };
        }
        // Contrarian time stop: 2 hours
        if (!exitSignal) {
          const entryTime = state.entryTimes.get(pos.coin);
          if (entryTime) {
            const hoursOpen = (Date.now() - entryTime) / 3_600_000;
            if (hoursOpen > CONTRARIAN_EXIT.timeStopHours && Math.abs(pnlPct) < 0.005) {
              exitSignal = { rule: "EXIT-4-timestop-C", reason: `Contrarian time stop: ${hoursOpen.toFixed(1)}h open, PnL ${(pnlPct * 100).toFixed(2)}% (flat)` };
            }
          }
        }
        // If no contrarian-specific exit, fall through to standard signal reversal checks
        if (!exitSignal) {
          exitSignal = evaluateExitSignals(
            { coin: pos.coin, side: pos.side, entryPx, szi, rule: entryRule },
            currentPrice,
            ind1h,
            state,
          );
        }
      } else {
        exitSignal = evaluateExitSignals(
          { coin: pos.coin, side: pos.side, entryPx, szi, rule: entryRule },
          currentPrice,
          ind1h,
          state,
        );
      }

      if (!exitSignal) {
        const pnl = pos.side === "long"
          ? Math.abs(szi) * (currentPrice - entryPx)
          : Math.abs(szi) * (entryPx - currentPrice);
        const notional = Math.abs(szi) * entryPx;
        const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;
        verbose(`${pos.coin} ${pos.side}: PnL=${formatUsd(pnl)} (${pnlPct.toFixed(2)}%) — hold`);
        continue;
      }

      // Close position
      const pnl = pos.side === "long"
        ? Math.abs(szi) * (currentPrice - entryPx)
        : Math.abs(szi) * (entryPx - currentPrice);
      const notional = Math.abs(szi) * entryPx;
      const pnlPct = notional > 0 ? (pnl / notional) * 100 : 0;

      log(`[EXIT] ${pos.coin} ${pos.side} — ${exitSignal.rule}: ${exitSignal.reason}`);
      log(`  PnL: ${formatUsd(pnl)} (${pnlPct.toFixed(2)}%) | entry=${entryPx} exit=${currentPrice} size=${Math.abs(szi)}`);

      if (!DRY_RUN) {
        // Cancel any TP/SL trigger orders before closing to avoid orphaned orders
        await cancelOpenOrders(exchange!, info, accountAddress, pos.coin).catch(e =>
          writeLog(`[WARN] Cancel TP/SL failed for ${pos.coin}: ${e}`)
        );
        await retry(() => closePosition(exchange!, info, accountAddress, pos.coin));
        log(`  Position closed on exchange`);
      } else {
        // Paper trading: remove virtual position and credit P&L to balance
        const paperMargin = Math.abs(szi) * entryPx / LEVERAGE;
        virtualPositions.delete(pos.coin);
        virtualMarginUsed = Math.max(0, virtualMarginUsed - paperMargin);
        virtualBalance += pnl;
        log(`  [PAPER] Closed ${pos.coin}. PnL ${formatUsd(pnl)}. Balance: $${virtualBalance.toFixed(2)} (avail $${(virtualBalance - virtualMarginUsed).toFixed(2)})`);
      }

      // Log close to backend database for visualization (non-fatal)
      const exitComment = `${exitSignal.rule}: ${exitSignal.reason} | entry via ${entryRule}${entryInfo ? ` [${entryInfo.strategy}]` : ""} | PnL ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% (${formatUsd(pnl)})`;
      try {
        await logTradeClose({
          username: tradelogUser,
          tradeId: entryInfo?.tradeId,
          coin: pos.coin,
          side: pos.side,
          exitPrice: currentPrice,
          realizedPnl: pnl,
          comment: exitComment,
        });
        verbose(`Logged trade close to backend: ${pos.coin} ${pos.side}`);
      } catch (e) {
        writeLog(`[TRADELOG WARN] Failed to log close: ${e}`);
      }

      // ML training data append — independent of backend, runs for both paper + real
      const flat = entryInfo?.ind1hFlat;
      if (flat) {
        const coinSent = currentSentiment.find(s => s.coin === pos.coin);
        const mlRow = JSON.stringify({
          coin: pos.coin,
          side: pos.side,
          rule: entryRule,
          won: pnl >= 0 ? 1 : 0,
          pnl,
          source: DRY_RUN ? "paper" : "live",
          ...flat,
          galaxy_score: coinSent?.galaxyScore ?? 0,
          sentiment_pct: coinSent?.sentiment ?? 50,
          alt_rank: coinSent?.altRank ?? 500,
        }) + "\n";
        try {
          appendFileSync(LIVE_TRAIN_PATH, mlRow);
          liveTradesSinceRetrain++;
          verbose(`[ML] Appended ${DRY_RUN ? "paper" : "live"} training row for ${pos.coin} (total since retrain: ${liveTradesSinceRetrain})`);
        } catch (mlErr) {
          writeLog(`[ML WARN] Failed to append training data: ${mlErr}`);
        }
      }

      totalRealizedPnl += pnl;
      heldCoins.delete(pos.coin);
      state.peakPnl.delete(pos.coin);
      state.entryTimes.delete(pos.coin);
      entrySignals.delete(pos.coin);

      const isWin = pnl >= 0;
      if (isContrarian) {
        if (isWin) sessionContrWins++; else sessionContrLosses++;
        contrarianPositions.delete(pos.coin);
      }
      if (isWin) sessionWins++; else sessionLosses++;
      const ruleKey = entryInfo?.rule ?? (pos.side === "long" ? "R3-trend" : "R4-trend");
      const rs = ruleStats.get(ruleKey) ?? { wins: 0, losses: 0 };
      if (isWin) rs.wins++; else rs.losses++;
      ruleStats.set(ruleKey, rs);
      const pr = pnlByRule.get(ruleKey) ?? { wins: 0, losses: 0, totalPnl: 0, totalTrades: 0 };
      pr.totalTrades++; pr.totalPnl += pnl;
      if (isWin) pr.wins++; else pr.losses++;
      pnlByRule.set(ruleKey, pr);
      const emoji = isWin ? "🟢" : "🔴";
      const resultWord = isWin ? "Win" : "Loss";
      await notify({
        title: `${pos.coin} ${pos.side} closed — ${emoji} ${resultWord}`,
        tags: isWin ? "white_check_mark,moneybag" : (pnl < -10 ? "rotating_light,money_with_wings" : "x,money_with_wings"),
        priority: pnl < -10 ? "high" : "default",
        body: `**${exitSignal.rule}**\n\n- **Coin:** ${pos.coin} ${pos.side}\n- **Entry:** $${entryPx} (${entryRule})\n- **Exit:** $${currentPrice} (${exitSignal.rule})\n- **PnL:** ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% (${formatUsd(pnl)})\n- **Result:** ${emoji} ${resultWord}\n\n_${heldCoins.size} positions remaining._`,
      });
    } catch (err) {
      const errMsg = `Exit check failed for ${pos.coin}: ${err}`;
      log(`[ERROR] ${errMsg}`);
      writeLog(`[ERROR STACK] ${err instanceof Error ? err.stack : String(err)}`);
    }
  }
}

async function checkEntries(meta: { universe: MetaAsset[] }) {
  if (heldCoins.size >= MAX_POSITIONS) {
    verbose(`Max positions reached (${heldCoins.size}/${MAX_POSITIONS})`);
    return;
  }

  const available = DRY_RUN
    ? Math.max(0, virtualBalance - virtualMarginUsed)
    : (await getAvailableBalance()).available;
  if (DRY_RUN) {
    verbose(`[PAPER] Available: $${available.toFixed(2)} (balance $${virtualBalance.toFixed(2)} − margin $${virtualMarginUsed.toFixed(2)})`);
  } else {
    verbose(`Available balance: $${available.toFixed(2)}`);
  }

  if (available < 20) {
    verbose(`Balance too low for new entries: $${available.toFixed(2)}`);
    return;
  }

  let bestSignal: Signal | null = null;
  let bestInd1h: IndicatorSnapshot | null = null;
  let bestMlScore: number | null = null; // raw ML score for the winning signal (before blending)

  // Scan base coins + any dynamically discovered sentiment coins
  const scanCoins = [...COINS, ...dynamicCoins.values()].filter((c, i, arr) => arr.indexOf(c) === i);
  for (const coin of scanCoins) {
    if (heldCoins.has(coin)) continue;
    if (heldCoins.size >= MAX_POSITIONS) break;

    try {
      const ind1h = await retry(() => computeIndicators(coin, "1h", opts.testnet));
      if (!ind1h) {
        verbose(`${coin}: insufficient 1h data`);
        continue;
      }

      // Track ATR for volatility detection
      if (VOL_DETECT) updateVolatility(coin, ind1h.atr);

      let ind15m: IndicatorSnapshot | null = null;
      try {
        ind15m = await retry(() => computeIndicators(coin, "15m", opts.testnet));
      } catch {
        verbose(`${coin}: 15m data unavailable, using 1h only`);
      }

      verbose(`${coin}: regime=${ind1h.regime} ADX=${ind1h.adx.adx.toFixed(1)} RSI=${ind1h.rsi.toFixed(1)} +DI=${ind1h.adx.plusDI.toFixed(1)} -DI=${ind1h.adx.minusDI.toFixed(1)} MACD_hist=${ind1h.macd.histogram.toFixed(4)} BB_width=${ind1h.bb.width.toFixed(4)}`);

      let signal = evaluateEntrySignals(ind1h, ind15m, coin, state);

      // Sentiment-assisted R3: if no signal fires but strong bullish sentiment + nearly-qualifying R3
      // Accept RSI 40-45 when sentiment is strongly bullish (galaxy>70 or sentiment>=80%)
      if (!signal && sentimentAvailable) {
        const coinSent = currentSentiment.find(s => s.coin === coin);
        const strongBullish = coinSent && (coinSent.galaxyScore > 70 || coinSent.sentiment >= 80);
        if (strongBullish &&
            (ind1h.regime === "trending" || ind1h.regime === "volatile_trend") &&
            ind1h.adx.adx > 25 && ind1h.adx.plusDI > ind1h.adx.minusDI &&
            ind1h.rsi > 40 && ind1h.rsi <= 45 && ind1h.macd.histogram > 0) {
          signal = {
            coin,
            side: "long",
            rule: "R3-trend",
            strategy: "trend",
            confidence: 0.55, // lower base confidence for sentiment-assisted entry
            reason: `Sentiment-assisted R3: RSI ${ind1h.rsi.toFixed(1)} (relaxed from 45 due to sentiment=${coinSent!.sentiment}% galaxy=${coinSent!.galaxyScore})`,
          };
          verbose(`${coin}: SENTIMENT-ASSISTED R3 — RSI ${ind1h.rsi.toFixed(1)} accepted (galaxy=${coinSent!.galaxyScore}, sent=${coinSent!.sentiment}%)`);
        }
      }

      // R6: Sentiment-Confirmed entry — extreme sentiment + technical lean (below R3/R4 thresholds)
      // Near-miss data: 61% of sentiment-only signals were winners. Takes half-size positions.
      if (!signal && sentimentAvailable) {
        const coinSent = currentSentiment.find(s => s.coin === coin);
        if (coinSent) {
          const extremeBullish = coinSent.galaxyScore > 75 && coinSent.sentiment >= 85;
          const extremeBearish = coinSent.galaxyScore < 30 || coinSent.sentiment <= 15;

          // Bullish R6: extreme bullish sentiment + DI points up + RSI > 40
          if (extremeBullish && ind1h.adx.plusDI > ind1h.adx.minusDI && ind1h.rsi > 40 && ind1h.rsi < 65) {
            signal = {
              coin,
              side: "long",
              rule: "R6-sentiment",
              strategy: "sentiment-confirmed",
              confidence: 0.52, // just above 0.5 threshold — sentiment-only is speculative
              reason: `R6 sentiment-confirmed long: galaxy=${coinSent.galaxyScore} sentiment=${coinSent.sentiment}% +DI>${ind1h.adx.plusDI.toFixed(1)} RSI=${ind1h.rsi.toFixed(1)}`,
            };
            verbose(`${coin}: R6 SENTIMENT LONG — galaxy=${coinSent.galaxyScore} sent=${coinSent.sentiment}% DI=+${ind1h.adx.plusDI.toFixed(1)}`);
          }

          // Bearish R6: extreme bearish sentiment + DI points down + RSI < 60
          if (!signal && extremeBearish && ind1h.adx.minusDI > ind1h.adx.plusDI && ind1h.rsi > 35 && ind1h.rsi < 60) {
            signal = {
              coin,
              side: "short",
              rule: "R6-sentiment",
              strategy: "sentiment-confirmed",
              confidence: 0.52,
              reason: `R6 sentiment-confirmed short: galaxy=${coinSent.galaxyScore} sentiment=${coinSent.sentiment}% -DI>${ind1h.adx.minusDI.toFixed(1)} RSI=${ind1h.rsi.toFixed(1)}`,
            };
            verbose(`${coin}: R6 SENTIMENT SHORT — galaxy=${coinSent.galaxyScore} sent=${coinSent.sentiment}% DI=-${ind1h.adx.minusDI.toFixed(1)}`);
          }
        }
      }

      if (!signal) {
        // Detect near-misses: trades that almost triggered
        const misses = detectNearMisses(ind1h, coin);
        // ML score once per coin+side (avoid spawning duplicate Python processes for same indicators)
        const mlScoreCache = new Map<string, number | null>();
        for (const miss of misses) {
          nearMisses.push(miss);
          const mlKey = `${coin}:${miss.side}`;
          let mlScore = mlScoreCache.get(mlKey);
          if (mlScore === undefined) {
            // First miss for this coin+side — score it
            try {
              const missML = await scoreTrade({ coin, side: miss.side, rule: miss.rule, indicators: ind1h, sentiment: currentSentiment.find(s => s.coin === coin) });
              mlScore = missML.score;
              mlScoreCache.set(mlKey, mlScore);
            } catch {
              mlScore = null;
              mlScoreCache.set(mlKey, null);
            }
          }
          if (mlScore !== null) {
            nearMissMLScores.set(miss.timestamp, mlScore);
            const mlNote = mlScore > 0.55 ? ` ⚠️ ML=${mlScore.toFixed(2)} (model would enter)` : ` ML=${mlScore.toFixed(2)}`;
            verbose(`${coin}: NEAR-MISS ${miss.rule} ${miss.side} — ${miss.reason} [blocked: ${miss.blockedBy}]${mlNote}`);
            writeLog(`[NEAR-MISS] ${coin} ${miss.rule} ${miss.side} @ $${miss.price.toFixed(4)} — ${miss.reason} | blocked: ${miss.blockedBy} | ML=${mlScore.toFixed(3)}`);
          } else {
            verbose(`${coin}: NEAR-MISS ${miss.rule} ${miss.side} — ${miss.reason} [blocked: ${miss.blockedBy}]`);
            writeLog(`[NEAR-MISS] ${coin} ${miss.rule} ${miss.side} @ $${miss.price.toFixed(4)} — ${miss.reason} | blocked: ${miss.blockedBy}`);
          }
        }
        // Track sentiment-only signals as near-misses when no technical signal fires
        if (sentimentAvailable) {
          const coinSentSigs = sentimentSignals.filter((s) => s.coin === coin && s.type !== "alert");
          for (const sentSig of coinSentSigs) {
            const sentSide = sentSig.type === "bullish" ? "long" as const : "short" as const;
            nearMisses.push({
              coin,
              side: sentSide,
              rule: `SENTIMENT-${sentSig.type}`,
              price: ind1h.price,
              timestamp: Date.now(),
              reason: sentSig.reason,
              blockedBy: "No technical signal",
              indicators: {
                adx: ind1h.adx.adx, plusDI: ind1h.adx.plusDI, minusDI: ind1h.adx.minusDI,
                rsi: ind1h.rsi, macdHist: ind1h.macd.histogram, regime: ind1h.regime, bbWidth: ind1h.bb.width,
              },
            });
            verbose(`${coin}: SENTIMENT NEAR-MISS ${sentSig.type} ${sentSig.strength} — ${sentSig.reason}`);
          }
        }
        if (misses.length === 0) verbose(`${coin}: no signal`);
        continue;
      }

      // Boost confidence if sentiment aligns with the technical signal
      if (sentimentAvailable) {
        const coinSentiment = currentSentiment.find((s) => s.coin === coin);
        const coinSentSigs = sentimentSignals.filter((s) => s.coin === coin);
        if (coinSentiment) {
          // Bullish sentiment aligns with long signal
          if (signal.side === "long" && coinSentSigs.some((s) => s.type === "bullish" && s.strength === "strong")) {
            signal.confidence = Math.min(signal.confidence + 0.1, 1);
            signal.reason += ` | sentiment boost (galaxy=${coinSentiment.galaxyScore}, ${coinSentiment.sentiment}% positive)`;
            verbose(`${coin}: sentiment boost +0.1 (strong bullish sentiment)`);
          } else if (signal.side === "long" && coinSentSigs.some((s) => s.type === "bullish")) {
            signal.confidence = Math.min(signal.confidence + 0.05, 1);
            signal.reason += ` | sentiment nudge (galaxy=${coinSentiment.galaxyScore})`;
            verbose(`${coin}: sentiment nudge +0.05 (moderate bullish sentiment)`);
          }
          // Bearish sentiment aligns with short signal
          if (signal.side === "short" && coinSentSigs.some((s) => s.type === "bearish" && s.strength === "strong")) {
            signal.confidence = Math.min(signal.confidence + 0.1, 1);
            signal.reason += ` | sentiment boost (galaxy crashed to ${coinSentiment.galaxyScore})`;
            verbose(`${coin}: sentiment boost +0.1 (strong bearish sentiment)`);
          } else if (signal.side === "short" && coinSentSigs.some((s) => s.type === "bearish")) {
            signal.confidence = Math.min(signal.confidence + 0.05, 1);
            signal.reason += ` | sentiment nudge (bearish)`;
            verbose(`${coin}: sentiment nudge +0.05 (moderate bearish sentiment)`);
          }
        }
      }

      // Contrarian mode: flip signal when sentiment is extreme + RSI stretched
      if (CONTRARIAN_PCT > 0 && signal && sentimentAvailable) {
        const coinSent = currentSentiment.find(s => s.coin === coin);
        if (coinSent) {
          const isEuphoria = coinSent.sentiment >= 85;
          const isPanic = coinSent.sentiment > 0 && coinSent.sentiment <= 20;
          const rsiStretched = (signal.side === "long" && ind1h.rsi >= 65) ||
                               (signal.side === "short" && ind1h.rsi <= 35);

          if ((isEuphoria || isPanic) && rsiStretched && Math.random() < CONTRARIAN_PCT / 100) {
            if (contrarianPositions.size < MAX_CONTRARIAN_POS) {
              const origSide = signal.side;
              const origRule = signal.rule;
              signal.side = signal.side === "long" ? "short" : "long";
              signal.rule = `C-${signal.rule}`;
              signal.strategy = "contrarian";
              signal.confidence *= 0.6;
              signal.reason = `CONTRARIAN: ${signal.reason} | sentiment=${coinSent.sentiment}% RSI=${ind1h.rsi.toFixed(1)}`;
              verbose(`${coin}: CONTRARIAN FLIP ${origRule} ${origSide} → ${signal.rule} ${signal.side} (confidence ${signal.confidence.toFixed(2)})`);

              // Check minimum confidence after discount
              if (signal.confidence < 0.4) {
                verbose(`${coin}: contrarian confidence ${signal.confidence.toFixed(2)} below 0.4 — skipping`);
                // Log as contrarian near-miss
                nearMisses.push({
                  coin, side: signal.side, rule: signal.rule, price: ind1h.price,
                  timestamp: Date.now(), reason: signal.reason,
                  blockedBy: `Contrarian confidence ${signal.confidence.toFixed(2)} < 0.4`,
                  indicators: { adx: ind1h.adx.adx, plusDI: ind1h.adx.plusDI, minusDI: ind1h.adx.minusDI,
                    rsi: ind1h.rsi, macdHist: ind1h.macd.histogram, regime: ind1h.regime, bbWidth: ind1h.bb.width },
                });
                continue;
              }
            } else {
              verbose(`${coin}: contrarian slot full (${contrarianPositions.size}/${MAX_CONTRARIAN_POS})`);
            }
          }
        }
      }

      verbose(`${coin}: SIGNAL ${signal.rule} ${signal.side} confidence=${signal.confidence.toFixed(2)} — ${signal.reason}`);

      // ML confidence scoring — blend rule confidence with empirical win probability
      // Non-blocking: 3s timeout, falls back to rule confidence if model unavailable
      let coinMlScore: number | null = null;
      try {
        const mlResult = await scoreTrade({
          coin,
          side: signal.side,
          rule: signal.rule,
          indicators: ind1h,
          sentiment: currentSentiment.find(s => s.coin === coin),
        });
        if (mlResult.score !== null) {
          coinMlScore = mlResult.score;
          const prevConf = signal.confidence;
          signal.confidence = blendConfidence(signal.confidence, mlResult);
          verbose(`${coin}: ML=${mlResult.score.toFixed(3)} samples=${mlResult.modelSamples} → conf ${prevConf.toFixed(2)} → ${signal.confidence.toFixed(2)}`);
        }
      } catch (err) {
        writeLog(`[ML WARN] scoreTrade failed for ${coin}: ${err}`);
      }

      if (!bestSignal || signal.confidence > bestSignal.confidence) {
        bestSignal = signal;
        bestInd1h = ind1h;
        bestMlScore = coinMlScore;
      }
    } catch (err) {
      const errMsg = `Entry scan failed for ${coin}: ${err}`;
      log(`[ERROR] ${errMsg}`);
      writeLog(`[ERROR STACK] ${err instanceof Error ? err.stack : String(err)}`);
    }
  }

  if (!bestSignal || !bestInd1h) {
    verbose("No viable entry signals this cycle");
    return;
  }

  // Position sizing
  const asset = meta.universe.find((a) => a.name === bestSignal!.coin);
  const szDecimals = asset?.szDecimals ?? 4;
  const sizing = computePositionSize(
    available,
    bestSignal,
    bestInd1h.price,
    LEVERAGE,
    MAX_ALLOC_PCT,
    szDecimals,
  );

  if (!sizing) {
    verbose(`${bestSignal.coin}: position too small (notional < $10)`);
    return;
  }

  // Preflight: balance sufficient, notional > $10, balance > $20
  const marginNeeded = sizing.notional / LEVERAGE;
  if (marginNeeded > available * (MAX_ALLOC_PCT / 100) * 1.1) {
    verbose(`${bestSignal.coin}: margin $${marginNeeded.toFixed(2)} exceeds ${MAX_ALLOC_PCT}% allocation of $${available.toFixed(2)}`);
    return;
  }

  log(`[ENTRY] ${bestSignal.coin} ${bestSignal.side} — ${bestSignal.rule} (confidence: ${bestSignal.confidence.toFixed(2)})`);
  log(`  Size: ${sizing.size} @ ~$${bestInd1h.price.toFixed(2)} (notional: $${sizing.notional.toFixed(2)}, margin: $${marginNeeded.toFixed(2)}, ${LEVERAGE}x)`);
  log(`  Reason: ${bestSignal.reason}`);

  // Clamp leverage to coin's max
  const coinMaxLev = asset?.maxLeverage ?? LEVERAGE;
  const effectiveLev = Math.min(LEVERAGE, coinMaxLev);
  if (effectiveLev < LEVERAGE) {
    verbose(`${bestSignal.coin}: clamping leverage ${LEVERAGE}x → ${effectiveLev}x (coin max)`);
  }

  // Compute exchange-level TP/SL as safety net (agent still manages exits actively)
  const isContrEntry = bestSignal.strategy === "contrarian";
  const isSentEntry = bestSignal.strategy === "sentiment-confirmed";
  const VOLATILE_COINS_SET = new Set(["MOODENG", "TAO", "HYPE", "WIF", "POPCAT", "DOGE", "SUI"]);
  const isVolEntry = VOLATILE_COINS_SET.has(bestSignal.coin);
  const isR3LongEntry = bestSignal.rule.includes("R3") && bestSignal.side === "long";
  let tpslConfig: TpSlConfig;
  if (isContrEntry) {
    tpslConfig = { takeProfitPct: CONTRARIAN_EXIT.takeProfitCap, stopLossPct: CONTRARIAN_EXIT.stopLoss };
  } else if (isSentEntry) {
    tpslConfig = { takeProfitPct: isVolEntry ? 0.03 : 0.02, stopLossPct: -0.015 }; // R6: tighter stops
  } else if (isR3LongEntry) {
    tpslConfig = { takeProfitPct: isVolEntry ? 0.05 : 0.03, stopLossPct: -0.015 }; // R3-long: tighter stop
  } else {
    tpslConfig = { takeProfitPct: isVolEntry ? 0.05 : 0.03, stopLossPct: -0.02 }; // R4/others: wider trailing + stop
  }
  log(`  TP/SL: take-profit ${(tpslConfig.takeProfitPct * 100).toFixed(1)}%, stop-loss ${(tpslConfig.stopLossPct * 100).toFixed(1)}%`);

  if (!DRY_RUN) {
    try {
      const result = await retry(() =>
        placeMarketOrder(
          exchange!,
          info,
          bestSignal!.coin,
          bestSignal!.side,
          sizing!.size,
          effectiveLev,
          50, // slippage bps
          tpslConfig,
        ),
      );
      heldCoins.add(bestSignal.coin);
      state.peakPnl.set(bestSignal.coin, 0);
      state.entryTimes.set(bestSignal.coin, Date.now());
      entrySignals.set(bestSignal.coin, {
        rule: bestSignal.rule,
        strategy: bestSignal.strategy,
        reason: bestSignal.reason,
        confidence: bestSignal.confidence,
        entryPrice: bestInd1h!.price,
        size: sizing!.size,
        ind1hFlat: flatIndicatorFields(bestInd1h!),
      });
      if (bestSignal.strategy === "contrarian") contrarianPositions.add(bestSignal.coin);
      log(`  Order placed successfully`);
      writeLog(`[ORDER RESULT] ${JSON.stringify(result)}`);

      // Log to backend database for visualization
      const res = result as { response?: { data?: { statuses?: Array<{ filled?: { oid?: number; tid?: number } }> } } };
      const filled = res?.response?.data?.statuses?.[0]?.filled;
      try {
        const openedTradeId = await logTradeOpen({
          username: tradelogUser,
          sessionId: AGENT_NAME,
          mode: "live",
          marketplace: "hyperliquid",
          coin: bestSignal.coin,
          side: bestSignal.side,
          entryPrice: bestInd1h!.price,
          size: sizing!.size,
          leverage: effectiveLev,
          strategyReason: `${bestSignal.rule} [${bestSignal.strategy}]`,
          orderId: filled?.oid != null ? String(filled.oid) : undefined,
          tid: filled?.tid != null ? String(filled.tid) : undefined,
          comment: `${bestSignal.reason} | confidence=${bestSignal.confidence.toFixed(2)} | regime=${bestInd1h!.regime} ADX=${bestInd1h!.adx.adx.toFixed(1)} RSI=${bestInd1h!.rsi.toFixed(1)}`,
          indicatorsJson: JSON.stringify(flatIndicatorFields(bestInd1h!)),
        });
        // Store tradeId for clean close (avoids coin+side matching)
        const sig = entrySignals.get(bestSignal.coin);
        if (sig) sig.tradeId = openedTradeId;
        verbose(`Logged trade open to backend: ${bestSignal.coin} ${bestSignal.side} (id=${openedTradeId})`);
      } catch (e) {
        writeLog(`[TRADELOG WARN] Failed to log open: ${e}`);
      }

      const sideEmoji = bestSignal.side === "long" ? "📈" : "📉";
      const mlLine = bestMlScore !== null ? `\n- **ML score:** ${bestMlScore.toFixed(3)} → blended conf ${bestSignal.confidence.toFixed(2)}` : "";
      await notify({
        title: `${bestSignal.coin} ${bestSignal.side.toUpperCase()} ${sideEmoji} — ${bestSignal.rule}`,
        tags: bestSignal.side === "long" ? "chart_with_upwards_trend,loudspeaker" : "chart_with_downwards_trend,loudspeaker",
        body: `**New position!**\n\n- **Coin:** ${bestSignal.coin}\n- **Side:** ${bestSignal.side.toUpperCase()} ${sideEmoji}\n- **Size:** ${sizing!.size} @ $${bestInd1h!.price.toFixed(4)}\n- **Notional:** $${sizing!.notional.toFixed(0)} (${LEVERAGE}x)\n- **Rule:** ${bestSignal.rule} (confidence ${bestSignal.confidence.toFixed(2)})${mlLine}\n- **Why:** ${bestSignal.reason}\n\n_Now at ${heldCoins.size} positions._`,
      });
    } catch (err) {
      const errMsg = `Order failed for ${bestSignal.coin} ${bestSignal.side}: ${err}`;
      log(`[ERROR] ${errMsg}`);
      writeLog(`[ERROR STACK] ${err instanceof Error ? err.stack : String(err)}`);
      await notify({ title: `Order Failed — ${bestSignal.coin} ${bestSignal.side}`, tags: "warning,x", priority: "high", body: `**Order rejected!**\n\n- **Coin:** ${bestSignal.coin} ${bestSignal.side}\n- **Size:** ${sizing.size}\n- **Error:** ${err}\n\n_Will retry next cycle._` });
    }
  } else {
    // Paper trading: simulate the position in memory
    const paperMargin = sizing.notional / effectiveLev;
    const paperSzi = bestSignal.side === "long" ? String(sizing.size) : String(-sizing.size);
    virtualPositions.set(bestSignal.coin, {
      coin: bestSignal.coin,
      side: bestSignal.side,
      szi: paperSzi,
      entryPx: String(bestInd1h.price),
      leverage: { value: effectiveLev },
    });
    virtualMarginUsed += paperMargin;
    log(`  [PAPER] Opened ${bestSignal.side} ${sizing.size} ${bestSignal.coin} @ $${bestInd1h.price.toFixed(4)} (margin $${paperMargin.toFixed(2)}). Available: $${(virtualBalance - virtualMarginUsed).toFixed(2)}`);
    heldCoins.add(bestSignal.coin);
    state.peakPnl.set(bestSignal.coin, 0);
    state.entryTimes.set(bestSignal.coin, Date.now());

    // Log paper trade to backend for visualization
    let paperTradeId: string | null = null;
    try {
      paperTradeId = await logTradeOpen({
        username: tradelogUser,
        sessionId: AGENT_NAME,
        mode: "simulated",
        marketplace: "hyperliquid",
        coin: bestSignal.coin,
        side: bestSignal.side,
        entryPrice: bestInd1h.price,
        size: sizing.size,
        leverage: effectiveLev,
        strategyReason: `${bestSignal.rule} [${bestSignal.strategy}]`,
        comment: `PAPER: ${bestSignal.reason} | confidence=${bestSignal.confidence.toFixed(2)} | regime=${bestInd1h.regime} ADX=${bestInd1h.adx.adx.toFixed(1)} RSI=${bestInd1h.rsi.toFixed(1)}`,
        indicatorsJson: JSON.stringify(flatIndicatorFields(bestInd1h)),
      });
      verbose(`Logged paper trade open to backend: ${bestSignal.coin} ${bestSignal.side} (id=${paperTradeId})`);
    } catch (e) {
      writeLog(`[TRADELOG WARN] Failed to log paper open: ${e}`);
    }

    entrySignals.set(bestSignal.coin, {
      rule: bestSignal.rule,
      strategy: bestSignal.strategy,
      reason: bestSignal.reason,
      confidence: bestSignal.confidence,
      entryPrice: bestInd1h.price,
      size: sizing.size,
      ind1hFlat: flatIndicatorFields(bestInd1h),
      tradeId: paperTradeId,
    });
    if (bestSignal.strategy === "contrarian") contrarianPositions.add(bestSignal.coin);
    const drySideEmoji = bestSignal.side === "long" ? "📈" : "📉";
    const dryMlLine = bestMlScore !== null ? `\n- **ML score:** ${bestMlScore.toFixed(3)} → blended conf ${bestSignal.confidence.toFixed(2)}` : "";
    await notify({
      title: `PAPER: ${bestSignal.coin} ${bestSignal.side.toUpperCase()} ${drySideEmoji} — ${bestSignal.rule}`,
      tags: "test_tube,eyes",
      body: `**Simulated position opened**\n\n- **Coin:** ${bestSignal.coin} ${bestSignal.side.toUpperCase()} ${drySideEmoji}\n- **Size:** ${sizing.size} @ $${bestInd1h.price.toFixed(4)}\n- **Notional:** $${sizing.notional.toFixed(0)} (${effectiveLev}x)\n- **Rule:** ${bestSignal.rule} (confidence ${bestSignal.confidence.toFixed(2)})${dryMlLine}\n- **Why:** ${bestSignal.reason}\n- **Paper balance:** $${(virtualBalance - virtualMarginUsed).toFixed(2)} available\n\n_${heldCoins.size} virtual position(s). No real trade._`,
    });
  }
}

async function analyzeNearMisses() {
  if (nearMisses.length === 0) return;

  const now = Date.now();
  const ONE_HOUR = 3_600_000;
  // Only analyze near-misses that are at least 1 hour old and haven't been checked yet
  const checkedTimestamps = new Set(nearMissOutcomes.map((o) => o.miss.timestamp));
  const toCheck = nearMisses.filter(
    (m) => now - m.timestamp >= ONE_HOUR && !checkedTimestamps.has(m.timestamp),
  );

  if (toCheck.length === 0) return;

  log(`[NEAR-MISS ANALYSIS] Checking ${toCheck.length} near-misses from 1h+ ago`);
  let wins = 0;
  let losses = 0;
  const lessonCounts: Record<string, { wins: number; losses: number; blockers: string[] }> = {};

  for (const miss of toCheck) {
    try {
      const midStr = await retry(() => getMidPrice(info, miss.coin));
      const currentPrice = parseFloat(midStr);
      const pnlPct =
        miss.side === "long"
          ? ((currentPrice - miss.price) / miss.price) * 100
          : ((miss.price - currentPrice) / miss.price) * 100;
      const wouldHaveWon = pnlPct > 0;

      const mlScore = nearMissMLScores.get(miss.timestamp) ?? null;
      const mlAgreedWithSkip = mlScore !== null && mlScore < 0.5;
      const mlWouldEnter = mlScore !== null && mlScore > 0.5;
      const outcome = {
        miss,
        priceAtMiss: miss.price,
        priceLater: currentPrice,
        pnlPct,
        wouldHaveWon,
        checkedAt: now,
      };
      nearMissOutcomes.push(outcome);

      if (wouldHaveWon) wins++;
      else losses++;

      const key = `${miss.rule}-${miss.side}`;
      if (!lessonCounts[key]) lessonCounts[key] = { wins: 0, losses: 0, blockers: [] };
      lessonCounts[key][wouldHaveWon ? "wins" : "losses"]++;
      lessonCounts[key].blockers.push(miss.blockedBy);

      const mlTag = mlScore !== null
        ? ` | ML=${mlScore.toFixed(3)} (${mlWouldEnter ? "model WANTED in" : "model agreed skip"})`
        : "";
      writeLog(
        `[NEAR-MISS OUTCOME] ${miss.coin} ${miss.rule} ${miss.side} @ $${miss.price.toFixed(4)} → $${currentPrice.toFixed(4)} | PnL: ${pnlPct.toFixed(2)}% | ${wouldHaveWon ? "WOULD HAVE WON" : "AVOIDED LOSS"} | blocked: ${miss.blockedBy}${mlTag}`,
      );
    } catch (err) {
      writeLog(`[ERROR] Near-miss price check failed for ${miss.coin}: ${err}`);
    }
  }

  // Summarize lessons — frame as "right" vs "wrong" to skip
  const total = wins + losses;
  if (total === 0) return;

  const rightToSkip = losses; // they would have lost — good we skipped
  const wrongToSkip = wins;   // they would have won — we missed out
  const rightPct = ((rightToSkip / total) * 100).toFixed(0);

  const summary = `NEAR-MISS REPORT: ${total} checked — ✅ ${rightToSkip} right to skip (${rightPct}%), ❌ ${wrongToSkip} wrong to skip (missed winners)`;
  log(summary);

  // Per-rule lessons
  for (const [key, data] of Object.entries(lessonCounts)) {
    const ruleTotal = data.wins + data.losses;
    const ruleRightPct = ((data.losses / ruleTotal) * 100).toFixed(0);
    const topBlockers = [...new Set(data.blockers)].slice(0, 3).join(" | ");
    const lesson = `  ${key}: ${ruleRightPct}% right to skip (✅${data.losses} dodged, ❌${data.wins} missed) — blockers: ${topBlockers}`;
    log(lesson);

    // If we were wrong >60% of the time, filters are too strict
    if (data.wins > data.losses && ruleTotal >= 3) {
      writeLog(`[LESSON] ❌ FILTERS TOO STRICT on ${key} — wrong to skip ${((data.wins / ruleTotal) * 100).toFixed(0)}% of the time (${ruleTotal} samples). Blockers: ${topBlockers}`);
    }
    // If we were right >60%, filters are working
    if (data.losses > data.wins && ruleTotal >= 3) {
      writeLog(`[LESSON] ✅ FILTERS WORKING on ${key} — right to skip ${ruleRightPct}% of the time (${ruleTotal} samples)`);
    }
  }

  // ML near-miss analysis: how often did ML agree with the rule's decision?
  const mlScoredMisses = toCheck.filter(m => nearMissMLScores.has(m.timestamp));
  let mlWantedIn = 0; // ML score > 0.5 (model would have entered)
  let mlWantedInWon = 0; // ML wanted in + would have won (ML was right to disagree with rule)
  for (const m of mlScoredMisses) {
    const sc = nearMissMLScores.get(m.timestamp) ?? null;
    const outcome = nearMissOutcomes.find(o => o.miss.timestamp === m.timestamp);
    if (sc !== null && sc > 0.5) {
      mlWantedIn++;
      if (outcome?.wouldHaveWon) mlWantedInWon++;
    }
  }
  const mlBlock = mlScoredMisses.length > 0
    ? `\n\n**ML disagreements** (model wanted in, rule said no): **${mlWantedIn}** of ${mlScoredMisses.length} scored\n- Of those, **${mlWantedInWon}** would have been winners (${mlWantedIn > 0 ? ((mlWantedInWon / mlWantedIn) * 100).toFixed(0) : 0}% ML accuracy on misses)`
    : "";

  const ruleLines = Object.entries(lessonCounts).map(([k, d]) => {
    const rt = d.wins + d.losses;
    const rPct = ((d.losses / rt) * 100).toFixed(0);
    const verdict = d.losses >= d.wins ? "✅ filters working" : "❌ filters too strict";
    return `- **${k}:** ${rPct}% right to skip (dodged ${d.losses}, missed ${d.wins}) — ${verdict}`;
  }).join("\n");
  await notify({
    title: `Near-Miss Report — ${rightPct}% right to skip`,
    tags: "mag,brain",
    body: `**Filter accuracy on ${total} near-misses:**\n✅ Right to skip: **${rightToSkip}** — dodged losses\n❌ Wrong to skip: **${wrongToSkip}** — missed winners\n\n${ruleLines}${mlBlock}\n\n_${parseInt(rightPct) >= 60 ? "Filters are earning their keep." : "Might be leaving money on the table..."}_`,
  });

  // Prune old near-misses (keep last 100)
  if (nearMisses.length > 100) {
    const pruned = nearMisses.splice(0, nearMisses.length - 100);
    for (const m of pruned) nearMissMLScores.delete(m.timestamp);
  }
  if (nearMissOutcomes.length > 200) {
    nearMissOutcomes.splice(0, nearMissOutcomes.length - 200);
  }
}

/** Persist accumulated near-miss lessons to knowledge file for future agents */
const LESSONS_FILE = resolve(projectRoot, "knowledge", "live-trading-lessons.md");

function persistLessons() {
  if (nearMissOutcomes.length < 5) return; // need meaningful sample

  const now = new Date().toISOString().slice(0, 16);
  const total = nearMissOutcomes.length;
  const wrongToSkip = nearMissOutcomes.filter(o => o.wouldHaveWon).length;
  const rightToSkip = total - wrongToSkip;
  const rightPct = ((rightToSkip / total) * 100).toFixed(0);

  // Aggregate per-rule stats
  const ruleStats: Record<string, { right: number; wrong: number; blockers: Record<string, number>; avgPnl: number; samples: number }> = {};
  for (const o of nearMissOutcomes) {
    const k = `${o.miss.rule}-${o.miss.side}`;
    if (!ruleStats[k]) ruleStats[k] = { right: 0, wrong: 0, blockers: {}, avgPnl: 0, samples: 0 };
    const r = ruleStats[k];
    r[o.wouldHaveWon ? "wrong" : "right"]++;
    r.avgPnl += o.pnlPct;
    r.samples++;
    const blocker = o.miss.blockedBy;
    r.blockers[blocker] = (r.blockers[blocker] || 0) + 1;
  }

  // Build the lessons content
  const lines: string[] = [
    `# Live Trading Lessons (auto-updated)`,
    ``,
    `_Updated by agent at ${now}. ${total} near-miss outcomes analyzed._`,
    ``,
    `## Filter Accuracy Summary`,
    ``,
    `- ✅ **Right to skip:** ${rightToSkip}/${total} (${rightPct}%) — correctly dodged losses`,
    `- ❌ **Wrong to skip:** ${wrongToSkip}/${total} — missed profitable trades`,
    ``,
    `## Per-Rule Analysis`,
    ``,
  ];

  const actionableInsights: string[] = [];

  for (const [rule, stats] of Object.entries(ruleStats).sort((a, b) => b[1].samples - a[1].samples)) {
    const ruleTotal = stats.right + stats.wrong;
    const ruleRightPct = ((stats.right / ruleTotal) * 100).toFixed(0);
    const avgPnl = (stats.avgPnl / stats.samples).toFixed(2);

    // Top blockers for this rule
    const topBlockers = Object.entries(stats.blockers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([b, count]) => `${b} (${count}x)`)
      .join(", ");

    const verdict = stats.right >= stats.wrong ? "✅ filters working" : "❌ filters too strict";
    lines.push(`### ${rule} — ${verdict}`);
    lines.push(`- **Right to skip:** ${ruleRightPct}% (✅${stats.right} dodged, ❌${stats.wrong} missed)`);
    lines.push(`- **Avg PnL if taken:** ${avgPnl}%`);
    lines.push(`- **Common blockers:** ${topBlockers}`);
    lines.push(``);

    // Generate actionable insights
    if (stats.wrong > stats.right && ruleTotal >= 5) {
      actionableInsights.push(`- ❌ **RELAX ${rule}:** Wrong to skip ${((stats.wrong / ruleTotal) * 100).toFixed(0)}% of the time (${ruleTotal} samples). Top blocker: ${Object.entries(stats.blockers).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown"}. Consider lowering the threshold.`);
    } else if (stats.right > stats.wrong && ruleTotal >= 5) {
      actionableInsights.push(`- ✅ **KEEP ${rule} STRICT:** Right to skip ${ruleRightPct}% of the time (${ruleTotal} samples). Filters are protecting us.`);
    } else if (ruleTotal >= 5) {
      actionableInsights.push(`- ⚖️ **${rule} is borderline:** ${ruleRightPct}% right on ${ruleTotal} samples. Need more data.`);
    }
  }

  if (actionableInsights.length > 0) {
    lines.push(`## Actionable Insights`);
    lines.push(``);
    lines.push(...actionableInsights);
    lines.push(``);
  }

  lines.push(`## Raw Stats`);
  lines.push(``);
  lines.push(`- Session started: ${new Date(sessionStartTime).toISOString().slice(0, 16)}`);
  lines.push(`- Total near-misses tracked: ${nearMisses.length}`);
  lines.push(`- Total outcomes checked: ${nearMissOutcomes.length}`);
  lines.push(`- Realized PnL this session: ${formatUsd(totalRealizedPnl)}`);
  lines.push(``);

  writeFileSync(LESSONS_FILE, lines.join("\n"));
  log(`[PERSIST] Updated ${LESSONS_FILE} with ${total} near-miss outcomes`);
}

// ── Log Processor (Ollama) ──────────────────────────────────────────────────

const LOG_PROCESSOR_SCRIPT = resolve(logsDir, "process-logs.sh");
let lastProcessedFile = ""; // track to avoid re-reading same output

async function runLogProcessor(): Promise<void> {
  log("[LOG-PROC] Running log processor (Ollama)...");

  try {
    // Run the script in the logs directory, 5min timeout (Ollama can be slow)
    const output = await new Promise<string>((res, rej) => {
      execFile("bash", [LOG_PROCESSOR_SCRIPT], {
        cwd: logsDir,
        timeout: 5 * 60_000,
        env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin` },
      }, (err, stdout, stderr) => {
        if (err) rej(new Error(`process-logs.sh failed: ${err.message}\nstderr: ${stderr}`));
        else res(stdout);
      });
    });

    writeLog(`[LOG-PROC] Script output: ${output.replace(/\n/g, " ").trim()}`);

    // Find the newest processed-*.log file
    const processedFiles = readdirSync(logsDir)
      .filter(f => f.startsWith("processed-") && f.endsWith(".log"))
      .sort()
      .reverse();

    if (processedFiles.length === 0) {
      log("[LOG-PROC] No processed output file found");
      return;
    }

    const newestFile = processedFiles[0];
    const newestPath = resolve(logsDir, newestFile);

    if (newestFile === lastProcessedFile) {
      log("[LOG-PROC] No new output (same file as last run)");
      return;
    }

    lastProcessedFile = newestFile;
    const summary = readFileSync(newestPath, "utf-8").trim();

    if (!summary) {
      log("[LOG-PROC] Output file is empty");
      return;
    }

    // Log the full summary
    log(`[LOG-PROC] Ollama summary (${newestFile}):`);
    for (const line of summary.split("\n")) {
      writeLog(`[LOG-PROC]   ${line}`);
    }

    // Sanity-check: does the summary mention key things we'd expect?
    const checks = {
      mentionsPnl: /pnl|profit|loss|p&l/i.test(summary),
      mentionsPositions: /position|trade|order/i.test(summary),
      mentionsCoins: COINS.some(c => summary.toUpperCase().includes(c)),
      hasSubstance: summary.length > 100,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    const total = Object.values(checks).length;

    const sanityLine = `Sanity: ${passed}/${total} checks passed (${Object.entries(checks).map(([k, v]) => `${k}:${v ? "✓" : "✗"}`).join(", ")})`;
    log(`[LOG-PROC] ${sanityLine}`);

    // Truncate for notification (ntfy has limits)
    const truncated = summary.length > 800
      ? summary.slice(0, 800) + "... _(truncated)_"
      : summary;

    await notify({
      title: `Log Analysis — ${passed}/${total} sanity checks`,
      tags: "mag_right,memo",
      body: `**Ollama processed session logs:**\n\n${truncated}\n\n_${sanityLine}_`,
    });
  } catch (err) {
    const errMsg = `Log processor failed: ${err}`;
    log(`[LOG-PROC ERROR] ${errMsg}`);
    writeLog(`[LOG-PROC ERROR STACK] ${err instanceof Error ? err.stack : String(err)}`);
    // Non-fatal — don't crash the agent
  }
}

async function runCycle() {
  cycleCount++;
  const elapsed = (Date.now() - sessionStartTime) / 3_600_000;
  log(`── Cycle ${cycleCount} (${elapsed.toFixed(1)}h elapsed) ──`);

  // 1. Fetch positions + meta
  const meta = await retry(() => getMeta(info));
  const positions: Position[] = DRY_RUN
    ? [...virtualPositions.values()]
    : await retry(() => getPositions(info, accountAddress));

  // Sync held coins with actual positions (paper mode tracks heldCoins internally)
  if (!DRY_RUN) {
    heldCoins.clear();
    for (const pos of positions) heldCoins.add(pos.coin);
  }

  log(`Positions: ${positions.length}/${MAX_POSITIONS} | Held: ${[...heldCoins].join(", ") || "none"} | Realized PnL: ${formatUsd(totalRealizedPnl)}`);

  // 1b. Fetch sentiment (advisory, non-fatal)
  // Throttle: 3x/hour in normal mode (every 7th cycle), every cycle in high-vol mode (lean — no discovery)
  const isHighVol = sleepMultiplier < 1;
  const sentimentDue = cycleCount === 1 || (isHighVol ? true : cycleCount % 7 === 0);
  if (sentimentDue) {
    try {
      // Include dynamic coins in sentiment fetch so they get tracked between cycles
      const sentimentCoins = [...COINS, ...dynamicCoins.values()].filter((c, i, arr) => arr.indexOf(c) === i);
      currentSentiment = await fetchSentiment(sentimentCoins);
      sentimentSignals = detectSentimentSignals(currentSentiment, prevSentiment);
      sentimentAvailable = true;

      if (sentimentSignals.length > 0) {
        for (const sig of sentimentSignals) {
          log(`[SENTIMENT] ${sig.coin} ${sig.type} [${sig.strength}]: ${sig.reason}`);
        }
      }

      // Log sentiment snapshot in verbose
      for (const s of currentSentiment) {
        verbose(`[SENTIMENT] ${s.coin}: galaxy=${s.galaxyScore} sentiment=${s.sentiment}% vol=${s.socialVolume} rank=#${s.altRank}`);
      }

      prevSentiment = currentSentiment;

      // 1c. Discover coins with extreme sentiment — only in normal mode (full fetch)
      // In high-vol mode, skip discovery to keep requests lean
      if (!isHighVol) {
        try {
          const hlCoins = new Set(meta.universe.filter((a) => !a.isDelisted).map((a) => a.name.toUpperCase()));
          const discoveries = await discoverSentimentCoins(COINS);
          const prevDynamic = new Set(dynamicCoins);
          dynamicCoins.clear();
          for (const d of discoveries) {
            if (hlCoins.has(d.coin)) {
              dynamicCoins.add(d.coin);
              if (!prevDynamic.has(d.coin)) {
                log(`[DISCOVERY] Adding ${d.coin} — ${d.reason}`);
                // Also add to sentiment tracking
                currentSentiment.push(d.snapshot);
              }
            }
          }
          // Log removals
          for (const prev of prevDynamic) {
            if (!dynamicCoins.has(prev)) {
              verbose(`[DISCOVERY] Removed ${prev} — sentiment normalized`);
            }
          }
          if (dynamicCoins.size > 0) {
            verbose(`[DISCOVERY] Dynamic coins: ${[...dynamicCoins].join(", ")}`);
          }
        } catch (e) {
          verbose(`[DISCOVERY] Failed: ${e}`);
        }
      } else {
        verbose(`[SENTIMENT] High-vol lean mode — skipping discovery`);
      }
    } catch (e) {
      // Non-fatal — sentiment is advisory only
      if (sentimentAvailable) {
        writeLog(`[SENTIMENT WARN] Fetch failed: ${e}`);
      } else if (cycleCount === 1) {
        verbose(`[SENTIMENT] Not available: ${e}`);
      }
    }
  } else {
    verbose(`[SENTIMENT] Throttled — next fetch in ${7 - (cycleCount % 7)} cycles`);
  }

  // 2. Check exits
  const preTradeCoins = new Set(heldCoins);
  await checkExits(positions, meta);

  // 3. Check entries (if room)
  await checkEntries(meta);

  // Detect if any trades happened this cycle (opened or closed)
  const tradedThisCycle = heldCoins.size !== preTradeCoins.size ||
    [...heldCoins].some(c => !preTradeCoins.has(c)) ||
    [...preTradeCoins].some(c => !heldCoins.has(c));

  // 3a. Assess market volatility and adjust interval
  if (VOL_DETECT) await assessMarketVolatility();

  // 3b. Per-cycle status notification (only on trade cycles — hourly has its own)
  if (tradedThisCycle) {
    const posLines: string[] = [];
    let unrealizedTotal = 0;
    let totalNotional = 0;
    for (const pos of positions) {
      try {
        const midStr = await getMidPrice(info, pos.coin);
        const mid = parseFloat(midStr);
        const entry = parseFloat(pos.entryPx);
        const sz = Math.abs(parseFloat(pos.szi));
        const notional = sz * mid;
        const pnl = pos.side === "long" ? sz * (mid - entry) : sz * (entry - mid);
        const pnlPct = (pnl / (sz * entry)) * 100;
        unrealizedTotal += pnl;
        totalNotional += notional;
        const dot = pnl >= 0 ? "🟢" : "🔴";
        posLines.push(`- ${dot} **${pos.coin}** ${pos.side} $${notional.toFixed(0)} → **${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%** (${formatUsd(pnl)}) @ $${mid.toFixed(mid >= 100 ? 0 : mid >= 1 ? 2 : 4)}`);
      } catch { /* skip */ }
    }
    let currentAccountValue = DRY_RUN ? virtualBalance : 0;
    const tradeBalDisplay = DRY_RUN
      ? `$${virtualBalance.toFixed(2)} paper | avail $${(virtualBalance - virtualMarginUsed).toFixed(0)}`
      : await getAvailableBalance().then(b => {
          currentAccountValue = b.accountValue;
          return `$${b.accountValue.toFixed(2)} (spot $${b.spotTotal.toFixed(2)} + perp $${b.perpValue.toFixed(2)}) | avail $${b.available.toFixed(0)}`;
        });
    const cyclesDeltaLine = initialCapital > 0 ? `\n- **Δ from start:** ${formatDeltaFromStart(currentAccountValue)}` : "";
    // Near-misses this cycle
    const recentMisses = nearMisses.filter(m => Date.now() - m.timestamp < INTERVAL_MS * 2);
    const missLines = recentMisses.map(m => `- 👀 **${m.coin}** ${m.rule} ${m.side} — _${m.blockedBy}_`);
    // Lessons from near-miss outcomes — were we right or wrong to skip?
    let lessonsBlock = "";
    if (nearMissOutcomes.length > 0) {
      const wrongToSkip = nearMissOutcomes.filter(o => o.wouldHaveWon).length;
      const rightToSkip = nearMissOutcomes.length - wrongToSkip;
      const total = nearMissOutcomes.length;
      const rightPct = ((rightToSkip / total) * 100).toFixed(0);
      // Per-rule breakdown
      const ruleCounts: Record<string, { right: number; wrong: number }> = {};
      for (const o of nearMissOutcomes) {
        const k = `${o.miss.rule}-${o.miss.side}`;
        if (!ruleCounts[k]) ruleCounts[k] = { right: 0, wrong: 0 };
        ruleCounts[k][o.wouldHaveWon ? "wrong" : "right"]++;
      }
      const ruleLines = Object.entries(ruleCounts)
        .sort((a, b) => (b[1].right + b[1].wrong) - (a[1].right + a[1].wrong))
        .slice(0, 3)
        .map(([k, v]) => {
          const rt = v.right + v.wrong;
          const pct = ((v.right / rt) * 100).toFixed(0);
          return `- ${k}: ${pct}% right (✅${v.right} dodged, ❌${v.wrong} missed)`;
        })
        .join("\n");
      lessonsBlock = `\n\n📊 **Near-miss accuracy** (${total} checked):\n✅ Right to skip: **${rightToSkip}** (${rightPct}%) — dodged losses\n❌ Wrong to skip: **${wrongToSkip}** — missed winners\n${ruleLines}`;
    }
    // Sentiment signals this cycle
    const sentLines = sentimentSignals.map(s => {
      const icon = s.type === "bullish" ? "🟢" : s.type === "bearish" ? "🔴" : "⚡";
      return `- ${icon} **${s.coin}** [${s.strength}] ${s.reason}`;
    });
    let sentBlock = sentLines.length > 0 ? `\n\n🔮 **Sentiment signals:**\n${sentLines.join("\n")}` : "";
    if (VERBOSE && currentSentiment.length > 0) {
      const sentDetails = currentSentiment.map(s => `- ${s.coin}: galaxy=${s.galaxyScore} sent=${s.sentiment}% rank=#${s.altRank}`);
      sentBlock += `\n\n**Sentiment detail:**\n${sentDetails.join("\n")}`;
    }
    const ruleAnalysisBlock = VERBOSE && pnlByRule.size > 0 ? `\n\n${buildRuleBacktradeAnalysis()}` : "";
    const dynBlock = dynamicCoins.size > 0 ? `\n\n🔍 **Sentiment discovery:** ${[...dynamicCoins].join(", ")}` : "";
    const missBlock = missLines.length > 0 ? `\n\n**Near-misses this cycle:**\n${missLines.join("\n")}` : "";
    const volBlock = volSummary ? `\n\n⚡ **${volSummary}** | interval ${(INTERVAL_MS * sleepMultiplier / 1000).toFixed(0)}s` : "";
    const posBlock = posLines.length > 0 ? posLines.join("\n") : "_No open positions._";
    const titleEmoji = unrealizedTotal >= 0 ? "🟢" : "🔴";
    await notify({
      title: `C${cycleCount} ${titleEmoji} ${positions.length} positions | ${formatUsd(unrealizedTotal)} unrealized`,
      tags: "eyes",
      body: `${posBlock}\n\n**Total value:** $${totalNotional.toFixed(0)} | **Unrealized:** ${formatUsd(unrealizedTotal)} | **Realized:** ${formatUsd(totalRealizedPnl)}\n**Record:** ${formatRecord()}\n**Balance:** ${tradeBalDisplay}${cyclesDeltaLine}${volBlock}${sentBlock}${dynBlock}${missBlock}${lessonsBlock}${ruleAnalysisBlock}`,
    });
  }

  // 4. Circuit breaker
  if (totalRealizedPnl < -CIRCUIT_BREAKER_USD) {
    log(`[CIRCUIT BREAKER] Session loss ${formatUsd(totalRealizedPnl)} exceeds -$${CIRCUIT_BREAKER_USD}`);
    await notify({ title: "CIRCUIT BREAKER 🚨", tags: "rotating_light,skull", priority: "high", body: `**Session loss limit hit. All positions closed.**\n\n- **Session loss:** ${formatUsd(totalRealizedPnl)}\n- **Record:** ${formatRecord()}\n- **Limit:** $${CIRCUIT_BREAKER_USD.toFixed(2)}\n\n_Going dark. Review and restart manually._` });

    if (DRY_RUN) {
      // Paper: clear all virtual positions
      for (const pos of virtualPositions.values()) {
        log(`  [PAPER] Emergency close ${pos.coin}`);
      }
      virtualPositions.clear();
      virtualMarginUsed = 0;
      heldCoins.clear();
    } else {
      const currentPositions = await getPositions(info, accountAddress);
      for (const pos of currentPositions) {
        try {
          await cancelOpenOrders(exchange!, info, accountAddress, pos.coin).catch(() => {});
          await closePosition(exchange!, info, accountAddress, pos.coin);
          log(`  Closed ${pos.coin}`);
          await notify({ title: `Emergency Close — ${pos.coin}`, tags: "rotating_light", priority: "high", body: `**Circuit breaker:** closed ${pos.coin} ${pos.side}` });
        } catch (err) {
          log(`  Failed to close ${pos.coin}: ${err}`);
          writeLog(`[ERROR STACK] ${err instanceof Error ? err.stack : String(err)}`);
        }
      }
    }
    return false; // signal to stop
  }

  // 5. Session timeout
  if (elapsed >= SESSION_HOURS) {
    log(`[SESSION END] ${SESSION_HOURS}h reached`);
    await notify({ title: `Session Complete — ${SESSION_HOURS}h`, tags: "checkered_flag", body: `**Time's up!**\n\n- **Session PnL:** ${formatUsd(totalRealizedPnl)}\n- **Duration:** ${SESSION_HOURS}h\n\n_Signing off._` });
    return false;
  }

  // 6. Near-miss analysis (hourly — time-based, not cycle-count)
  const elapsedMs = Date.now() - sessionStartTime;
  const hourlyDue = elapsedMs > 0 && Math.floor(elapsedMs / 3_600_000) > Math.floor((elapsedMs - (INTERVAL_MS * sleepMultiplier)) / 3_600_000);
  const lessonsDue = elapsedMs > 0 && Math.floor(elapsedMs / 7_200_000) > Math.floor((elapsedMs - (INTERVAL_MS * sleepMultiplier)) / 7_200_000); // every 2h
  if (hourlyDue) {
    try {
      await analyzeNearMisses();
    } catch (err) {
      writeLog(`[ERROR] Near-miss analysis failed: ${err}`);
    }
  }

  // 6b. Persist lessons to knowledge file (every 2h — time-based)
  if (lessonsDue) {
    try {
      persistLessons();
    } catch (err) {
      writeLog(`[ERROR] Persist lessons failed: ${err}`);
    }
  }

  // 7. Hourly summary (time-based)
  if (hourlyDue) {
    const currentPositions: Position[] = DRY_RUN
      ? [...virtualPositions.values()]
      : await getPositions(info, accountAddress);
    let unrealizedTotal = 0;
    let hourlyTotalNotional = 0;
    const hourlyPosLines: string[] = [];
    for (const pos of currentPositions) {
      try {
        const midStr = await getMidPrice(info, pos.coin);
        const mid = parseFloat(midStr);
        const entry = parseFloat(pos.entryPx);
        const sz = Math.abs(parseFloat(pos.szi));
        const notional = sz * mid;
        const pnl = pos.side === "long" ? sz * (mid - entry) : sz * (entry - mid);
        const pnlPct = (pnl / (sz * entry)) * 100;
        unrealizedTotal += pnl;
        hourlyTotalNotional += notional;
        const dot = pnl >= 0 ? "🟢" : "🔴";
        hourlyPosLines.push(`- ${dot} **${pos.coin}** ${pos.side} $${notional.toFixed(0)} → ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% (${formatUsd(pnl)})`);
      } catch { /* skip */ }
    }
    let hourlyAccountValue = DRY_RUN ? virtualBalance : 0;
    const hourlyBalDisplay = DRY_RUN
      ? `$${virtualBalance.toFixed(2)} paper (avail $${(virtualBalance - virtualMarginUsed).toFixed(2)})`
      : await getAvailableBalance().then(b => { hourlyAccountValue = b.accountValue; return `$${b.accountValue.toFixed(2)}`; });
    const hourlyDeltaLine = initialCapital > 0 ? `\n- **Δ from start:** ${formatDeltaFromStart(hourlyAccountValue)}` : "";
    const elapsed = (Date.now() - sessionStartTime) / 3_600_000;
    // Sentiment top movers for hourly report
    let sentHourlyBlock = "";
    if (sentimentAvailable && currentSentiment.length > 0) {
      const topByGalaxy = [...currentSentiment].sort((a, b) => b.galaxyScore - a.galaxyScore).slice(0, 3);
      const sentLines = topByGalaxy.map(s => `- **${s.coin}** galaxy=${s.galaxyScore} sentiment=${s.sentiment}% rank=#${s.altRank}`);
      sentHourlyBlock = `\n\n**Sentiment leaders:**\n${sentLines.join("\n")}`;
    }
    // Sentiment education (verbose: always; otherwise: only if signals or discoveries present)
    if (sentimentAvailable && (VERBOSE || sentimentSignals.length > 0 || dynamicCoins.size > 0)) {
      const openPosForEdu: Position[] = DRY_RUN ? [...virtualPositions.values()] : currentPositions;
      const edu = buildSentimentEducation(sentimentSignals, currentSentiment, openPosForEdu, dynamicCoins);
      if (edu) sentHourlyBlock += `\n\n**Sentiment Education:**\n${edu}`;
    }
    const ruleAnalysis = buildRuleBacktradeAnalysis();
    const ruleAnalysisSection = ruleAnalysis ? `\n\n${ruleAnalysis}` : "";
    const winRateStr = sessionWins + sessionLosses > 0 ? ` (${((sessionWins / (sessionWins + sessionLosses)) * 100).toFixed(0)}% win rate)` : "";
    const summary = `**Hour check-in. Here's the book:**\n\n${hourlyPosLines.join("\n") || "_No positions._"}\n\n**Stats:**\n- **Total value:** $${hourlyTotalNotional.toFixed(0)}\n- **Unrealized:** ${formatUsd(unrealizedTotal)}\n- **Realized:** ${formatUsd(totalRealizedPnl)}\n- **Record:** ${sessionWins}W-${sessionLosses}L${winRateStr}\n- **Net:** ${formatUsd(unrealizedTotal + totalRealizedPnl)}\n- **Balance:** ${hourlyBalDisplay}${hourlyDeltaLine}\n- **Elapsed:** ${elapsed.toFixed(1)}h${sentHourlyBlock}${ruleAnalysisSection}\n\n_Opus never sleeps._`;
    log(`HOURLY: ${currentPositions.length} open, unrlzd ${formatUsd(unrealizedTotal)}, rlzd ${formatUsd(totalRealizedPnl)}`);
    await notify({ title: `Hourly Report — Cycle ${cycleCount} 📊`, tags: "bar_chart,clock3", body: summary });

    // 7b. Run log processor (Ollama) — non-blocking, errors are non-fatal
    try {
      await runLogProcessor();
    } catch (err) {
      writeLog(`[ERROR] Log processor failed: ${err}`);
    }

    // 7b2. ML retrain trigger — if 5+ new live trades accumulated since last retrain
    if (liveTradesSinceRetrain >= 5) {
      try {
        triggerRetrain(writeLog);
        liveTradesSinceRetrain = 0;
      } catch (err) {
        writeLog(`[ERROR] ML retrain trigger failed: ${err}`);
      }
    }

    // 7c. Hourly doctor check — warnings only, don't stop trading
    try {
      await runDoctor(false);
    } catch (err) {
      writeLog(`[ERROR] Hourly doctor failed: ${err}`);
    }
  }

  // 7d. Style check-in (every 6h) — advisory suggestions via ntfy
  if (cycleCount % STYLE_CHECKIN_CYCLES === 0 && cycleCount > 0) {
    try {
      const suggestions = generateStyleSuggestions();
      if (suggestions.length > 0) {
        writeLog(`[STYLE CHECK-IN] ${suggestions.length} suggestion(s)`);
        await notify({
          title: "Style check-in: trading suggestions",
          tags: "bulb",
          body: `**Advisory — no auto-changes made.**\n\n${suggestions.map((s) => `- ${s}`).join("\n")}`,
        });
      }
    } catch (err) {
      writeLog(`[ERROR] Style check-in failed: ${err}`);
    }
  }

  return true; // continue
}

// ── Style Suggestions ────────────────────────────────────────────────────────

function generateStyleSuggestions(): string[] {
  const suggestions: string[] = [];

  // Contrarian underperforming
  const contrTotal = sessionContrWins + sessionContrLosses;
  if (CONTRARIAN_PCT > 0 && contrTotal >= 3 && sessionContrWins / contrTotal < 0.4) {
    suggestions.push(
      `Contrarian win rate ${((sessionContrWins / contrTotal) * 100).toFixed(0)}% (${contrTotal} trades) — consider reducing \`--contrarian-pct\``,
    );
  }

  // R3 trend long consistently losing
  const r3 = ruleStats.get("R3-trend");
  if (r3 && r3.wins + r3.losses >= 3 && r3.wins / (r3.wins + r3.losses) < 0.35) {
    suggestions.push(`R3 (trend long) win rate ${((r3.wins / (r3.wins + r3.losses)) * 100).toFixed(0)}% over ${r3.wins + r3.losses} trades — market may be bearish/ranging`);
  }

  // No trades at all after many cycles (possibly over-filtered)
  if (sessionWins + sessionLosses === 0 && cycleCount >= STYLE_CHECKIN_CYCLES) {
    suggestions.push(`No closed trades after ${cycleCount} cycles — consider expanding coin list or checking market regime`);
  }

  return suggestions;
}

// ── Rule Backtrade Analysis ───────────────────────────────────────────────────

function buildRuleBacktradeAnalysis(): string {
  if (pnlByRule.size === 0) return "";
  const sorted = [...pnlByRule.entries()].sort((a, b) => b[1].totalTrades - a[1].totalTrades);
  const lines = sorted.map(([rule, d]) => {
    const winRate = d.totalTrades > 0 ? ((d.wins / d.totalTrades) * 100).toFixed(0) : "0";
    const avgPnl = d.totalTrades > 0 ? d.totalPnl / d.totalTrades : 0;
    const avgStr = `${avgPnl >= 0 ? "+" : ""}$${Math.abs(avgPnl).toFixed(2)}`;
    const emoji = parseInt(winRate) >= 50 ? "🟢" : "🔴";
    return `- ${emoji} **${rule}:** ${winRate}% W/R | avg ${avgStr} | net ${formatUsd(d.totalPnl)} (${d.totalTrades} trades)`;
  });
  let summaryLine = "";
  if (sorted.length > 1) {
    const best = sorted.reduce((b, c) => c[1].totalPnl > b[1].totalPnl ? c : b, sorted[0]);
    const worst = sorted.reduce((w, c) => c[1].totalPnl < w[1].totalPnl ? c : w, sorted[0]);
    summaryLine = `\n_Best: **${best[0]}** (${formatUsd(best[1].totalPnl)}) | Worst: **${worst[0]}** (${formatUsd(worst[1].totalPnl)})_`;
  }
  return `**Rule backtrade analysis:**\n${lines.join("\n")}${summaryLine}`;
}

// ── Sentiment Education ───────────────────────────────────────────────────────

function buildSentimentEducation(
  signals: SentimentSignal[],
  sentiment: SentimentSnapshot[],
  openPositions: Position[],
  discovered: Set<string>,
): string | null {
  if (sentiment.length === 0 && signals.length === 0 && discovered.size === 0) return null;
  const parts: string[] = [];

  // Theory guide
  if (sentiment.length > 0) {
    parts.push([
      "**Sentiment Guide:**",
      "- **Galaxy Score** (0-100): social momentum. >70 = surging, <30 = cold.",
      "- **Sentiment %**: % of posts positive. >85% = crowd euphoria (contrarian bearish), <20% = crowd panic (contrarian bullish).",
      "- **AltRank™**: how a coin ranks vs its own social history. #1 = all-time high activity.",
    ].join("\n"));
  }

  // Extremes
  const extremes = sentiment.filter(s => s.galaxyScore >= 75 || s.galaxyScore <= 25 || s.sentiment >= 85 || s.sentiment <= 20);
  if (extremes.length > 0) {
    const extremeLines = extremes.slice(0, 5).map(s => {
      let label: string;
      if (s.galaxyScore >= 75 && s.sentiment >= 85) label = "🚀 momentum + euphoria";
      else if (s.galaxyScore >= 75) label = "🚀 momentum surge";
      else if (s.sentiment >= 85) label = "😤 crowd euphoria";
      else if (s.sentiment <= 20) label = "😱 crowd panic";
      else label = "❄️ cold/fading";
      return `- **${s.coin}** galaxy=${s.galaxyScore} sent=${s.sentiment}% rank=#${s.altRank} — _${label}_`;
    });
    parts.push(`**Extremes now:**\n${extremeLines.join("\n")}`);
  }

  // Position/sentiment alignment
  if (openPositions.length > 0 && sentiment.length > 0) {
    const corrLines: string[] = [];
    for (const pos of openPositions) {
      const sent = sentiment.find(s => s.coin === pos.coin);
      if (!sent) continue;
      const bullish = sent.sentiment >= 60 && sent.galaxyScore >= 50;
      const bearish = sent.sentiment <= 40 || sent.galaxyScore <= 30;
      if (pos.side === "long" && bullish)
        corrLines.push(`- ✓ **${pos.coin}** long aligns with bullish sentiment (sent=${sent.sentiment}%)`);
      else if (pos.side === "long" && bearish)
        corrLines.push(`- ⚠️ **${pos.coin}** long contradicts bearish sentiment (sent=${sent.sentiment}%)`);
      else if (pos.side === "short" && bearish)
        corrLines.push(`- ✓ **${pos.coin}** short aligns with bearish sentiment (sent=${sent.sentiment}%)`);
      else if (pos.side === "short" && bullish)
        corrLines.push(`- ⚠️ **${pos.coin}** short contradicts bullish sentiment (sent=${sent.sentiment}%)`);
    }
    if (corrLines.length > 0) {
      parts.push(`**Position/sentiment alignment:**\n${corrLines.join("\n")}`);
    }
  }

  // Discovery coins
  if (discovered.size > 0) {
    parts.push(`**Auto-discovered from sentiment scan:** ${[...discovered].join(", ")}`);
  }

  // Active signals
  if (signals.length > 0) {
    const sigLines = signals.slice(0, 4).map(s => {
      const icon = s.type === "bullish" ? "🟢" : s.type === "bearish" ? "🔴" : "⚡";
      return `- ${icon} **${s.coin}** [${s.strength}] — ${s.reason}`;
    });
    parts.push(`**Active signals:**\n${sigLines.join("\n")}`);
  }

  return parts.length === 0 ? null : parts.join("\n\n");
}

// ── Help Banner ───────────────────────────────────────────────────────────────

function printHelpBanner() {
  const coinDisplay = COINS.length > 5
    ? `${COINS.slice(0, 5).join(" ")} +${COINS.length - 5} more`
    : COINS.join(" ");
  const contrStr = CONTRARIAN_PCT > 0 ? ` | Contrarian ${CONTRARIAN_PCT}%` : "";
  console.log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Hey ${DISPLAY_NAME}! Starting up...`);
  console.log(`  AGENT  ${AGENT_NAME}`);
  console.log(`  Risk   ${LEVERAGE}x lev · ${MAX_ALLOC_PCT}% alloc · $${CIRCUIT_BREAKER_USD} breaker`);
  console.log(`  Rules  R3/R4 trend · R1/R2 mean-rev${contrStr}`);
  console.log(`  Coins  ${coinDisplay}`);
  console.log(`  Notify ntfy.sh/${process.env.NTFY_CHANNEL ?? "my-trader"}${process.env.NTFY_TOKEN ? " (auth)" : " (public)"}`);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Volatility detection setup — prompt if not explicitly configured
  if (!VOL_DETECT_EXPLICIT) {
    VOL_DETECT = await promptVolatilitySetup();
  }

  // ── Profile / Wizard ────────────────────────────────────────────────────────
  const NO_WIZARD = opts.noWizard;
  const HELP_ME = opts.helpMe;
  const WIZARD_ONLY = opts.wizardOnly;

  let profile: TradingProfile | null = NO_WIZARD ? null : loadProfile();

  // Run wizard on first use, --help-me, or --wizard-only
  if ((!profile && !NO_WIZARD) || HELP_ME || WIZARD_ONLY) {
    profile = await runWizard(process.stdin.isTTY);
    saveProfile(profile);
    // --wizard-only: just save the profile and exit — don't start the trading loop
    if (WIZARD_ONLY) {
      console.log("\n  Profile saved. Starting Claude Code...\n");
      process.exit(0);
    }
  }

  if (profile) {
    // Build list of params that differ between profile and CLI defaults,
    // but only for flags NOT explicitly passed on this invocation.
    const conflicts: Array<{ param: string; cli: string; prof: string }> = [];
    if (!EXPLICIT_FLAGS.has("--leverage") && profile.leverage !== LEVERAGE)
      conflicts.push({ param: "leverage", cli: `${LEVERAGE}x`, prof: `${profile.leverage}x` });
    if (!EXPLICIT_FLAGS.has("--max-alloc") && profile.maxAllocPct !== MAX_ALLOC_PCT)
      conflicts.push({ param: "alloc", cli: `${MAX_ALLOC_PCT}%`, prof: `${profile.maxAllocPct}%` });
    if (!EXPLICIT_FLAGS.has("--circuit-breaker") && profile.circuitBreakerUsd !== CIRCUIT_BREAKER_USD)
      conflicts.push({ param: "circuit-breaker", cli: `$${CIRCUIT_BREAKER_USD}`, prof: `$${profile.circuitBreakerUsd}` });
    if (!EXPLICIT_FLAGS.has("--contrarian-pct") && profile.contrarianPct !== CONTRARIAN_PCT)
      conflicts.push({ param: "contrarian-pct", cli: `${CONTRARIAN_PCT}%`, prof: `${profile.contrarianPct}%` });
    if (!EXPLICIT_FLAGS.has("--coins") && profile.coins.join(",") !== COINS.join(","))
      conflicts.push({ param: "coins", cli: COINS.join(","), prof: profile.coins.join(",") });

    let useProfile = true;
    if (conflicts.length > 0 && process.stdin.isTTY) {
      console.log("\n  Profile settings differ from CLI defaults:");
      conflicts.forEach((c) => console.log(`    ${c.param}: profile=${c.prof}, CLI default=${c.cli}`));
      const { createInterface } = await import("readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      useProfile = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => { rl.close(); console.log("\n  (applying profile after 10s)"); resolve(true); }, 10_000);
        rl.question("\n  Apply profile settings? [Y/n] ", (ans) => {
          clearTimeout(timer);
          rl.close();
          const a = ans.trim().toLowerCase();
          resolve(a !== "n" && a !== "no");
        });
      });
    }

    if (useProfile) {
      // Apply profile — explicit CLI flags already override these (skipped in conflict list above)
      DISPLAY_NAME = profile.displayName ?? "Matt";
      if (!EXPLICIT_FLAGS.has("--leverage"))        LEVERAGE           = profile.leverage;
      if (!EXPLICIT_FLAGS.has("--max-alloc"))       MAX_ALLOC_PCT      = profile.maxAllocPct;
      if (!EXPLICIT_FLAGS.has("--circuit-breaker")) CIRCUIT_BREAKER_USD = profile.circuitBreakerUsd;
      if (!EXPLICIT_FLAGS.has("--contrarian-pct"))  CONTRARIAN_PCT     = profile.contrarianPct;
      if (!EXPLICIT_FLAGS.has("--coins"))           COINS              = profile.coins;
      MAX_CONTRARIAN_POS = Math.ceil(MAX_POSITIONS * CONTRARIAN_PCT / 100);
      if (conflicts.length > 0) {
        console.log("  Profile applied.\n");
      } else {
        // No conflicts — profile matched or was already reflected, nothing to report
      }
    }
  }

  // ── Help Banner ─────────────────────────────────────────────────────────────
  printHelpBanner();

  log("=== Trading Agent Starting ===");
  log(`Operator: ${DISPLAY_NAME}`);
  log(`Agent: ${AGENT_NAME}`);
  log(`Mode: ${DRY_RUN ? "PAPER (virtual)" : "LIVE"}`);
  log(`Log file: ${LOG_FILE}`);
  log(`Account: ${accountAddress}`);
  log(`Coins: ${COINS.join(", ")}`);
  log(`Max positions: ${MAX_POSITIONS} | Max alloc: ${MAX_ALLOC_PCT}% | Leverage: ${LEVERAGE}x`);
  log(`Interval: ${INTERVAL_MS / 60_000}min | Circuit breaker: -$${CIRCUIT_BREAKER_USD}`);
  log(`Session limit: ${SESSION_HOURS}h | Notify: ${NOTIFY}`);
  log(`Vol-detect: ${VOL_DETECT ? "ON (dynamic interval)" : "OFF"}`);
  log(`Sentiment: ${process.env.LUNARCRUSH_API_KEY ? "ON (LunarCrush)" : "OFF (no API key)"}`);
  log(`Contrarian: ${CONTRARIAN_PCT > 0 ? `${CONTRARIAN_PCT}% (max ${MAX_CONTRARIAN_POS} positions)` : "OFF"}`);
  log(`R4-short ADX: 22 (with DI spread > 8) | R3-long stop: -1.5% | R3 scale: 0.7x`);
  log(`Trailing stops: volatile arm +2%/trigger +0.8% | normal arm +1.2%/trigger +0.5%`);
  log(`R6 sentiment-confirmed: ON (30% size, galaxy>75+sent>85% or galaxy<30+sent<15%)`);

  // Log full config to file
  writeLog(`[CONFIG] ${JSON.stringify({
    agent: AGENT_NAME, dryRun: DRY_RUN, intervalMin: INTERVAL_MS / 60_000,
    coins: COINS, maxPositions: MAX_POSITIONS, maxAllocPct: MAX_ALLOC_PCT,
    leverage: LEVERAGE, circuitBreakerUsd: CIRCUIT_BREAKER_USD,
    sessionHours: SESSION_HOURS, notify: NOTIFY, verbose: VERBOSE,
    volDetect: VOL_DETECT, contrarianPct: CONTRARIAN_PCT, maxContrarianPos: MAX_CONTRARIAN_POS,
    account: accountAddress, testnet: opts.testnet ?? false,
  })}`);

  // Guard: live trading requires a wallet key
  if (!DRY_RUN && key === null) {
    log("[FATAL] Live trading requires HYPERLIQUID_PRIVATE_KEY — set it in hyperliquid-trader/.env");
    log("[FATAL] To paper trade without a wallet, use --dry-run");
    process.exit(1);
  }

  // Run startup health checks
  const doctorResults = await runDoctor(true);
  const fatalChecks = doctorResults.filter(r => r.status === "fail");
  if (fatalChecks.length > 0) {
    log(`[DOCTOR] ${fatalChecks.length} fatal check(s) failed — aborting startup`);
    process.exit(1);
  }

  // Initialize paper trading balance (prompt if --paper-balance not explicitly set)
  if (DRY_RUN) {
    const startingBalance = PAPER_BALANCE_EXPLICIT ? PAPER_BALANCE_USD : await promptPaperBalance(profile?.paperBalance);
    virtualBalance = startingBalance;
    initialCapital = startingBalance;
    log(`[PAPER] Paper trading mode — virtual balance: $${virtualBalance.toFixed(2)}`);
  }

  // Show initial balance
  const bal = DRY_RUN ? null : await getAvailableBalance();
  if (bal) {
    log(`Balance: account=$${bal.accountValue.toFixed(2)} margin=$${bal.marginUsed.toFixed(2)} available=$${bal.available.toFixed(2)}`);
    initialCapital = bal.accountValue;
  }

  // Register session in unified DB
  await registerSession({
    sessionId: AGENT_NAME,
    marketplace: "hyperliquid",
    mode: DRY_RUN ? "simulated" : "live",
    env: process.env.TRADER_ENV ?? "production",
    profileJson: profile ? JSON.stringify(profile) : undefined,
  });

  // Adopt existing positions
  await adoptExistingPositions();

  const startBalDisplay = DRY_RUN
    ? `$${virtualBalance.toFixed(2)} paper (virtual)`
    : `$${bal!.accountValue.toFixed(2)} (spot $${bal!.spotTotal.toFixed(2)} + perp $${bal!.perpValue.toFixed(2)})`;

  await notify({
    title: DRY_RUN ? "Paper Trading Started" : "Real Trading Started 🔥",
    tags: "rocket,robot",
    body: `Hey ${DISPLAY_NAME}, Opus reporting for duty.\n\n- **Balance:** ${startBalDisplay}\n- **Positions:** ${heldCoins.size} open\n- **Max:** ${MAX_POSITIONS}\n- **Coins:** ${COINS.join(", ")}\n- **Sentiment discovery:** ON (auto-adds coins with extreme sentiment)\n- **Leverage:** ${LEVERAGE}x\n- **Interval:** ${INTERVAL_MS / 60_000}min\n- **Vol-detect:** ${VOL_DETECT ? "ON" : "OFF"}\n- **Contrarian:** ${CONTRARIAN_PCT > 0 ? `${CONTRARIAN_PCT}% (max ${MAX_CONTRARIAN_POS} positions)` : "OFF"}\n\n_Let's cook._`,
  });

  // Main loop
  while (true) {
    const cycleStart = Date.now();
    try {
      const shouldContinue = await runCycle();
      consecutiveErrors = 0;
      if (!shouldContinue) break;
    } catch (err) {
      consecutiveErrors++;
      log(`[ERROR] Cycle ${cycleCount} failed: ${err}`);
      writeLog(`[ERROR STACK] ${err instanceof Error ? err.stack : String(err)}`);
      if (consecutiveErrors >= 3) {
        log(`[PAUSE] ${consecutiveErrors} consecutive errors — pausing 5 minutes`);
        await notify({ title: "Agent Paused ⚠️", tags: "warning,zzz", priority: "high", body: `**${consecutiveErrors} consecutive errors — cooling off 5min.**\n\n- **Last error:** ${err}\n\n_Will resume automatically._` });
        await sleep(5 * 60_000);
        consecutiveErrors = 0;
      }
    }

    // Sleep for remaining interval time (dynamic based on volatility)
    const elapsed = Date.now() - cycleStart;
    const effectiveInterval = INTERVAL_MS * sleepMultiplier;
    const remaining = Math.max(effectiveInterval - elapsed, 1000);
    verbose(`Cycle took ${(elapsed / 1000).toFixed(1)}s, sleeping ${(remaining / 1000).toFixed(0)}s${sleepMultiplier < 1 ? ` (vol ${sleepMultiplier}x)` : ""}`);
    await sleep(remaining);
  }

  log("=== Agent Stopped ===");
  log(`Session realized PnL: ${formatUsd(totalRealizedPnl)}`);
  persistLessons(); // save lessons before exit
  await notify({ title: "Agent Stopped", tags: "wave", body: `**Session complete.**\n\n- **Realized PnL:** ${formatUsd(totalRealizedPnl)}\n- **Record:** ${formatRecord()}\n\n_Until next time._` });
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  log("\n[SIGINT] Shutting down gracefully...");
  log(`Positions held (NOT closing): ${[...heldCoins].join(", ") || "none"}`);
  log(`Session realized PnL: ${formatUsd(totalRealizedPnl)}`);
  persistLessons(); // save lessons before exit
  await closeSession({
    sessionId: AGENT_NAME,
    statsJson: JSON.stringify({ wins: sessionWins, losses: sessionLosses, pnl: totalRealizedPnl }),
  });
  await notify({ title: "Agent Stopped (manual)", tags: "stop_sign", body: `**Ctrl+C — shutting down.**\n\n- **Positions held (NOT closed):** ${[...heldCoins].join(", ") || "none"}\n- **Realized PnL:** ${formatUsd(totalRealizedPnl)}\n- **Record:** ${formatRecord()}\n\n_Positions still live on Hyperliquid._` });

  // Shut down the Express server (reads PID written by server/index.ts on start)
  try {
    const pidFile = "/tmp/erde-server.pid";
    if (existsSync(pidFile)) {
      const pid = readFileSync(pidFile, "utf8").trim();
      if (pid) {
        process.kill(Number(pid), "SIGTERM");
        log(`[SIGINT] Express server (PID ${pid}) stopped.`);
      }
    }
  } catch { /* server already down or not started by us */ }

  process.exit(0);
});

main().catch((err) => {
  const errMsg = `Fatal error: ${err}`;
  console.error(errMsg);
  writeLog(`[FATAL] ${errMsg}`);
  writeLog(`[FATAL STACK] ${err instanceof Error ? err.stack : String(err)}`);
  notify({ title: "Agent Error 💀", tags: "warning,skull", priority: "high", body: `**Unhandled error — agent stopped.**\n\n- **Error:** ${err}\n- **Positions:** ${heldCoins.size} still open (NOT auto-closed)\n\n_Needs manual intervention._` }).finally(() => process.exit(1));
});
