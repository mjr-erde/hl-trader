/**
 * Hyperliquid exchange client — balance, positions, orders.
 */

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import type { PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface ExchangeConfig {
  privateKey: `0x${string}` | null;
  testnet?: boolean;
}

export function createClients(config: ExchangeConfig) {
  const transport = new HttpTransport({ isTestnet: config.testnet ?? false });
  const info = new InfoClient({ transport });
  if (config.privateKey === null) {
    // Paper trading mode — market data only, no order placement
    return { info, exchange: null as ExchangeClient | null, wallet: null as PrivateKeyAccount | null };
  }
  const wallet = privateKeyToAccount(config.privateKey) as PrivateKeyAccount;
  const exchange = new ExchangeClient({ transport, wallet });
  return { info, exchange, wallet };
}

export interface MetaAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
}

let _metaCache: { universe: MetaAsset[] } | null = null;
let _metaCacheTime = 0;
const META_CACHE_TTL = 3_600_000; // 1h — meta barely changes

export async function getMeta(info: InfoClient): Promise<{ universe: MetaAsset[] }> {
  const now = Date.now();
  if (_metaCache && now - _metaCacheTime < META_CACHE_TTL) return _metaCache;
  const [metaResponse] = await info.metaAndAssetCtxs();
  _metaCache = { universe: metaResponse.universe };
  _metaCacheTime = now;
  return _metaCache;
}

export function coinToAssetId(meta: { universe: MetaAsset[] }, coin: string): number {
  const idx = meta.universe.findIndex((a) => a.name === coin);
  if (idx < 0) throw new Error(`Unknown coin: ${coin}`);
  return idx;
}

export async function getBalance(info: InfoClient, user: `0x${string}`): Promise<{
  perp: { accountValue: string; totalMarginUsed: string; withdrawable: string };
  spot: Array<{ coin: string; total: string; hold: string }>;
}> {
  const [perpState, spotState] = await Promise.all([
    info.clearinghouseState({ user }),
    info.spotClearinghouseState({ user }),
  ]);
  const marginSummary = (perpState as { marginSummary?: { accountValue: string; totalMarginUsed: string }; withdrawable?: string })?.marginSummary;
  const withdrawable = (perpState as { withdrawable?: string })?.withdrawable ?? "0";
  const spotBalances = (spotState as { balances?: Array<{ coin: string; total: string; hold: string }> })?.balances ?? [];
  return {
    perp: {
      accountValue: marginSummary?.accountValue ?? "0",
      totalMarginUsed: marginSummary?.totalMarginUsed ?? "0",
      withdrawable,
    },
    spot: spotBalances
      .filter((b) => parseFloat(b.total) > 0 || parseFloat(b.hold) > 0)
      .map((b) => ({ coin: b.coin, total: b.total, hold: b.hold })),
  };
}

export interface Position {
  coin: string;
  side: "long" | "short";
  szi: string;
  entryPx: string;
  leverage: { value: number };
}

export async function getPositions(info: InfoClient, user: `0x${string}`): Promise<Position[]> {
  const state = (await info.clearinghouseState({ user })) as {
    assetPositions?: Array<{ type: string; position: { coin: string; szi: string; entryPx: string; leverage: { value: number } } }>;
  };
  const assetPositions = state?.assetPositions ?? [];
  const meta = await getMeta(info);
  return assetPositions
    .filter((ap) => ap.type === "oneWay" && ap.position)
    .map((ap) => {
      const pos = ap.position;
      const idx = parseInt(pos.coin, 10);
      const coinName = meta.universe[idx]?.name ?? pos.coin;
      const sziNum = parseFloat(pos.szi);
      const side: "long" | "short" = sziNum > 0 ? "long" : "short";
      return {
        coin: coinName,
        side,
        szi: pos.szi,
        entryPx: pos.entryPx,
        leverage: pos.leverage,
      };
    })
    .filter((p) => parseFloat(p.szi) !== 0);
}

export async function getMidPrice(info: InfoClient, coin: string): Promise<string> {
  const mids = await info.allMids();
  const mid = (mids as Record<string, string>)[coin];
  if (!mid) throw new Error(`No mid price for ${coin}`);
  return mid;
}

export interface TpSlConfig {
  takeProfitPct: number;  // e.g. 0.02 for +2%
  stopLossPct: number;    // e.g. -0.02 for -2% (pass as negative)
}

export async function placeMarketOrder(
  exchange: ExchangeClient,
  info: InfoClient,
  coin: string,
  side: "long" | "short",
  size: number,
  leverage: number,
  slippageBps: number = 50,
  tpsl?: TpSlConfig,
): Promise<unknown> {
  const meta = await getMeta(info);
  const assetId = coinToAssetId(meta, coin);
  const asset = meta.universe[assetId];
  const szDecimals = asset?.szDecimals ?? 4;
  const mid = await getMidPrice(info, coin);
  const midNum = parseFloat(mid);
  const mult = side === "long" ? 1 + slippageBps / 10000 : 1 - slippageBps / 10000;
  const price = formatPrice(String(midNum * mult), szDecimals, "perp");
  const sizeStr = formatSize(String(size), szDecimals);

  await exchange.updateLeverage({ asset: assetId, isCross: true, leverage });

  // Entry order
  const result = await exchange.order({
    orders: [
      {
        a: assetId,
        b: side === "long",
        p: price,
        s: sizeStr,
        r: false,
        t: { limit: { tif: "FrontendMarket" as const } },
      },
    ],
    grouping: "na",
  });

  // Place TP/SL trigger orders if configured
  if (tpsl) {
    const tpPrice = side === "long"
      ? midNum * (1 + tpsl.takeProfitPct)
      : midNum * (1 - tpsl.takeProfitPct);
    const slPrice = side === "long"
      ? midNum * (1 + tpsl.stopLossPct)  // stopLossPct is negative
      : midNum * (1 - tpsl.stopLossPct); // for short, flip: price goes up = loss

    const closeSide = side !== "long"; // opposite side to close
    const tpPriceStr = formatPrice(String(tpPrice), szDecimals, "perp");
    const slPriceStr = formatPrice(String(slPrice), szDecimals, "perp");
    const tpSlOrders = [
      {
        a: assetId,
        b: closeSide,
        p: tpPriceStr, // must be > 0 for Valibot validation
        s: sizeStr,
        r: true, // reduce-only
        t: { trigger: { isMarket: true, triggerPx: tpPriceStr, tpsl: "tp" as const } },
      },
      {
        a: assetId,
        b: closeSide,
        p: slPriceStr, // must be > 0 for Valibot validation
        s: sizeStr,
        r: true, // reduce-only
        t: { trigger: { isMarket: true, triggerPx: slPriceStr, tpsl: "sl" as const } },
      },
    ];

    // Place TP and SL as separate orders (trigger orders can't be in normalTpsl grouping without a main order)
    for (const tpslOrder of tpSlOrders) {
      try {
        await exchange.order({ orders: [tpslOrder], grouping: "na" });
      } catch (err) {
        console.error(`[WARN] TP/SL order failed for ${coin}: ${err}`);
      }
    }
  }

  return result;
}

export async function cancelOpenOrders(
  exchange: ExchangeClient,
  info: InfoClient,
  user: `0x${string}`,
  coin: string,
): Promise<void> {
  const meta = await getMeta(info);
  const assetId = coinToAssetId(meta, coin);
  const state = (await info.clearinghouseState({ user })) as {
    openOrders?: Array<{ coin: string; oid: number }>;
  };
  const orders = (state?.openOrders ?? []).filter(
    (o) => {
      // openOrders uses numeric asset index as "coin" field
      const idx = parseInt(String(o.coin), 10);
      return idx === assetId || o.coin === coin;
    }
  );
  if (orders.length === 0) return;
  try {
    await exchange.cancel({
      cancels: orders.map((o) => ({ a: assetId, o: o.oid })),
    });
  } catch (err) {
    console.error(`[WARN] Cancel orders failed for ${coin}: ${err}`);
  }
}

export async function closePosition(
  exchange: ExchangeClient,
  info: InfoClient,
  user: `0x${string}`,
  coin: string,
  reduceOnly: boolean = true
): Promise<unknown> {
  const meta = await getMeta(info);
  const assetId = coinToAssetId(meta, coin);
  const asset = meta.universe[assetId];
  const szDecimals = asset?.szDecimals ?? 4;
  const positions = await getPositions(info, user);
  const pos = positions.find((p) => p.coin === coin);
  if (!pos) throw new Error(`No open position for ${coin}`);
  const size = Math.abs(parseFloat(pos.szi));
  const mid = await getMidPrice(info, coin);
  const price = parseFloat(mid);
  const slippageBps = 50;
  const pxRaw = pos.side === "long" ? price * (1 - slippageBps / 10000) : price * (1 + slippageBps / 10000);
  const px = formatPrice(String(pxRaw), szDecimals, "perp");
  const sizeStr = formatSize(String(size), szDecimals);

  return exchange.order({
    orders: [
      {
        a: assetId,
        b: pos.side === "short",
        p: px,
        s: sizeStr,
        r: true,
        t: { limit: { tif: "FrontendMarket" } },
      },
    ],
    grouping: "na",
  });
}
