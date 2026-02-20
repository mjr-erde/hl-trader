/**
 * Hyperliquid REST API client.
 * Base URL: https://api.hyperliquid.xyz
 * See knowledge/crypto-trading-strategies.md Appendix C.
 */

/** URL to Hyperliquid perp trading page for an asset (e.g. SOL, BTC). */
export function hyperliquidTradeUrl(symbol: string): string {
  return `https://app.hyperliquid.xyz/trade/${symbol}`;
}

export interface MetaAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
}

export interface MetaResponse {
  universe: MetaAsset[];
}

export interface Candle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v?: string;
}

function getApiUrl(): string {
  if (typeof window !== "undefined") {
    // Browser: use same-origin /api/info (routed through hyperliquid-trader)
    return "/api/info";
  }
  // Node (trader CLI): use server /api/info when available (routes through hyperliquid-trader)
  const apiBase = process.env.TRADER_API_URL ?? "http://localhost:3000";
  return `${apiBase.replace(/\/$/, "")}/api/info`;
}

async function post<T>(body: object): Promise<T> {
  const url = getApiUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid API error: ${res.status}`);
  return res.json();
}

const META_CACHE_MS = 10 * 60 * 1000;
const CANDLE_CACHE_MS = 3 * 60 * 1000;
const MIDS_CACHE_MS = 60 * 1000;

let metaCache: { data: MetaResponse; ts: number } | null = null;
let midsCache: { data: Record<string, string>; ts: number } | null = null;
const candleCache = new Map<string, { data: Candle[]; ts: number }>();

/** Get asset metadata (coin list, decimals, max leverage) */
export async function getMeta(): Promise<MetaResponse> {
  if (metaCache && Date.now() - metaCache.ts < META_CACHE_MS) return metaCache.data;
  const data = (await post<[MetaResponse, unknown[]]>({ type: "metaAndAssetCtxs" }))[0];
  metaCache = { data, ts: Date.now() };
  return data;
}

/** Get mid prices for all coins */
export async function getAllMids(): Promise<Record<string, string>> {
  if (midsCache && Date.now() - midsCache.ts < MIDS_CACHE_MS) return midsCache.data;
  const data = await post<Record<string, string>>({ type: "allMids" });
  midsCache = { data, ts: Date.now() };
  return data;
}

/** Get mid price for a single coin */
export async function getMid(coin: string): Promise<number> {
  const mids = await getAllMids();
  const s = mids[coin];
  if (!s) throw new Error(`Unknown coin: ${coin}`);
  return parseFloat(s);
}

/** Get OHLCV candles */
export async function getCandles(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const key = `${coin}-${interval}-${startTime}-${endTime}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.ts < CANDLE_CACHE_MS) return hit.data;
  const data = await post<Candle[]>({
    type: "candleSnapshot",
    req: { coin, interval, startTime, endTime },
  });
  candleCache.set(key, { data, ts: Date.now() });
  if (candleCache.size > 20) {
    const oldest = [...candleCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) candleCache.delete(oldest[0]);
  }
  return data;
}

/** List available coin symbols (non-delisted) */
export async function getCoins(): Promise<string[]> {
  const meta = await getMeta();
  return meta.universe
    .filter((a) => !a.isDelisted)
    .map((a) => a.name)
    .sort();
}

/** Get max leverage for a coin (from Hyperliquid meta). Default 50 if unknown. */
export async function getMaxLeverage(coin: string): Promise<number> {
  const meta = await getMeta();
  const asset = meta.universe.find((a) => a.name === coin);
  return asset?.maxLeverage ?? 50;
}
