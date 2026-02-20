/**
 * Read-only Hyperliquid info client — no private key required.
 * Single entry point for all Hyperliquid API access. Used by server and CLI.
 * Server-side caching reduces API calls (see hl-cache.ts).
 */

import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { getMeta, getPositions, type Position } from "./exchange.js";
import {
  cachedMetaAndAssetCtxs,
  cachedAllMids,
  cachedPositions,
  cachedClosedPositions,
  cachedCandleSnapshot,
} from "./hl-cache.js";

const ACCOUNT_ENV = "HYPERLIQUID_ACCOUNT_ADDRESS";
const KEY_ENV = "HYPERLIQUID_PRIVATE_KEY";

/** Retry on 429 rate limit. Hyperliquid allows 1 req/10s when rate limited. */
async function withRetry429<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      const is429 = msg.includes("429") || msg.includes("Too Many Requests");
      if (!is429 || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 12000)); // 12s backoff
    }
  }
  throw new Error("unreachable");
}

/**
 * Resolve account address for read-only mode (Live page, positions).
 * Only uses HYPERLIQUID_ACCOUNT_ADDRESS — does NOT derive from the private key.
 * The private key belongs to an agent wallet (different from the main account on Hyperliquid unified accounts).
 * Returns null if not explicitly configured.
 */
export function getAccountAddressForReadOnly(): `0x${string}` | null {
  const addr = process.env[ACCOUNT_ENV]?.trim();
  if (addr && addr.startsWith("0x") && addr.length >= 42) {
    return addr as `0x${string}`;
  }
  return null;
}

export function createInfoClient(testnet = false): InfoClient {
  const transport = new HttpTransport({ isTestnet: testnet });
  return new InfoClient({ transport });
}

/** Fetch positions for an account address. No private key needed. Cached 30s. */
export async function getPositionsForAccount(
  account: `0x${string}`,
  testnet = false
): Promise<Position[]> {
  return cachedPositions(account, () =>
    withRetry429(async () => {
      const info = createInfoClient(testnet);
      return getPositions(info, account);
    })
  ) as Promise<Position[]>;
}

/** Get all mid prices. Public data, no auth. Cached 60s. */
export async function getAllMids(testnet = false): Promise<Record<string, string>> {
  return cachedAllMids(() =>
    withRetry429(async () => {
      const info = createInfoClient(testnet);
      return info.allMids() as Promise<Record<string, string>>;
    })
  );
}

/** Candle snapshot. Public data, no auth. Cached 2min per (coin, interval, range). */
export async function getCandleSnapshot(
  req: { coin: string; interval: string; startTime: number; endTime: number },
  testnet = false
): Promise<unknown[]> {
  return cachedCandleSnapshot(req, () =>
    withRetry429(async () => {
      const info = createInfoClient(testnet);
      return info.candleSnapshot(req as Parameters<InfoClient["candleSnapshot"]>[0]) as Promise<unknown[]>;
    })
  ) as Promise<unknown[]>;
}

/** Meta and asset contexts. Public data, no auth. Cached 10min. */
export async function getMetaAndAssetCtxs(testnet = false): Promise<[unknown, unknown[]]> {
  return cachedMetaAndAssetCtxs(() =>
    withRetry429(async () => {
      const info = createInfoClient(testnet);
      return info.metaAndAssetCtxs() as Promise<[unknown, unknown[]]>;
    })
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ClosedPositionFromFill {
  coin: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  closedAt: number;
  hash: string;
}

/**
 * Fetch closed positions from wallet fill history.
 * Uses userFillsByTime — returns fills that have closedPnl (position closures).
 * Cached 5min per (account, daysBack).
 */
export async function getClosedPositionsForAccount(
  account: `0x${string}`,
  testnet = false,
  daysBack = 90
): Promise<ClosedPositionFromFill[]> {
  return cachedClosedPositions(account, daysBack, () =>
    fetchClosedPositions(account, testnet, daysBack)
  ) as Promise<ClosedPositionFromFill[]>;
}

async function fetchClosedPositions(
  account: `0x${string}`,
  testnet: boolean,
  daysBack: number
): Promise<ClosedPositionFromFill[]> {
  const info = createInfoClient(testnet);
  const endTime = Date.now();
  const startTime = endTime - daysBack * MS_PER_DAY;

  const closed: ClosedPositionFromFill[] = [];
  let cursor = startTime;
  const windowMs = 7 * MS_PER_DAY;

  while (cursor < endTime) {
    const windowEnd = Math.min(cursor + windowMs, endTime);
    const batch = (await withRetry429(() =>
      info.userFillsByTime({
        user: account,
        startTime: cursor,
        endTime: windowEnd,
      })
    )) as Array<Record<string, unknown>>;

    for (const f of batch) {
      const closedPnl = f.closedPnl;
      if (closedPnl == null || parseFloat(String(closedPnl)) === 0) continue;

      const side = (f.side === "A" ? "short" : "long") as "long" | "short";
      const sz = parseFloat(String(f.sz ?? 0));
      const px = parseFloat(String(f.px ?? 0));
      const pnl = parseFloat(String(closedPnl));
      const entryPrice = sz > 0 ? (side === "long" ? px - pnl / sz : px + pnl / sz) : px;

      closed.push({
        coin: String(f.coin ?? ""),
        side,
        size: sz,
        entryPrice,
        exitPrice: px,
        realizedPnl: pnl,
        closedAt: Number(f.time ?? 0),
        hash: String(f.hash ?? ""),
      });
    }

    if (batch.length < 2000) cursor = windowEnd;
    else cursor = (batch[batch.length - 1]?.time as number) + 1;
    if (batch.length === 0) cursor = windowEnd;
  }

  closed.sort((a, b) => b.closedAt - a.closedAt);
  return closed;
}
