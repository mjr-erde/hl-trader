/**
 * Unified trades API — writes to the new `trades` table.
 * Replaces /api/hl/trades for new agent sessions.
 * Legacy /api/hl/trades routes continue to serve the old hl_trades table.
 */

import { Router } from "express";
import { getDb } from "../db.ts";

const router = Router();

/** POST /api/trades — log a trade open */
router.post("/", (req, res) => {
  const body = req.body ?? {};
  const {
    sessionId,
    marketplace = "hyperliquid",
    mode = "live",
    coin,
    side,
    entryPrice,
    size,
    leverage,
    strategyReason,
    orderId,
    txHash,
    fee,
    comment,
    indicatorsJson,
  } = body;

  if (!sessionId || !coin || !side || entryPrice == null || size == null) {
    res.status(400).json({
      error: "sessionId, coin, side, entryPrice, size are required",
    });
    return;
  }
  if (side !== "long" && side !== "short") {
    res.status(400).json({ error: "side must be long or short" });
    return;
  }
  if (mode !== "live" && mode !== "simulated") {
    res.status(400).json({ error: "mode must be live or simulated" });
    return;
  }

  const id = `erde-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const openedAt = Date.now();

  try {
    const db = getDb();

    // Ensure session exists (auto-create if agent didn't register it)
    const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
    if (!existing) {
      db.prepare(
        `INSERT INTO sessions (id, marketplace, mode, env, started_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        String(sessionId),
        String(marketplace),
        String(mode),
        process.env.TRADER_ENV ?? "production",
        openedAt,
        openedAt
      );
    }

    db.prepare(
      `INSERT INTO trades
         (id, session_id, marketplace, mode, coin, side, entry_price, size, leverage,
          strategy_reason, opened_at, fee, comment, indicators_json, order_id, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(sessionId),
      String(marketplace),
      String(mode),
      String(coin),
      side,
      Number(entryPrice),
      Number(size),
      leverage != null ? Number(leverage) : null,
      strategyReason ? String(strategyReason) : null,
      openedAt,
      fee != null ? Number(fee) : null,
      comment ? String(comment) : null,
      indicatorsJson ? String(indicatorsJson) : null,
      orderId ? String(orderId) : null,
      txHash ? String(txHash) : null,
      openedAt
    );

    const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/trades/:id/close — close a trade by ID */
router.post("/:id/close", (req, res) => {
  const { id } = req.params;
  const { exitPrice, realizedPnl, fee, comment } = req.body ?? {};

  if (!id || exitPrice == null) {
    res.status(400).json({ error: "id and exitPrice are required" });
    return;
  }

  try {
    const db = getDb();
    const trade = db.prepare("SELECT id FROM trades WHERE id = ?").get(id);
    if (!trade) {
      res.status(404).json({ error: "Trade not found" });
      return;
    }
    const closedAt = Date.now();
    db.prepare(
      `UPDATE trades SET closed_at = ?, exit_price = ?, realized_pnl = ?,
       fee = COALESCE(?, fee), comment = COALESCE(?, comment) WHERE id = ?`
    ).run(
      closedAt,
      Number(exitPrice),
      realizedPnl != null ? Number(realizedPnl) : null,
      fee != null ? Number(fee) : null,
      comment ? String(comment) : null,
      id
    );
    const updated = db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/trades?sessionId=&mode=&marketplace= */
router.get("/", (req, res) => {
  const { sessionId, mode, marketplace } = req.query as Record<string, string | undefined>;

  try {
    const db = getDb();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (sessionId) {
      conditions.push("session_id = ?");
      values.push(sessionId);
    }
    if (mode) {
      conditions.push("mode = ?");
      values.push(mode);
    }
    if (marketplace) {
      conditions.push("marketplace = ?");
      values.push(marketplace);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM trades ${where} ORDER BY opened_at DESC LIMIT 500`)
      .all(...values);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
