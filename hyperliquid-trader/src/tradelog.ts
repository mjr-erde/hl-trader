/**
 * Log trades to trader backend (optional, default on).
 *
 * Writes to unified `trades` table (via /api/trades) AND legacy `hl_trades`
 * (via /api/hl/trades) for backward compat during transition.
 *
 * Username / session ID format: model + datetime e.g. erde-20260218-1930
 */

const API_URL = process.env.TRADER_API_URL || "http://localhost:3000";

export function defaultUsername(): string {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  const t = now.toTimeString().slice(0, 5).replace(":", "");
  return `erde-${d}-${t}`;
}

/**
 * Register a new session in the sessions table.
 * Returns the sessionId (same as the agentName passed in).
 */
export async function registerSession(opts: {
  sessionId: string;
  marketplace?: string;
  mode?: "live" | "simulated";
  env?: string;
  profileJson?: string;
}): Promise<void> {
  try {
    await fetch(`${API_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: opts.sessionId,
        marketplace: opts.marketplace ?? "hyperliquid",
        mode: opts.mode ?? "live",
        env: opts.env ?? process.env.TRADER_ENV ?? "production",
        profileJson: opts.profileJson,
      }),
    });
  } catch {
    /* backend unavailable — non-fatal */
  }
}

/**
 * Mark session as ended with final stats.
 */
export async function closeSession(opts: {
  sessionId: string;
  statsJson?: string;
}): Promise<void> {
  try {
    await fetch(`${API_URL}/api/sessions/${opts.sessionId}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statsJson: opts.statsJson }),
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * Log a trade open.
 * Returns the trade ID (use for closing via tradeId, not coin+side).
 */
export async function logTradeOpen(opts: {
  username: string;
  sessionId?: string;
  marketplace?: string;
  mode?: "live" | "simulated";
  coin: string;
  side: "long" | "short";
  entryPrice: number;
  size: number;
  leverage?: number;
  strategyReason?: string;
  orderId?: string;
  tid?: string;
  hash?: string;
  fee?: number;
  comment?: string;
  indicatorsJson?: string;
}): Promise<string | null> {
  const sessionId = opts.sessionId ?? opts.username;
  const marketplace = opts.marketplace ?? "hyperliquid";
  const mode = opts.mode ?? "live";

  // Write to unified trades table
  let tradeId: string | null = null;
  try {
    const res = await fetch(`${API_URL}/api/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        marketplace,
        mode,
        coin: opts.coin,
        side: opts.side,
        entryPrice: opts.entryPrice,
        size: opts.size,
        leverage: opts.leverage,
        strategyReason: opts.strategyReason,
        orderId: opts.orderId,
        txHash: opts.hash,
        fee: opts.fee,
        comment: opts.comment,
        indicatorsJson: opts.indicatorsJson,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      tradeId = data.id ?? null;
    } else {
      const text = await res.text();
      console.warn(`[trade-log] Failed to log open (unified): ${res.status} ${text}`);
    }
  } catch (e) {
    console.warn("[trade-log] Error (unified):", (e as Error).message);
  }

  // Also write to legacy hl_trades (backward compat)
  try {
    const res = await fetch(`${API_URL}/api/hl/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: opts.username,
        coin: opts.coin,
        side: opts.side,
        entryPrice: opts.entryPrice,
        size: opts.size,
        leverage: opts.leverage,
        strategyReason: opts.strategyReason,
        orderId: opts.orderId,
        tid: opts.tid,
        hash: opts.hash,
        fee: opts.fee,
        comment: opts.comment,
        indicatorsJson: opts.indicatorsJson,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[trade-log] Failed to log open (legacy): ${res.status} ${text}`);
    }
  } catch (e) {
    console.warn("[trade-log] Error (legacy):", (e as Error).message);
  }

  return tradeId;
}

/**
 * Log a trade close.
 * Prefer tradeId (from logTradeOpen return value) over coin+side matching.
 */
export async function logTradeClose(opts: {
  username: string;
  tradeId?: string | null;
  coin: string;
  side: "long" | "short";
  exitPrice: number;
  realizedPnl?: number;
  fee?: number;
  comment?: string;
}): Promise<void> {
  // Close unified trade by ID if available
  if (opts.tradeId) {
    try {
      const res = await fetch(`${API_URL}/api/trades/${opts.tradeId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exitPrice: opts.exitPrice,
          realizedPnl: opts.realizedPnl,
          fee: opts.fee,
          comment: opts.comment,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[trade-log] Failed to close unified trade ${opts.tradeId}: ${res.status} ${text}`);
      }
    } catch (e) {
      console.warn("[trade-log] Error closing unified trade:", (e as Error).message);
    }
  }

  // Close legacy hl_trade by coin+side
  try {
    const res = await fetch(`${API_URL}/api/hl/trades/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: opts.username,
        coin: opts.coin,
        side: opts.side,
        exitPrice: opts.exitPrice,
        realizedPnl: opts.realizedPnl,
        fee: opts.fee,
        comment: opts.comment,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[trade-log] Failed to log close (legacy): ${res.status} ${text}`);
    }
  } catch (e) {
    console.warn("[trade-log] Error:", (e as Error).message);
  }
}
