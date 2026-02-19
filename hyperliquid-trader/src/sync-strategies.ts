/**
 * Sync strategy_reason from agent log files into hl_trades.
 * Matches [ENTRY] and [ADOPT] log lines to trades by coin, side, and approximate time.
 *
 * Usage: npx tsx hyperliquid-trader/src/sync-strategies.ts [options]
 *   Or: hyperliquid-trader sync-strategies [options]
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.TRADER_API_URL || "http://localhost:3000";

interface LogEntry {
  ts: number;
  coin: string;
  side: "long" | "short";
  strategy: string;
  type: "entry" | "adopt";
}

/** Parse [ENTRY] COIN side — RULE (confidence: X) */
function parseEntryLine(line: string): LogEntry | null {
  const m = line.match(
    /\[ENTRY\]\s+(\S+)\s+(long|short)\s+—\s+(.+?)\s+\(confidence:/
  );
  if (!m) return null;
  const [, coin, side, rule] = m;
  return {
    ts: parseTimestamp(line),
    coin,
    side: side as "long" | "short",
    strategy: rule.trim(),
    type: "entry",
  };
}

/** Parse [ADOPT] COIN side size=... — infer strategy from side (position opened before agent started) */
function parseAdoptLine(line: string): LogEntry | null {
  const m = line.match(/\[ADOPT\]\s+(\S+)\s+(long|short)\s+/);
  if (!m) return null;
  const [, coin, side] = m;
  const strategy = side === "long" ? "R3-trend [trend]" : "R4-trend [trend]";
  return {
    ts: parseTimestamp(line),
    coin,
    side: side as "long" | "short",
    strategy,
    type: "adopt",
  };
}

function parseTimestamp(line: string): number {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (!m) return 0;
  return new Date(m[1]).getTime();
}

function extractLogEntries(
  content: string,
  username: string
): Map<string, LogEntry[]> {
  const byKey = new Map<string, LogEntry[]>();
  const lines = content.split("\n");

  for (const line of lines) {
    const entry = parseEntryLine(line) ?? parseAdoptLine(line);
    if (!entry || entry.ts === 0) continue;

    const key = `${entry.coin}:${entry.side}`;
    const list = byKey.get(key) ?? [];
    list.push(entry);
    byKey.set(key, list);
  }

  return byKey;
}

function findBestMatch(
  entries: LogEntry[],
  openedAt: number,
  windowMinutes: number
): LogEntry | null {
  let best: LogEntry | null = null;
  let bestDiff = Infinity;
  const windowMs = windowMinutes * 60 * 1000;

  for (const e of entries) {
    if (e.type === "entry") {
      // ENTRY: trade opened at ~same time as log
      const diff = Math.abs(e.ts - openedAt);
      if (diff <= windowMs && diff < bestDiff) {
        bestDiff = diff;
        best = e;
      }
    } else {
      // ADOPT: trade was opened before agent started; adopt_ts is when agent saw it
      const diff = e.ts - openedAt;
      if (diff >= 0 && diff < 24 * 60 * 60 * 1000 && diff < bestDiff) {
        bestDiff = diff;
        best = e;
      }
    }
  }
  return best;
}

async function fetchTrades(username: string): Promise<HlTrade[]> {
  const res = await fetch(
    `${API_URL}/api/hl/trades?username=${encodeURIComponent(username)}`
  );
  if (!res.ok) throw new Error(`Trades fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchTrade(id: string, strategyReason: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/hl/trades/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategyReason }),
  });
  if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
}

interface HlTrade {
  id: string;
  username: string;
  coin: string;
  side: "long" | "short";
  strategy_reason: string | null;
  opened_at: number;
}

export async function runSyncStrategies(opts: {
  logsDir: string;
  username?: string;
  dryRun?: boolean;
  windowMinutes?: number;
}): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const logsPath = resolve(opts.logsDir);
  const windowMs = (opts.windowMinutes ?? 15) * 60 * 1000;
  const errors: string[] = [];
  let updated = 0;
  let skipped = 0;

  const files = readdirSync(logsPath).filter((f) => f.endsWith(".log"));
  if (files.length === 0) {
    console.log(`No .log files in ${logsPath}`);
    return { updated, skipped, errors };
  }

  // Build username -> log entries map
  const userEntries = new Map<string, Map<string, LogEntry[]>>();
  for (const file of files) {
    const username = file.replace(/\.log$/, "");
    if (opts.username && username !== opts.username) continue;

    try {
      const content = readFileSync(resolve(logsPath, file), "utf-8");
      const entries = extractLogEntries(content, username);
      if (entries.size > 0) {
        userEntries.set(username, entries);
      }
    } catch (e) {
      errors.push(`Read ${file}: ${(e as Error).message}`);
    }
  }

  // Fetch usernames from API if not filtering
  let usernames = [...userEntries.keys()];
  if (usernames.length === 0) {
    console.log("No log entries found for matching usernames.");
    return { updated, skipped, errors };
  }

  if (opts.username && !userEntries.has(opts.username)) {
    // Maybe username in DB differs from log filename; try fetching usernames from API
    try {
      const res = await fetch(`${API_URL}/api/hl/trades/usernames`);
      if (res.ok) {
        const apiUsers = (await res.json()) as string[];
        const match = apiUsers.find((u) => u.includes(opts.username!) || opts.username!.includes(u));
        if (match) usernames = [match];
      }
    } catch {
      // ignore
    }
  }

  for (const username of usernames) {
    const entries = userEntries.get(username);
    if (!entries) continue;

    let trades: HlTrade[];
    try {
      trades = await fetchTrades(username);
    } catch (e) {
      errors.push(`Fetch ${username}: ${(e as Error).message}`);
      continue;
    }

    for (const t of trades) {
      if (t.strategy_reason?.trim()) {
        skipped++;
        continue;
      }

      const key = `${t.coin}:${t.side}`;
      const list = entries.get(key);
      if (!list || list.length === 0) continue;

      const match = findBestMatch(list, t.opened_at, opts.windowMinutes ?? 15);
      if (!match) continue;

      if (opts.dryRun) {
        console.log(`[dry-run] Would update ${t.id} (${t.coin} ${t.side}) → "${match.strategy}"`);
        updated++;
        continue;
      }

      try {
        await patchTrade(t.id, match.strategy);
        console.log(`Updated ${t.id} (${t.coin} ${t.side}) → "${match.strategy}"`);
        updated++;
      } catch (e) {
        errors.push(`PATCH ${t.id}: ${(e as Error).message}`);
      }
    }
  }

  return { updated, skipped, errors };
}
