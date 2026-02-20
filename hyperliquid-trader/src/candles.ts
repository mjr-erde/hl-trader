/**
 * Candles from Hyperliquid API — used by strategy/agent.
 * Agent uses this directly so it never depends on server/Kraken for price data.
 */

import { getCandleSnapshot } from "./info.js";

export interface Candle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v?: string;
}

/** Get OHLCV candles from Hyperliquid. Cached 2min per (coin, interval, range). */
export async function getCandles(
  coin: string,
  interval: string,
  startTime: number,
  endTime: number,
  testnet = false
): Promise<Candle[]> {
  const raw = await getCandleSnapshot(
    { coin, interval, startTime, endTime },
    testnet
  );
  return (raw as Array<{ t: number; o: string; h: string; l: string; c: string; v?: string }>).map(
    (c) => ({
      t: c.t,
      o: String(c.o ?? ""),
      h: String(c.h ?? ""),
      l: String(c.l ?? ""),
      c: String(c.c ?? ""),
      v: c.v != null ? String(c.v) : undefined,
    })
  );
}
