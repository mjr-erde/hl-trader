/**
 * Server-side cache for Hyperliquid API responses.
 * Reduces API calls to stay well under rate limits.
 */

const META_TTL_MS = 10 * 60 * 1000;       // 10 min — rarely changes
const MIDS_TTL_MS = 60 * 1000;            // 60s — prices change often but 1min is acceptable
const POSITIONS_TTL_MS = 30 * 1000;       // 30s — balance/positions
const CLOSED_POSITIONS_TTL_MS = 5 * 60 * 1000;  // 5 min — historical, immutable
const CANDLE_TTL_MS = 2 * 60 * 1000;      // 2 min per (coin, interval, range)

interface CacheEntry<T> {
  data: T;
  ts: number;
}

let metaCache: CacheEntry<[unknown, unknown[]]> | null = null;
let midsCache: CacheEntry<Record<string, string>> | null = null;
const positionsCache = new Map<string, CacheEntry<unknown[]>>();
const closedPositionsCache = new Map<string, CacheEntry<unknown[]>>();
const candleCache = new Map<string, CacheEntry<unknown[]>>();
const MAX_CANDLE_ENTRIES = 30;

function cacheKey(...parts: (string | number)[]): string {
  return parts.join(":");
}

export async function cachedMetaAndAssetCtxs(
  fetch: () => Promise<[unknown, unknown[]]>
): Promise<[unknown, unknown[]]> {
  if (metaCache && Date.now() - metaCache.ts < META_TTL_MS) return metaCache.data;
  const data = await fetch();
  metaCache = { data, ts: Date.now() };
  return data;
}

export async function cachedAllMids(
  fetch: () => Promise<Record<string, string>>
): Promise<Record<string, string>> {
  if (midsCache && Date.now() - midsCache.ts < MIDS_TTL_MS) return midsCache.data;
  const data = await fetch();
  midsCache = { data, ts: Date.now() };
  return data;
}

export async function cachedPositions(
  account: string,
  fetch: () => Promise<unknown[]>
): Promise<unknown[]> {
  const key = account.toLowerCase();
  const hit = positionsCache.get(key);
  if (hit && Date.now() - hit.ts < POSITIONS_TTL_MS) return hit.data;
  const data = await fetch();
  positionsCache.set(key, { data, ts: Date.now() });
  return data;
}

export async function cachedClosedPositions(
  account: string,
  daysBack: number,
  fetch: () => Promise<unknown[]>
): Promise<unknown[]> {
  const key = cacheKey(account.toLowerCase(), daysBack);
  const hit = closedPositionsCache.get(key);
  if (hit && Date.now() - hit.ts < CLOSED_POSITIONS_TTL_MS) return hit.data;
  const data = await fetch();
  closedPositionsCache.set(key, { data, ts: Date.now() });
  return data;
}

export async function cachedCandleSnapshot(
  req: { coin: string; interval: string; startTime: number; endTime: number },
  fetch: () => Promise<unknown[]>
): Promise<unknown[]> {
  const key = cacheKey(req.coin, req.interval, req.startTime, req.endTime);
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.ts < CANDLE_TTL_MS) return hit.data;
  const data = await fetch();
  candleCache.set(key, { data, ts: Date.now() });
  if (candleCache.size > MAX_CANDLE_ENTRIES) {
    const oldest = [...candleCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) candleCache.delete(oldest[0]);
  }
  return data;
}
