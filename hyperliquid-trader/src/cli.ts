#!/usr/bin/env node
/**
 * Hyperliquid real trading CLI.
 * Requires HYPERLIQUID_PRIVATE_KEY or --key-file.
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Load .env from the hyperliquid-trader directory regardless of CWD
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });
import { Command } from "commander";
import {
  createClients,
  getBalance,
  getMeta,
  getMidPrice,
  getPositions,
  placeMarketOrder,
  closePosition,
} from "./exchange.js";
import { exportAllTransactions } from "./export.js";
import { loadPrivateKey } from "./keyloader.js";
import { confirmTrade } from "./safety.js";
import { defaultUsername, logTradeOpen, logTradeClose } from "./tradelog.js";
import { runSyncStrategies } from "./sync-strategies.js";
import {
  fetchSentiment,
  detectSentimentSignals,
  formatSnapshotRow,
  snapshotTableHeader,
  type SentimentSnapshot,
} from "./sentiment.js";

const program = new Command();

const DEFAULT_ACCOUNT_ENV = "HYPERLIQUID_ACCOUNT_ADDRESS";

program
  .name("hyperliquid-trader")
  .description("Secure CLI for real trading on Hyperliquid")
  .option("--testnet", "Use testnet")
  .option("--key-file <path>", "Path to file containing private key")
  .option("--key-env <name>", "Env var name for private key", "HYPERLIQUID_PRIVATE_KEY")
  .option("--account <address>", "Main wallet address (for balance/positions; required with agent wallets)")
  .option("--account-env <name>", "Env var for main wallet address", DEFAULT_ACCOUNT_ENV)
  .option("--dry-run", "Log actions without executing")
  .option("--confirm", "Prompt before executing trades")
  .option("-u, --user <name>", "Username for trade logging (default: TRADER_USER or claude-opus-<datetime>)", process.env.TRADER_USER)
  .option("--no-log", "Disable logging trades to trader backend")
  .option("-m, --strategy-reason <text>", "Strategy/reason for the trade (default: 'CLI manual' when logging)");

function getKeyAndClients(opts: {
  testnet?: boolean;
  keyFile?: string;
  keyEnv?: string;
  account?: string;
  accountEnv?: string;
}) {
  const key = loadPrivateKey({ keyFile: opts.keyFile, keyEnv: opts.keyEnv });
  if (key === null) {
    console.error("Error: HYPERLIQUID_PRIVATE_KEY is required for the CLI (real orders). Set it in hyperliquid-trader/.env");
    process.exit(1);
  }
  const { info, exchange, wallet } = createClients({ privateKey: key, testnet: opts.testnet });
  const accountEnv = opts.accountEnv ?? DEFAULT_ACCOUNT_ENV;
  const accountAddress = (opts.account ?? process.env[accountEnv] ?? wallet!.address) as `0x${string}`;
  return { info, exchange: exchange!, wallet: wallet!, accountAddress };
}

program
  .command("balance")
  .description("Show account balance (perp margin + spot USDC/tokens)")
  .action(async () => {
    const opts = program.opts();
    const { info, wallet, accountAddress } = getKeyAndClients(opts);
    const { perp, spot } = await getBalance(info, accountAddress);
    console.log("Account (queried):", accountAddress);
    if (accountAddress !== wallet.address) {
      console.log("Signer (agent):", wallet.address);
    }
    console.log("Perp margin:");
    console.log("  Account value:", perp.accountValue);
    console.log("  Margin used:", perp.totalMarginUsed);
    console.log("  Withdrawable:", perp.withdrawable);
    if (spot.length > 0) {
      console.log("Spot:");
      for (const b of spot) {
        console.log(`  ${b.coin}: ${b.total} (hold: ${b.hold})`);
      }
    }
  });

program
  .command("assets")
  .description("List tradeable perpetual assets")
  .action(async () => {
    const opts = program.opts();
    const { info } = getKeyAndClients(opts);
    const meta = await getMeta(info);
    const names = meta.universe.filter((a) => !a.isDelisted).map((a) => a.name);
    console.log(names.join(" "));
  });

program
  .command("transfer <amount>")
  .description("Transfer USDC between Spot and Perp (no fees)")
  .option("--to-perp", "Spot → Perp (default)")
  .option("--to-spot", "Perp → Spot")
  .action(async (amount: string, cmdOpts: { toPerp?: boolean; toSpot?: boolean }) => {
    const opts = program.opts();
    const amt = parseFloat(amount);
    if (amt <= 0 || !Number.isFinite(amt)) throw new Error("Amount must be a positive number");
    const toPerp = cmdOpts.toSpot ? false : true;
    const summary = `Transfer $${amt} USDC ${toPerp ? "Spot → Perp" : "Perp → Spot"}`;
    const ok = await confirmTrade({ dryRun: opts.dryRun, confirm: opts.confirm }, summary);
    if (!ok) return;
    const { exchange } = getKeyAndClients(opts);
    if (!opts.dryRun) {
      await exchange.usdClassTransfer({ amount: String(amt), toPerp });
      console.log("Done.");
    }
  });

program
  .command("export")
  .description("Export all transactions (fills, funding, ledger) for tax/financial analysis")
  .option("-o, --output <path>", "Output file (default: hyperliquid-tx-<address>.json)")
  .option("--start <iso-date>", "Start date (YYYY-MM-DD). Default: 1 year ago")
  .option("--end <iso-date>", "End date (YYYY-MM-DD). Default: now")
  .option("--csv", "Output CSV instead of JSON")
  .action(async (cmdOpts: { output?: string; start?: string; end?: string; csv?: boolean }) => {
    const opts = program.opts();
    const { info, accountAddress } = getKeyAndClients(opts);
    const endTime = cmdOpts.end
      ? new Date(cmdOpts.end).getTime()
      : Date.now();
    const startTime = cmdOpts.start
      ? new Date(cmdOpts.start).getTime()
      : endTime - 365 * 24 * 60 * 60 * 1000;

    console.log("Fetching transactions...");
    const txs = await exportAllTransactions(info, accountAddress, { startTime, endTime });
    console.log(`Fetched ${txs.length} transactions`);

    const ext = cmdOpts.csv ? "csv" : "json";
    const outPath =
      cmdOpts.output ?? `hyperliquid-tx-${accountAddress.slice(2, 10)}.${ext}`;

    const fs = await import("fs");
    if (cmdOpts.csv) {
      const rows: string[] = [
        "type,time,time_iso,hash,coin,px,sz,side,closedPnl,fee,feeToken,oid,tid,delta",
      ];
      for (const tx of txs) {
        const timeIso = new Date(tx.time).toISOString();
        const delta = tx.delta ? JSON.stringify(tx.delta).replace(/"/g, '""') : "";
        const cells = [
          tx.type,
          tx.time,
          timeIso,
          tx.hash,
          (tx as { coin?: string }).coin ?? "",
          (tx as { px?: string }).px ?? "",
          (tx as { sz?: string }).sz ?? "",
          (tx as { side?: string }).side ?? "",
          (tx as { closedPnl?: string }).closedPnl ?? "",
          (tx as { fee?: string }).fee ?? "",
          (tx as { feeToken?: string }).feeToken ?? "",
          (tx as { oid?: number }).oid ?? "",
          (tx as { tid?: number }).tid ?? "",
          delta,
        ];
        rows.push(
          cells
            .map((v) => {
              const s = String(v);
              return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
            })
            .join(",")
        );
      }
      fs.writeFileSync(outPath, rows.join("\n"), "utf-8");
    } else {
      fs.writeFileSync(
        outPath,
        JSON.stringify(
          {
            account: accountAddress,
            startTime,
            endTime,
            count: txs.length,
            transactions: txs,
          },
          null,
          2
        ),
        "utf-8"
      );
    }
    console.log("Wrote", outPath);
  });

program
  .command("positions")
  .description("List open positions")
  .action(async () => {
    const opts = program.opts();
    const { info, accountAddress } = getKeyAndClients(opts);
    const positions = await getPositions(info, accountAddress);
    if (positions.length === 0) {
      console.log("No open positions");
      return;
    }
    for (const p of positions) {
      console.log(`${p.coin} ${p.side} size=${p.szi} entry=${p.entryPx} lev=${p.leverage.value}x`);
    }
  });

program
  .command("buy <coin> [size]")
  .description("Open long position (market order)")
  .option("-n, --notional <usd>", "Notional in USD (compute size from mid price)")
  .option("-l, --leverage <n>", "Leverage", "5")
  .option("-s, --slippage <bps>", "Slippage in basis points", "50")
  .action(async (coin: string, size: string | undefined, cmdOpts: { notional?: string; leverage?: string; slippage?: string }) => {
    const opts = program.opts();
    const { info, exchange } = getKeyAndClients(opts);
    const meta = await getMeta(info);
    const asset = meta.universe.find((a) => a.name === coin);
    if (!asset) throw new Error(`Unknown coin: ${coin}. Run 'assets' to list.`);
    const mid = await getMidPrice(info, coin);
    const midNum = parseFloat(mid);
    let sizeNum: number;
    if (cmdOpts.notional) {
      const notional = parseFloat(cmdOpts.notional);
      sizeNum = notional / midNum;
      const decimals = asset.szDecimals ?? 4;
      sizeNum = parseFloat(sizeNum.toFixed(decimals));
    } else if (size != null) {
      sizeNum = parseFloat(size);
    } else {
      throw new Error("Provide size or --notional <usd>");
    }
    const lev = parseInt(cmdOpts.leverage ?? "5", 10);
    const slippage = parseInt(cmdOpts.slippage ?? "50", 10);
    const summary = `BUY ${sizeNum} ${coin} long @ ~market (${lev}x)`;
    const ok = await confirmTrade(
      { dryRun: opts.dryRun, confirm: opts.confirm },
      summary
    );
    if (!ok) return;
    console.log("Mid price:", mid);
    const result = await placeMarketOrder(exchange, info, coin, "long", sizeNum, lev, slippage);
    console.log("Order result:", JSON.stringify(result, null, 2));
    if (!opts.dryRun && opts.log !== false) {
      const username = opts.user ?? defaultUsername();
      const res = result as { response?: { data?: { statuses?: Array<{ filled?: { totalSz?: string; avgPx?: string; oid?: number; tid?: number } }> } } };
      const filled = res?.response?.data?.statuses?.[0]?.filled;
      await logTradeOpen({
        username,
        coin,
        side: "long",
        entryPrice: midNum,
        size: sizeNum,
        leverage: lev,
        strategyReason: opts.strategyReason ?? "CLI manual",
        orderId: filled?.oid != null ? String(filled.oid) : undefined,
        tid: filled?.tid != null ? String(filled.tid) : undefined,
      });
    }
  });

program
  .command("sell <coin> [size]")
  .description("Open short position (market order)")
  .option("-n, --notional <usd>", "Notional in USD (compute size from mid price)")
  .option("-l, --leverage <n>", "Leverage", "5")
  .option("-s, --slippage <bps>", "Slippage in basis points", "50")
  .action(async (coin: string, size: string | undefined, cmdOpts: { notional?: string; leverage?: string; slippage?: string }) => {
    const opts = program.opts();
    const { info, exchange } = getKeyAndClients(opts);
    const meta = await getMeta(info);
    const asset = meta.universe.find((a) => a.name === coin);
    if (!asset) throw new Error(`Unknown coin: ${coin}. Run 'assets' to list.`);
    const mid = await getMidPrice(info, coin);
    const midNum = parseFloat(mid);
    let sizeNum: number;
    if (cmdOpts.notional) {
      const notional = parseFloat(cmdOpts.notional);
      sizeNum = notional / midNum;
      const decimals = asset.szDecimals ?? 4;
      sizeNum = parseFloat(sizeNum.toFixed(decimals));
    } else if (size != null) {
      sizeNum = parseFloat(size);
    } else {
      throw new Error("Provide size or --notional <usd>");
    }
    const lev = parseInt(cmdOpts.leverage ?? "5", 10);
    const slippage = parseInt(cmdOpts.slippage ?? "50", 10);
    const summary = `SELL ${sizeNum} ${coin} short @ ~market (${lev}x)`;
    const ok = await confirmTrade(
      { dryRun: opts.dryRun, confirm: opts.confirm },
      summary
    );
    if (!ok) return;
    console.log("Mid price:", mid);
    const result = await placeMarketOrder(exchange, info, coin, "short", sizeNum, lev, slippage);
    console.log("Order result:", JSON.stringify(result, null, 2));
    if (!opts.dryRun && opts.log !== false) {
      const username = opts.user ?? defaultUsername();
      const res = result as { response?: { data?: { statuses?: Array<{ filled?: { oid?: number; tid?: number } }> } } };
      const filled = res?.response?.data?.statuses?.[0]?.filled;
      await logTradeOpen({
        username,
        coin,
        side: "short",
        entryPrice: midNum,
        size: sizeNum,
        leverage: lev,
        strategyReason: opts.strategyReason ?? "CLI manual",
        orderId: filled?.oid != null ? String(filled.oid) : undefined,
        tid: filled?.tid != null ? String(filled.tid) : undefined,
      });
    }
  });

program
  .command("test-rig")
  .description("$1 leveraged perp round-trip: buy, hold 30s, close (for connectivity/credential testing)")
  .option("-c, --coin <symbol>", "Coin to trade", "DOGE")
  .option("-n, --notional <usd>", "Notional in USD", "1")
  .option("-l, --leverage <n>", "Leverage", "2")
  .option("-H, --hold <seconds>", "Hold time in seconds", "30")
  .action(async (cmdOpts: { coin?: string; notional?: string; leverage?: string; hold?: string }) => {
    const opts = program.opts();
    const coin = cmdOpts.coin ?? "DOGE";
    const notional = parseFloat(cmdOpts.notional ?? "1");
    const leverage = parseInt(cmdOpts.leverage ?? "2", 10);
    const holdSec = parseInt(cmdOpts.hold ?? "30", 10);

    const { info, exchange, accountAddress } = getKeyAndClients(opts);
    const meta = await getMeta(info);
    const asset = meta.universe.find((a) => a.name === coin);
    if (!asset) throw new Error(`Unknown coin: ${coin}. Run 'assets' to list.`);

    const mid = await getMidPrice(info, coin);
    const midNum = parseFloat(mid);
    const size = notional / midNum;
    const decimals = asset.szDecimals ?? 2;
    const sizeRounded = parseFloat(size.toFixed(decimals));

    if (sizeRounded <= 0) throw new Error(`Size too small for $${notional} @ ${mid}`);

    const summary = `TEST-RIG: open $${notional} long ${coin} (size=${sizeRounded}), hold ${holdSec}s, close`;
    const ok = await confirmTrade({ dryRun: opts.dryRun, confirm: opts.confirm }, summary);
    if (!ok) return;

    console.log(`Opening $${notional} long ${coin} @ ${mid} (size=${sizeRounded}, ${leverage}x)`);
    if (!opts.dryRun) {
      await placeMarketOrder(exchange, info, coin, "long", sizeRounded, leverage, 100);
      console.log(`Holding ${holdSec}s...`);
      await new Promise((r) => setTimeout(r, holdSec * 1000));
      console.log("Closing...");
      await closePosition(exchange, info, accountAddress, coin);
      console.log("Done.");
    }
  });

program
  .command("sync-strategies")
  .description("Sync strategy_reason from agent log files into hl_trades (backfill missing strategies)")
  .option("-d, --logs-dir <path>", "Logs directory", "logs")
  .option("-u, --username <name>", "Only sync for this username")
  .option("--dry-run", "Show what would be updated without writing")
  .option("--window <minutes>", "Time window for matching trade to log entry (minutes)", "15")
  .action(async (cmdOpts: { logsDir?: string; username?: string; dryRun?: boolean; window?: string }) => {
    const pathMod = await import("path");
    const projectRoot = pathMod.resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const logsDir = cmdOpts.logsDir
      ? (cmdOpts.logsDir.startsWith("/") ? cmdOpts.logsDir : pathMod.resolve(process.cwd(), cmdOpts.logsDir))
      : pathMod.resolve(projectRoot, "logs");
    const result = await runSyncStrategies({
      logsDir,
      username: cmdOpts.username,
      dryRun: cmdOpts.dryRun,
      windowMinutes: cmdOpts.window ? parseInt(cmdOpts.window, 10) : 15,
    });
    console.log(`Done: ${result.updated} updated, ${result.skipped} skipped (already had strategy)`);
    if (result.errors.length > 0) {
      console.error("Errors:");
      result.errors.forEach((e) => console.error("  ", e));
    }
  });

program
  .command("close <coin>")
  .description("Close position (market reduce-only)")
  .action(async (coin: string) => {
    const opts = program.opts();
    const summary = `CLOSE position ${coin}`;
    const ok = await confirmTrade(
      { dryRun: opts.dryRun, confirm: opts.confirm },
      summary
    );
    if (!ok) return;
    const { info, exchange, accountAddress } = getKeyAndClients(opts);
    const positions = await getPositions(info, accountAddress);
    const pos = positions.find((p) => p.coin === coin);
    const result = await closePosition(exchange, info, accountAddress, coin);
    console.log("Close result:", JSON.stringify(result, null, 2));
    if (!opts.dryRun && opts.log !== false && pos) {
      const username = opts.user ?? defaultUsername();
      const mid = await getMidPrice(info, coin);
      const exitPx = parseFloat(mid);
      const entryPx = parseFloat(pos.entryPx);
      const sz = Math.abs(parseFloat(pos.szi));
      const realizedPnl =
        pos.side === "long"
          ? sz * (exitPx - entryPx)
          : sz * (entryPx - exitPx);
      await logTradeClose({
        username,
        coin,
        side: pos.side,
        exitPrice: exitPx,
        realizedPnl,
        comment: opts.strategyReason ? `CLI: ${opts.strategyReason}` : "CLI manual close",
      });
    }
  });

program
  .command("sentiment")
  .description("Fetch social sentiment data from LunarCrush for traded coins")
  .option("-c, --coin <symbol>", "Single coin detail")
  .option("-w, --watch <min>", "Continuous mode: refresh every N minutes")
  .option("--notify", "Send signals to ntfy (watch mode only)")
  .option("--coins <list>", "Coins to scan (comma-separated)", "BTC,ETH,SOL,SUI,DOGE,MOODENG,TAO,HYPE,WIF,POPCAT")
  .action(async (cmdOpts: { coin?: string; watch?: string; notify?: boolean; coins?: string }) => {
    const coins = cmdOpts.coin
      ? [cmdOpts.coin.toUpperCase()]
      : (cmdOpts.coins ?? "BTC,ETH,SOL,SUI,DOGE").split(",").map((c: string) => c.trim().toUpperCase());

    if (cmdOpts.watch) {
      // Watch mode: continuous refresh with signal detection
      const intervalMin = parseFloat(cmdOpts.watch);
      if (intervalMin < 1 || !Number.isFinite(intervalMin)) {
        console.error("Watch interval must be >= 1 minute");
        process.exit(1);
      }
      console.log(`Watching sentiment for ${coins.join(", ")} every ${intervalMin}min`);
      if (cmdOpts.notify) console.log("Notifications enabled — signals will be pushed to ntfy");
      console.log();

      let prev: SentimentSnapshot[] = [];
      while (true) {
        try {
          const current = await fetchSentiment(coins);
          const signals = detectSentimentSignals(current, prev);

          // Print table
          console.log(`\n${new Date().toISOString().slice(11, 19)} ─ Sentiment Update`);
          console.log(snapshotTableHeader());
          console.log("─".repeat(58));
          for (const s of current.sort((a, b) => b.galaxyScore - a.galaxyScore)) {
            const sig = signals.find((sg) => sg.coin === s.coin);
            const sigLabel = sig ? `  << ${sig.type.toUpperCase()}: ${sig.reason}` : "";
            console.log(formatSnapshotRow(s) + sigLabel);
          }

          // Print signals
          if (signals.length > 0) {
            console.log(`\n  Signals:`);
            for (const sig of signals) {
              const icon = sig.type === "bullish" ? "🟢" : sig.type === "bearish" ? "🔴" : "⚡";
              console.log(`  ${icon} ${sig.coin} [${sig.strength}] ${sig.reason}`);
            }

            // Push to ntfy if enabled
            if (cmdOpts.notify) {
              const ntfyToken = process.env.NTFY_TOKEN;
              const signalLines = signals
                .map((s) => `- **${s.coin}** [${s.strength} ${s.type}]: ${s.reason}`)
                .join("\n");
              try {
                const headers: Record<string, string> = {
                  Markdown: "yes",
                  Title: `Sentiment Alert — ${signals.length} signal${signals.length !== 1 ? "s" : ""}`,
                  Tags: "crystal_ball,loudspeaker",
                };
                if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
                const ntfyChannel = process.env.NTFY_CHANNEL;
                if (!ntfyChannel) { console.log("  NTFY_CHANNEL not set, skipping notification"); return; }
                await fetch(`https://ntfy.sh/${ntfyChannel}`, {
                  method: "POST",
                  headers,
                  body: `**Sentiment signals detected:**\n\n${signalLines}`,
                });
              } catch (e) {
                console.error(`  ntfy send failed: ${e}`);
              }
            }
          }

          prev = current;
        } catch (e) {
          console.error(`Fetch failed: ${e}`);
        }

        await new Promise((r) => setTimeout(r, intervalMin * 60_000));
      }
    } else {
      // One-shot mode
      try {
        const snapshots = await fetchSentiment(coins);
        if (snapshots.length === 0) {
          console.log("No sentiment data found for requested coins.");
          return;
        }

        if (cmdOpts.coin) {
          // Single coin detail
          const s = snapshots[0];
          console.log(`Sentiment for ${s.coin}:`);
          console.log(`  Galaxy Score:     ${s.galaxyScore}`);
          console.log(`  Sentiment:        ${s.sentiment}%`);
          console.log(`  Social Volume:    ${s.socialVolume.toLocaleString()}`);
          console.log(`  Interactions 24h: ${s.interactions24h.toLocaleString()}`);
          console.log(`  Social Dominance: ${s.socialDominance.toFixed(4)}%`);
          console.log(`  Alt Rank:         #${s.altRank}`);
        } else {
          // Table view
          console.log(snapshotTableHeader());
          console.log("─".repeat(58));
          for (const s of snapshots.sort((a, b) => b.galaxyScore - a.galaxyScore)) {
            console.log(formatSnapshotRow(s));
          }
        }
      } catch (e) {
        console.error(`Error: ${e}`);
        process.exit(1);
      }
    }
  });

program.parse();
