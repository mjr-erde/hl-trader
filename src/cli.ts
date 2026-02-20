#!/usr/bin/env node
/**
 * Trader CLI — headless mode.
 * Uses backend API (shared with web). Requires --user for position commands.
 * Usage: npm run cli [command] [options]
 */

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import {
  apiGetOpenPositions,
  apiGetClosedPositions,
  apiOpenPosition,
  apiClosePosition,
  apiEnsureUser,
  apiGetUsers,
  apiExportUserHistory,
  apiResetUser,
  apiDeleteUser,
} from "./lib/api";
import { getCoins, getMid, getAllMids, getCandles } from "./lib/hyperliquid";
import { unrealizedPnl, margin, liquidationPrice, roe } from "./lib/pnl";
import { getStrategy } from "./lib/strategies/registry";
import {
  rsi,
  ema,
  macd,
  bollingerBands,
  atr,
  adx,
  detectRegime,
} from "./lib/indicators";
import { backtest as runBacktest } from "./lib/backtest";
import * as readline from "readline";

const DATA_DIR =
  process.env.TRADER_DATA_DIR ||
  path.join(process.cwd(), ".trader");
const API_URL = process.env.TRADER_API_URL || "http://localhost:3000";

async function ensureUser(name: string): Promise<{ id: number }> {
  process.env.TRADER_API_URL = API_URL;
  return apiEnsureUser(name);
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

const program = new Command();

program
  .name("trader")
  .description("Virtual perp trading simulator — headless CLI")
  .option("-u, --user <name>", "User name (required for position commands; creates user if not exists)", process.env.TRADER_USER)
  .option("-d, --data-dir <path>", "Data dir for journal, etc.", DATA_DIR)
  .option("--json", "Output as JSON");

program
  .command("list")
  .description("List open positions")
  .option("-c, --closed", "List closed positions instead")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader list -u matt");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    const json = program.opts().json;
    if (opts.closed) {
      const closed = await apiGetClosedPositions(user.id);
      if (json) {
        console.log(JSON.stringify(closed));
      } else {
        if (closed.length === 0) console.log("No closed positions.");
        else
          closed.forEach((p) => {
            const sign = p.realizedPnl >= 0 ? "+" : "";
            console.log(
              `${p.id} | ${p.coin} ${p.side} | ${p.size} @ ${p.entryPrice} → ${p.exitPrice} | ${sign}${p.realizedPnl.toFixed(2)} USDC`
            );
          });
      }
      return;
    }
    const open = await apiGetOpenPositions(user.id);
    if (open.length === 0) {
      console.log("No open positions.");
      return;
    }
    try {
      const mids = await getAllMids();
      if (json) {
        const withPnl = open.map((p) => {
          const price = parseFloat(mids[p.coin] ?? "0");
          const pnl = unrealizedPnl(p.side, p.entryPrice, price, p.size);
          const lev = p.leverage ?? 1;
          const mgn = margin(p.entryPrice, p.size, lev);
          const liq = liquidationPrice(p.side, p.entryPrice, lev);
          const roeVal = roe(pnl, mgn);
          return { ...p, currentPrice: price, unrealizedPnl: pnl, margin: mgn, liquidationPrice: liq, roe: roeVal };
        });
        console.log(JSON.stringify(withPnl));
      } else {
        for (const p of open) {
          const price = parseFloat(mids[p.coin] ?? "0");
          const pnl = unrealizedPnl(p.side, p.entryPrice, price, p.size);
          const sign = pnl >= 0 ? "+" : "";
          const lev = p.leverage ?? 1;
          const levStr = lev > 1 ? ` ${lev}x` : "";
          const mgn = margin(p.entryPrice, p.size, lev);
          const roeVal = roe(pnl, mgn);
          const roePct = (roeVal * 100).toFixed(2);
          const liq = liquidationPrice(p.side, p.entryPrice, lev);
          const liqStr = liq ? ` | liq ${liq.toFixed(2)}` : "";
          console.log(
            `${p.id} | ${p.coin} ${p.side}${levStr} | ${p.size} @ ${p.entryPrice} | now ${price} | ${sign}${pnl.toFixed(2)} USDC (${sign}${roePct}% ROE) | margin $${mgn.toFixed(2)}${liqStr}`
          );
        }
      }
    } catch (e) {
      console.error("Failed to fetch prices:", (e as Error).message);
      open.forEach((p) =>
        console.log(`${p.id} | ${p.coin} ${p.side} | ${p.size} @ ${p.entryPrice}`)
      );
    }
  });

program
  .command("buy")
  .description("Virtual buy (open long)")
  .requiredOption("-c, --coin <symbol>", "Coin symbol (e.g. BTC, ETH)")
  .requiredOption("-s, --size <number>", "Position size", parseFloat)
  .option("-l, --leverage <number>", "Leverage (1-50, default 1)", (v) => parseInt(v, 10) || 1)
  .option("-S, --strategy <id>", "Strategy ID", "manual")
  .option("-m, --comment <text>", "Comment for this trade")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader buy -u matt -c BTC -s 0.01");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    const strategy = getStrategy(opts.strategy);
    if (!strategy) {
      console.error(`Unknown strategy: ${opts.strategy}`);
      process.exit(1);
    }
    const price = await getMid(opts.coin);
    const lev = opts.leverage ?? 1;
    const pos = await apiOpenPosition(user.id, opts.coin, "long", price, opts.size, opts.strategy, lev, opts.comment);
    console.log(
      `Opened long ${opts.size} ${opts.coin} @ ${price} ${lev}x (id: ${pos.id})`
    );
  });

program
  .command("sell")
  .description("Virtual sell (open short)")
  .requiredOption("-c, --coin <symbol>", "Coin symbol")
  .requiredOption("-s, --size <number>", "Position size", parseFloat)
  .option("-l, --leverage <number>", "Leverage (1-50, default 1)", (v) => parseInt(v, 10) || 1)
  .option("-S, --strategy <id>", "Strategy ID", "manual")
  .option("-m, --comment <text>", "Comment for this trade")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader sell -u matt -c ETH -s 0.1");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    const strategy = getStrategy(opts.strategy);
    if (!strategy) {
      console.error(`Unknown strategy: ${opts.strategy}`);
      process.exit(1);
    }
    const price = await getMid(opts.coin);
    const lev = opts.leverage ?? 1;
    const pos = await apiOpenPosition(user.id, opts.coin, "short", price, opts.size, opts.strategy, lev, opts.comment);
    console.log(
      `Opened short ${opts.size} ${opts.coin} @ ${price} ${lev}x (id: ${pos.id})`
    );
  });

program
  .command("close")
  .description("Close a position")
  .requiredOption("--id <position-id>", "Position ID")
  .option("-c, --coin <symbol>", "Coin (for exit price; else use mid)")
  .option("-m, --comment <text>", "Comment for this trade")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader close -u matt --id <position-id>");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    const open = await apiGetOpenPositions(user.id);
    const pos = open.find((p) => p.id === opts.id);
    if (!pos) {
      console.error(`Position not found: ${opts.id}`);
      process.exit(1);
    }
    const coin = opts.coin ?? pos.coin;
    const exitPrice = await getMid(coin);
    const closed = await apiClosePosition(opts.id, exitPrice, opts.comment);
    if (closed) {
      const sign = closed.realizedPnl >= 0 ? "+" : "";
      console.log(
        `Closed ${pos.coin} ${pos.side} @ ${exitPrice} | PnL: ${sign}${closed.realizedPnl.toFixed(2)} USDC`
      );
    }
  });

program
  .command("users")
  .description("List users (requires backend running)")
  .action(async () => {
    process.env.TRADER_API_URL = API_URL;
    try {
      const list = await apiGetUsers();
      if (program.opts().json) {
        console.log(JSON.stringify(list));
      } else {
        if (list.length === 0) console.log("No users yet. Use any command with -u <name> to create one: trader list -u matt");
        else list.forEach((u) => console.log(`${u.id}\t${u.name}`));
      }
    } catch (e) {
      console.error("Failed to fetch users. Is the backend running? (make dev)");
      console.error((e as Error).message);
      process.exit(1);
    }
  });

program
  .command("reset")
  .description("Reset user: clear all positions, keep user. Prompts to export history first.")
  .option("-o, --out <path>", "Export trade history to this file before reset")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader reset -u matt");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    let outPath = opts.out;
    if (!outPath) {
      outPath = await prompt(`Export trade history to file (path or Enter to skip): `);
    }
    if (outPath) {
      try {
        const data = await apiExportUserHistory(user.id);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
        console.log(`Exported to ${outPath}`);
      } catch (e) {
        console.error("Export failed:", (e as Error).message);
        process.exit(1);
      }
    }
    await apiResetUser(user.id);
    console.log(`User ${userName} reset.`);
  });

program
  .command("delete")
  .description("Delete user: remove from database. Prompts to export history first.")
  .option("-o, --out <path>", "Export trade history to this file before delete")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader delete -u matt");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    let outPath = opts.out;
    if (!outPath) {
      outPath = await prompt(`Export trade history to file (path or Enter to skip): `);
    }
    if (outPath) {
      try {
        const data = await apiExportUserHistory(user.id);
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
        console.log(`Exported to ${outPath}`);
      } catch (e) {
        console.error("Export failed:", (e as Error).message);
        process.exit(1);
      }
    }
    await apiDeleteUser(user.id);
    console.log(`User ${userName} deleted.`);
  });

program
  .command("export")
  .description("Export full trade history for user to JSON file")
  .requiredOption("-o, --out <path>", "Output file path")
  .action(async (opts) => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader export -u matt -o history.json");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    const data = await apiExportUserHistory(user.id);
    fs.writeFileSync(opts.out, JSON.stringify(data, null, 2), "utf-8");
    console.log(`Exported ${data.positions.length} positions to ${opts.out}`);
  });

program
  .command("coins")
  .description("List available coins from Hyperliquid")
  .action(async () => {
    const coins = await getCoins();
    if (program.opts().json) {
      console.log(JSON.stringify(coins));
    } else {
      console.log(coins.join(" "));
    }
  });

// --- price ---

program
  .command("price")
  .description("Get current mid price for one or more coins")
  .requiredOption("-c, --coin <symbols>", "Comma-separated coin symbols")
  .action(async (opts) => {
    const symbols = (opts.coin as string).split(",").map((s) => s.trim());
    const mids = await getAllMids();
    const result: Record<string, number> = {};
    for (const sym of symbols) {
      const v = mids[sym];
      if (!v) {
        console.error(`Unknown coin: ${sym}`);
        process.exit(1);
      }
      result[sym] = parseFloat(v);
    }
    if (program.opts().json) {
      console.log(JSON.stringify(result));
    } else {
      for (const [sym, price] of Object.entries(result)) {
        console.log(`${sym}: ${price}`);
      }
    }
  });

// --- candles ---

const intervalMs: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

program
  .command("candles")
  .description("Fetch OHLCV candle data")
  .requiredOption("-c, --coin <symbol>", "Coin symbol")
  .option("-i, --interval <interval>", "Candle interval", "1h")
  .option("-l, --limit <number>", "Number of candles", "100")
  .action(async (opts) => {
    const ms = intervalMs[opts.interval];
    if (!ms) {
      console.error(
        `Invalid interval: ${opts.interval}. Valid: ${Object.keys(intervalMs).join(", ")}`
      );
      process.exit(1);
    }
    const limit = Math.min(parseInt(opts.limit, 10) || 100, 5000);
    const endTime = Date.now();
    const startTime = endTime - limit * ms;
    const raw = await getCandles(opts.coin, opts.interval, startTime, endTime);
    const parsed = raw.map((c) => ({
      t: c.t,
      o: parseFloat(c.o),
      h: parseFloat(c.h),
      l: parseFloat(c.l),
      c: parseFloat(c.c),
      v: c.v ? parseFloat(c.v) : 0,
    }));
    if (program.opts().json) {
      console.log(JSON.stringify(parsed));
    } else {
      console.log("Time                     | Open       | High       | Low        | Close      | Volume");
      console.log("─".repeat(90));
      for (const c of parsed) {
        const t = new Date(c.t).toISOString().replace("T", " ").slice(0, 19);
        console.log(
          `${t} | ${c.o.toFixed(2).padStart(10)} | ${c.h.toFixed(2).padStart(10)} | ${c.l.toFixed(2).padStart(10)} | ${c.c.toFixed(2).padStart(10)} | ${c.v.toFixed(0).padStart(10)}`
        );
      }
    }
  });

// --- indicators ---

program
  .command("indicators")
  .description("Compute technical indicators for a coin")
  .requiredOption("-c, --coin <symbol>", "Coin symbol")
  .option("-i, --interval <interval>", "Candle interval", "1h")
  .action(async (opts) => {
    const ms = intervalMs[opts.interval];
    if (!ms) {
      console.error(`Invalid interval: ${opts.interval}`);
      process.exit(1);
    }
    const endTime = Date.now();
    const startTime = endTime - 200 * ms;
    const raw = await getCandles(opts.coin, opts.interval, startTime, endTime);
    if (raw.length < 30) {
      console.error(`Not enough candle data (got ${raw.length}, need 30+)`);
      process.exit(1);
    }
    const closes = raw.map((c) => parseFloat(c.c));
    const highs = raw.map((c) => parseFloat(c.h));
    const lows = raw.map((c) => parseFloat(c.l));
    const price = closes[closes.length - 1];

    const rsiVal = rsi(closes, 14);
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdVal = macd(closes);
    const bb = bollingerBands(closes, 20, 2);
    const atrVal = atr(highs, lows, closes, 14);
    const adxVal = adx(highs, lows, closes, 14);
    const regime = detectRegime(adxVal.adx, bb.width);

    const result = {
      coin: opts.coin,
      interval: opts.interval,
      timestamp: Date.now(),
      price,
      rsi_14: round(rsiVal),
      ema_12: round(ema12),
      ema_26: round(ema26),
      macd: {
        macd: round(macdVal.macd),
        signal: round(macdVal.signal),
        histogram: round(macdVal.histogram),
      },
      bollinger: {
        upper: round(bb.upper),
        middle: round(bb.middle),
        lower: round(bb.lower),
        width: round(bb.width, 4),
      },
      atr_14: round(atrVal),
      adx: {
        adx: round(adxVal.adx),
        plusDI: round(adxVal.plusDI),
        minusDI: round(adxVal.minusDI),
      },
      regime,
    };

    if (program.opts().json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`${opts.coin} (${opts.interval}) @ ${price}`);
      console.log(`RSI(14):     ${result.rsi_14} — ${rsiLabel(result.rsi_14)}`);
      console.log(`EMA(12):     ${result.ema_12}`);
      console.log(`EMA(26):     ${result.ema_26}`);
      console.log(
        `MACD:        ${result.macd.macd} | signal: ${result.macd.signal} | hist: ${result.macd.histogram}`
      );
      console.log(
        `Bollinger:   ${result.bollinger.lower} — ${result.bollinger.middle} — ${result.bollinger.upper} (w: ${result.bollinger.width})`
      );
      console.log(`ATR(14):     ${result.atr_14}`);
      console.log(
        `ADX:         ${result.adx.adx} — ${adxLabel(result.adx.adx)} | +DI: ${result.adx.plusDI} | -DI: ${result.adx.minusDI}`
      );
      console.log(`Regime:      ${regime}`);
    }
  });

function round(n: number, decimals = 2): number {
  if (isNaN(n)) return n;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function rsiLabel(v: number): string {
  if (isNaN(v)) return "N/A";
  if (v > 70) return "overbought";
  if (v < 30) return "oversold";
  return "neutral";
}

function adxLabel(v: number): string {
  if (isNaN(v)) return "N/A";
  if (v > 25) return "trending";
  if (v < 20) return "weak/ranging";
  return "moderate";
}

// --- stats ---

program
  .command("stats")
  .description("Aggregate performance statistics")
  .action(async () => {
    const userName = program.opts().user;
    if (!userName) {
      console.error("--user is required. Example: trader stats -u matt");
      process.exit(1);
    }
    process.env.TRADER_API_URL = API_URL;
    const user = await ensureUser(userName);
    const closed = await apiGetClosedPositions(user.id);
    if (closed.length === 0) {
      console.log("No closed trades yet.");
      return;
    }

    const compute = (
      trades: typeof closed
    ) => {
      const wins = trades.filter((t) => t.realizedPnl > 0);
      const losses = trades.filter((t) => t.realizedPnl <= 0);
      const totalPnl = trades.reduce((s, t) => s + t.realizedPnl, 0);
      const winSum = wins.reduce((s, t) => s + t.realizedPnl, 0);
      const lossSum = losses.reduce((s, t) => s + t.realizedPnl, 0);
      return {
        total_trades: trades.length,
        total_pnl: round(totalPnl),
        wins: wins.length,
        losses: losses.length,
        win_rate: round(wins.length / trades.length, 4),
        avg_win: wins.length > 0 ? round(winSum / wins.length) : 0,
        avg_loss: losses.length > 0 ? round(lossSum / losses.length) : 0,
        best_trade: round(Math.max(...trades.map((t) => t.realizedPnl))),
        worst_trade: round(Math.min(...trades.map((t) => t.realizedPnl))),
        profit_factor:
          lossSum !== 0 ? round(winSum / Math.abs(lossSum), 4) : Infinity,
      };
    };

    const overall = compute(closed);

    // Group by strategy
    const byStrategy: Record<string, typeof closed> = {};
    for (const t of closed) {
      (byStrategy[t.strategyId] ??= []).push(t);
    }
    const stratStats: Record<string, ReturnType<typeof compute>> = {};
    for (const [k, v] of Object.entries(byStrategy)) stratStats[k] = compute(v);

    // Group by coin
    const byCoin: Record<string, typeof closed> = {};
    for (const t of closed) {
      (byCoin[t.coin] ??= []).push(t);
    }
    const coinStats: Record<string, ReturnType<typeof compute>> = {};
    for (const [k, v] of Object.entries(byCoin)) coinStats[k] = compute(v);

    const result = { ...overall, by_strategy: stratStats, by_coin: coinStats };

    if (program.opts().json) {
      console.log(JSON.stringify(result));
    } else {
      console.log("=== Overall ===");
      console.log(`Trades: ${overall.total_trades} (${overall.wins}W / ${overall.losses}L)`);
      console.log(`Win rate: ${(overall.win_rate * 100).toFixed(1)}%`);
      console.log(`Total PnL: ${overall.total_pnl >= 0 ? "+" : ""}${overall.total_pnl} USDC`);
      console.log(`Avg win: +${overall.avg_win} | Avg loss: ${overall.avg_loss}`);
      console.log(`Best: +${overall.best_trade} | Worst: ${overall.worst_trade}`);
      console.log(`Profit factor: ${overall.profit_factor}`);
      if (Object.keys(stratStats).length > 1) {
        console.log("\n=== By Strategy ===");
        for (const [k, v] of Object.entries(stratStats)) {
          console.log(`  ${k}: ${v.total_trades} trades, ${v.total_pnl >= 0 ? "+" : ""}${v.total_pnl} USDC, ${(v.win_rate * 100).toFixed(1)}% win`);
        }
      }
      if (Object.keys(coinStats).length > 1) {
        console.log("\n=== By Coin ===");
        for (const [k, v] of Object.entries(coinStats)) {
          console.log(`  ${k}: ${v.total_trades} trades, ${v.total_pnl >= 0 ? "+" : ""}${v.total_pnl} USDC, ${(v.win_rate * 100).toFixed(1)}% win`);
        }
      }
    }
  });

// --- journal ---

const journal = program
  .command("journal")
  .description("Trade journal for agent learning");

journal
  .command("log")
  .description("Log reasoning and lesson for a trade")
  .requiredOption("--trade-id <id>", "Position/trade ID")
  .option("--reasoning <text>", "Entry reasoning")
  .option("--lesson <text>", "Lesson learned")
  .action((opts) => {
    const dir = path.join(program.opts().dataDir, "journal");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entry = {
      trade_id: opts.tradeId,
      timestamp: new Date().toISOString(),
      reasoning: opts.reasoning || "",
      lesson: opts.lesson || "",
    };
    fs.appendFileSync(
      path.join(dir, "trades.jsonl"),
      JSON.stringify(entry) + "\n"
    );
    if (program.opts().json) {
      console.log(JSON.stringify(entry));
    } else {
      console.log(`Logged journal entry for trade ${opts.tradeId}`);
    }
  });

journal
  .command("recent")
  .description("Show recent journal entries")
  .option("-l, --limit <number>", "Number of entries", "10")
  .action((opts) => {
    const file = path.join(program.opts().dataDir, "journal", "trades.jsonl");
    if (!fs.existsSync(file)) {
      console.log("No journal entries yet.");
      return;
    }
    const lines = fs
      .readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const limit = parseInt(opts.limit, 10) || 10;
    const recent = lines.slice(-limit).map((l) => JSON.parse(l));
    if (program.opts().json) {
      console.log(JSON.stringify(recent));
    } else {
      for (const e of recent) {
        console.log(`[${e.timestamp}] ${e.trade_id}`);
        if (e.reasoning) console.log(`  Reasoning: ${e.reasoning}`);
        if (e.lesson) console.log(`  Lesson: ${e.lesson}`);
      }
    }
  });

journal
  .command("lessons")
  .description("Extract and count unique lessons")
  .action(() => {
    const file = path.join(program.opts().dataDir, "journal", "trades.jsonl");
    if (!fs.existsSync(file)) {
      console.log("No journal entries yet.");
      return;
    }
    const lines = fs
      .readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const counts = new Map<string, { count: number; last_seen: string }>();
    for (const line of lines) {
      const e = JSON.parse(line);
      if (!e.lesson) continue;
      const existing = counts.get(e.lesson);
      if (existing) {
        existing.count++;
        existing.last_seen = e.timestamp;
      } else {
        counts.set(e.lesson, { count: 1, last_seen: e.timestamp });
      }
    }
    const sorted = [...counts.entries()]
      .map(([lesson, v]) => ({ lesson, ...v }))
      .sort((a, b) => b.count - a.count);
    if (program.opts().json) {
      console.log(JSON.stringify(sorted));
    } else {
      if (sorted.length === 0) {
        console.log("No lessons recorded yet.");
        return;
      }
      sorted.forEach((l, i) => {
        console.log(`${i + 1}. (${l.count}x) ${l.lesson}`);
      });
    }
  });

// --- scan ---

const SCAN_COINS = ["BTC", "ETH", "SOL", "DOGE", "SUI", "LINK", "AVAX"];

program
  .command("scan")
  .description("Scan all coins for trading signals (checks all rules on 1h + 15m)")
  .option("-c, --coins <list>", "Comma-separated coins to scan", SCAN_COINS.join(","))
  .action(async (opts) => {
    const coins = (opts.coins as string).split(",").map((s) => s.trim());
    const json = program.opts().json;
    const results: Array<{
      coin: string;
      price: number;
      regime_1h: string;
      adx_1h: number;
      plusDI_1h: number;
      minusDI_1h: number;
      rsi_1h: number;
      macd_hist_1h: number;
      bb_width_1h: number;
      rsi_15m: number;
      signals: string[];
    }> = [];

    for (const coin of coins) {
      try {
        // Fetch 1h candles (primary)
        const end = Date.now();
        const raw1h = await getCandles(coin, "1h", end - 200 * 3_600_000, end);
        const raw15m = await getCandles(coin, "15m", end - 200 * 900_000, end);

        if (raw1h.length < 50 || raw15m.length < 50) continue;

        const c1h = raw1h.map((c) => parseFloat(c.c));
        const h1h = raw1h.map((c) => parseFloat(c.h));
        const l1h = raw1h.map((c) => parseFloat(c.l));
        const c15m = raw15m.map((c) => parseFloat(c.c));

        const price = c1h[c1h.length - 1];
        const rsi1h = rsi(c1h, 14);
        const macd1h = macd(c1h);
        const bb1h = bollingerBands(c1h, 20, 2);
        const adx1h = adx(h1h, l1h, c1h, 14);
        const regime1h = detectRegime(adx1h.adx, bb1h.width);
        const rsi15m = rsi(c15m, 14);

        // Check rules using 1h
        const signals: string[] = [];
        if (rsi1h < 30 && regime1h !== "trending" && regime1h !== "volatile_trend")
          signals.push("R1-long (RSI oversold)");
        if (rsi1h > 70 && regime1h !== "trending" && regime1h !== "volatile_trend")
          signals.push("R2-short (RSI overbought)");
        if (adx1h.adx > 25 && adx1h.plusDI > adx1h.minusDI && rsi1h > 50 && macd1h.histogram > 0)
          signals.push("R3-long (trend)");
        if (adx1h.adx > 25 && adx1h.minusDI > adx1h.plusDI && rsi1h < 50 && macd1h.histogram < 0)
          signals.push("R4-short (trend)");
        if (bb1h.width < 0.01)
          signals.push("R5-squeeze (watch for breakout)");
        if (bb1h.width > 0.015 && price > bb1h.upper)
          signals.push("R5-long (breakout up)");
        if (bb1h.width > 0.015 && price < bb1h.lower)
          signals.push("R5-short (breakout down)");

        results.push({
          coin,
          price: round(price),
          regime_1h: regime1h,
          adx_1h: round(adx1h.adx),
          plusDI_1h: round(adx1h.plusDI),
          minusDI_1h: round(adx1h.minusDI),
          rsi_1h: round(rsi1h),
          macd_hist_1h: round(macd1h.histogram),
          bb_width_1h: round(bb1h.width, 4),
          rsi_15m: round(rsi15m),
          signals,
        });
      } catch (e) {
        if (!json) console.error(`${coin}: ${(e as Error).message}`);
      }
    }

    if (json) {
      console.log(JSON.stringify(results));
    } else {
      console.log("COIN   PRICE        REGIME          ADX   +DI   -DI   RSI(1h) RSI(15m) MACD    SIGNALS");
      console.log("─".repeat(110));
      for (const r of results) {
        const sigs = r.signals.length > 0 ? r.signals.join(", ") : "—";
        console.log(
          `${r.coin.padEnd(6)} ${String(r.price).padStart(11)} ${r.regime_1h.padEnd(15)} ${String(r.adx_1h).padStart(5)} ${String(r.plusDI_1h).padStart(5)} ${String(r.minusDI_1h).padStart(5)} ${String(r.rsi_1h).padStart(7)} ${String(r.rsi_15m).padStart(8)} ${String(r.macd_hist_1h).padStart(7)}  ${sigs}`
        );
      }
    }
  });

// --- correlate ---

program
  .command("correlate")
  .description("Compute price correlation matrix between coins")
  .option("-c, --coins <list>", "Comma-separated coins", SCAN_COINS.join(","))
  .option("-i, --interval <interval>", "Candle interval", "1h")
  .option("-l, --limit <number>", "Number of candles", "100")
  .action(async (opts) => {
    const coins = (opts.coins as string).split(",").map((s) => s.trim());
    const json = program.opts().json;
    const ms = intervalMs[opts.interval];
    if (!ms) {
      console.error(`Invalid interval: ${opts.interval}`);
      process.exit(1);
    }
    const limit = parseInt(opts.limit, 10) || 100;
    const end = Date.now();
    const start = end - limit * ms;

    // Fetch candle closes for each coin
    const returns: Record<string, number[]> = {};
    for (const coin of coins) {
      try {
        const raw = await getCandles(coin, opts.interval, start, end);
        const closes = raw.map((c) => parseFloat(c.c));
        // Compute log returns
        const rets: number[] = [];
        for (let i = 1; i < closes.length; i++) {
          rets.push(Math.log(closes[i] / closes[i - 1]));
        }
        returns[coin] = rets;
      } catch (e) {
        if (!json) console.error(`${coin}: ${(e as Error).message}`);
      }
    }

    const available = Object.keys(returns);
    // Trim to same length
    const minLen = Math.min(...available.map((c) => returns[c].length));

    function pearson(a: number[], b: number[]): number {
      const n = Math.min(a.length, b.length, minLen);
      const ax = a.slice(-n), bx = b.slice(-n);
      const meanA = ax.reduce((s, v) => s + v, 0) / n;
      const meanB = bx.reduce((s, v) => s + v, 0) / n;
      let cov = 0, varA = 0, varB = 0;
      for (let i = 0; i < n; i++) {
        const da = ax[i] - meanA, db = bx[i] - meanB;
        cov += da * db;
        varA += da * da;
        varB += db * db;
      }
      return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0;
    }

    // Build matrix
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of available) {
      matrix[a] = {};
      for (const b of available) {
        matrix[a][b] = round(pearson(returns[a], returns[b]), 3);
      }
    }

    // Average correlation (excluding self)
    const avgCorrs: Record<string, number> = {};
    for (const a of available) {
      const others = available.filter((b) => b !== a);
      avgCorrs[a] = round(others.reduce((s, b) => s + matrix[a][b], 0) / others.length, 3);
    }
    const overallAvg = round(
      Object.values(avgCorrs).reduce((s, v) => s + v, 0) / available.length,
      3
    );

    if (json) {
      console.log(JSON.stringify({ matrix, avgCorrelation: avgCorrs, overallAvg, bars: minLen }));
    } else {
      console.log(`Correlation matrix (${minLen} ${opts.interval} bars)\n`);
      // Header
      console.log("       " + available.map((c) => c.padStart(7)).join(""));
      for (const a of available) {
        const row = available.map((b) => {
          const v = matrix[a][b];
          return (v === 1 ? "  1.00" : (v >= 0 ? " " : "") + v.toFixed(3)).padStart(7);
        }).join("");
        console.log(`${a.padEnd(6)} ${row}`);
      }
      console.log(`\nAvg correlation per coin:`);
      for (const [c, v] of Object.entries(avgCorrs)) {
        console.log(`  ${c}: ${v}`);
      }
      console.log(`\nOverall average: ${overallAvg}`);
      if (overallAvg > 0.7) {
        console.log(`⚠ HIGH CORRELATION: positions are not diversified. Consider reducing exposure.`);
      }
    }
  });

// --- backtest ---

program
  .command("backtest")
  .description("Backtest trading rules against historical candle data")
  .requiredOption("-c, --coin <symbol>", "Coin symbol")
  .option("-i, --interval <interval>", "Candle interval", "1h")
  .option("-d, --days <number>", "Days of history to test", "14")
  .option("-s, --size <number>", "Notional $ per trade", "12000")
  .action(async (opts) => {
    const json = program.opts().json;
    const ms = intervalMs[opts.interval];
    if (!ms) {
      console.error(`Invalid interval: ${opts.interval}`);
      process.exit(1);
    }
    const days = parseInt(opts.days, 10) || 14;
    const posSize = parseFloat(opts.size) || 12000;
    const end = Date.now();
    const start = end - days * 86_400_000;
    const raw = await getCandles(opts.coin, opts.interval, start, end);
    const candles = raw.map((c) => ({
      t: c.t,
      o: parseFloat(c.o),
      h: parseFloat(c.h),
      l: parseFloat(c.l),
      c: parseFloat(c.c),
    }));

    if (candles.length < 60) {
      console.error(`Not enough data: got ${candles.length} candles, need 60+`);
      process.exit(1);
    }

    const result = runBacktest({
      coin: opts.coin,
      candles,
      capital: 100000,
      positionSize: posSize,
    });

    if (json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`\n=== Backtest: ${opts.coin} ${opts.interval} (${days} days, ${candles.length} bars) ===\n`);
      console.log(`Trades:        ${result.trades.length} (${result.wins}W / ${result.losses}L)`);
      console.log(`Win rate:      ${(result.winRate * 100).toFixed(1)}%`);
      console.log(`Total PnL:     ${result.totalPnl >= 0 ? "+" : ""}$${result.totalPnl}`);
      console.log(`Avg win:       +$${result.avgWin}`);
      console.log(`Avg loss:      -$${result.avgLoss}`);
      console.log(`Profit factor: ${result.profitFactor}`);
      console.log(`Max drawdown:  ${result.maxDrawdown}%`);
      console.log(`Sharpe:        ${result.sharpe}`);

      if (Object.keys(result.byRule).length > 0) {
        console.log(`\n--- By Rule ---`);
        for (const [rule, stats] of Object.entries(result.byRule)) {
          console.log(`  ${rule}: ${stats.trades} trades, ${stats.pnl >= 0 ? "+" : ""}$${stats.pnl}, ${(stats.winRate * 100).toFixed(0)}% win`);
        }
      }

      if (result.trades.length > 0) {
        console.log(`\n--- Exit Reasons ---`);
        const exitCounts: Record<string, number> = {};
        for (const t of result.trades) {
          exitCounts[t.exitReason] = (exitCounts[t.exitReason] || 0) + 1;
        }
        for (const [reason, count] of Object.entries(exitCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${reason}: ${count}`);
        }
      }
    }
  });

program.parse();
