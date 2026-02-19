/**
 * Hyperliquid real-money API — positions from chain via hyperliquid-trader, trade logging from CLI.
 */

import { Router } from "express";
import { getDb } from "../db.ts";
import { redactSecrets } from "../secrets.ts";
import {
  getPositionsForAccount,
  getClosedPositionsForAccount,
  getAccountAddressForReadOnly,
} from "../../hyperliquid-trader/src/info.js";

const router = Router();

/** GET /api/hl/positions — real positions from Hyperliquid via read-only info client */
router.get("/positions", async (req, res) => {
  const account = getAccountAddressForReadOnly();
  if (!account) {
    res.status(503).json({
      error:
        "Set HYPERLIQUID_ACCOUNT_ADDRESS or HYPERLIQUID_PRIVATE_KEY in hyperliquid-trader/.env (read-only: address derived from key for single-wallet)",
    });
    return;
  }
  try {
    const rawPositions = await getPositionsForAccount(account);
    const positions = rawPositions.map((p) => ({
      coin: p.coin,
      side: p.side,
      szi: p.szi,
      size: Math.abs(parseFloat(p.szi)),
      entryPx: p.entryPx,
      entryPrice: parseFloat(p.entryPx),
      leverage: p.leverage?.value ?? 1,
    }));
    // Return masked account for display only — full address never leaves server
    const accountMasked = account.length >= 10 ? `0x${account.slice(2, 6)}...${account.slice(-4)}` : "—";
    res.json({ account: accountMasked, positions });
  } catch (e) {
    res.status(502).json({ error: redactSecrets((e as Error).message) });
  }
});

/** GET /api/hl/closed-positions — closed positions from wallet fill history (last 90 days) */
router.get("/closed-positions", async (req, res) => {
  const account = getAccountAddressForReadOnly();
  if (!account) {
    res.status(503).json({
      error:
        "Set HYPERLIQUID_ACCOUNT_ADDRESS or HYPERLIQUID_PRIVATE_KEY in hyperliquid-trader/.env",
    });
    return;
  }
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 90));
    const closed = await getClosedPositionsForAccount(account, false, days);
    res.json(closed);
  } catch (e) {
    res.status(502).json({ error: redactSecrets((e as Error).message) });
  }
});

/** POST /api/hl/trades — log a trade from CLI */
router.post("/trades", (req, res) => {
  const body = req.body ?? {};
  const {
    username,
    coin,
    side,
    entryPrice,
    size,
    leverage,
    strategyReason,
    orderId,
    tid,
    hash,
    fee,
    comment,
    indicatorsJson,
  } = body;

  if (!username || !coin || !side || entryPrice == null || size == null) {
    res.status(400).json({
      error: "username, coin, side, entryPrice, size are required",
    });
    return;
  }
  if (side !== "long" && side !== "short") {
    res.status(400).json({ error: "side must be long or short" });
    return;
  }

  const id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const openedAt = Date.now();

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO hl_trades (id, username, coin, side, entry_price, size, leverage, strategy_reason, opened_at, order_id, tid, hash, fee, comment, indicators_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(username),
      String(coin),
      side,
      Number(entryPrice),
      Number(size),
      leverage != null ? Number(leverage) : null,
      strategyReason ? String(strategyReason) : null,
      openedAt,
      orderId ? String(orderId) : null,
      tid ? String(tid) : null,
      hash ? String(hash) : null,
      fee != null ? Number(fee) : null,
      comment ? String(comment) : null,
      indicatorsJson ? String(indicatorsJson) : null
    );
    const row = db.prepare("SELECT * FROM hl_trades WHERE id = ?").get(id) as Record<string, unknown>;
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/hl/trades/close — close the most recent open trade for coin+side (username optional for matching) */
router.post("/trades/close", (req, res) => {
  const { username, coin, side, exitPrice, realizedPnl, fee, comment } = req.body ?? {};
  if (!coin || !side || exitPrice == null) {
    res.status(400).json({ error: "coin, side, exitPrice are required" });
    return;
  }
  try {
    const db = getDb();
    // Match by coin+side first; if username provided, try exact match, then fall back to any username
    let row: { id: string } | undefined;
    if (username) {
      row = db
        .prepare(
          `SELECT id FROM hl_trades WHERE username = ? AND coin = ? AND side = ? AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`
        )
        .get(username, coin, side) as { id: string } | undefined;
    }
    if (!row) {
      row = db
        .prepare(
          `SELECT id FROM hl_trades WHERE coin = ? AND side = ? AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`
        )
        .get(coin, side) as { id: string } | undefined;
    }
    if (!row) {
      res.status(404).json({ error: "No open trade found to close" });
      return;
    }
    const closedAt = Date.now();
    db.prepare(
      `UPDATE hl_trades SET closed_at = ?, exit_price = ?, realized_pnl = ?, fee = COALESCE(?, fee), comment = COALESCE(?, comment) WHERE id = ?`
    ).run(closedAt, Number(exitPrice), realizedPnl != null ? Number(realizedPnl) : null, fee != null ? Number(fee) : null, comment ? String(comment) : null, row.id);
    const updated = db.prepare("SELECT * FROM hl_trades WHERE id = ?").get(row.id) as Record<string, unknown>;
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** PATCH /api/hl/trades/:id — update trade (e.g. close, strategy) */
router.patch("/trades/:id", (req, res) => {
  const { id } = req.params;
  const { closedAt, exitPrice, realizedPnl, fee, comment, strategyReason } = req.body ?? {};
  if (!id) {
    res.status(400).json({ error: "id required" });
    return;
  }
  try {
    const db = getDb();
    const updates: string[] = [];
    const values: unknown[] = [];
    if (closedAt != null) {
      updates.push("closed_at = ?");
      values.push(Number(closedAt));
    }
    if (exitPrice != null) {
      updates.push("exit_price = ?");
      values.push(Number(exitPrice));
    }
    if (realizedPnl != null) {
      updates.push("realized_pnl = ?");
      values.push(Number(realizedPnl));
    }
    if (fee != null) {
      updates.push("fee = ?");
      values.push(Number(fee));
    }
    if (comment != null) {
      updates.push("comment = ?");
      values.push(String(comment));
    }
    if (strategyReason != null) {
      updates.push("strategy_reason = ?");
      values.push(String(strategyReason));
    }
    if (updates.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    values.push(id);
    db.prepare(`UPDATE hl_trades SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM hl_trades WHERE id = ?").get(id) as Record<string, unknown>;
    if (!row) {
      res.status(404).json({ error: "Trade not found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/hl/trades?username= — list trades by username */
router.get("/trades", (req, res) => {
  const username = req.query.username as string | undefined;
  if (!username) {
    res.status(400).json({ error: "username query param is required" });
    return;
  }
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, coin, side, entry_price, size, leverage, strategy_reason,
                opened_at, closed_at, exit_price, realized_pnl, fee, order_id, tid, hash, source, comment, created_at
         FROM hl_trades WHERE username = ? ORDER BY opened_at DESC`
      )
      .all(username);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/hl/trades/usernames — list distinct usernames */
router.get("/trades/usernames", (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT DISTINCT username FROM hl_trades ORDER BY username DESC")
      .all() as { username: string }[];
    res.json(rows.map((r) => r.username));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/hl/trades/open — all open trades with strategy (for enriching open positions table) */
router.get("/trades/open", (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, coin, side, strategy_reason, entry_price, size, opened_at
         FROM hl_trades WHERE closed_at IS NULL ORDER BY opened_at DESC`
      )
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/hl/trades/closed — all closed trades with strategy (for enriching wallet closed positions) */
router.get("/trades/closed", (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 90));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, coin, side, strategy_reason, opened_at, closed_at, exit_price, realized_pnl
         FROM hl_trades WHERE closed_at IS NOT NULL AND closed_at >= ? ORDER BY closed_at DESC`
      )
      .all(since);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
