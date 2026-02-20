/**
 * Positions API — open and closed positions per user.
 */

import { Router } from "express";
import { getDb } from "../db.ts";

const router = Router();

function rowToPosition(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    coin: row.coin,
    side: row.side,
    entryPrice: row.entry_price,
    size: row.size,
    strategyId: row.strategy_id,
    openedAt: row.opened_at,
    leverage: row.leverage ?? undefined,
    comment: row.comment ?? undefined,
    ...(row.closed_at != null && {
      closedAt: row.closed_at,
      exitPrice: row.exit_price,
      realizedPnl: row.realized_pnl,
    }),
  };
}

function hlTradeToPosition(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    coin: row.coin,
    side: row.side,
    entryPrice: row.entry_price,
    size: row.size,
    strategyId: row.strategy_reason ?? undefined,
    openedAt: row.opened_at,
    leverage: row.leverage ?? undefined,
    comment: row.comment ?? undefined,
    ...(row.closed_at != null && {
      closedAt: row.closed_at,
      exitPrice: row.exit_price,
      realizedPnl: row.realized_pnl,
    }),
  };
}

/** GET /api/positions?userId= — open positions for user (includes agent hl_trades if applicable) */
router.get("/", (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    res.status(400).json({ error: "userId query param is required" });
    return;
  }
  try {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, user_id, coin, side, entry_price, size, strategy_id, opened_at, closed_at, exit_price, realized_pnl, leverage, comment FROM positions WHERE user_id = ? AND closed_at IS NULL ORDER BY opened_at DESC"
      )
      .all(Number(userId)) as Record<string, unknown>[];
    // Also include agent hl_trades (dry-run) for this user by matching username = user.name
    const user = db.prepare("SELECT name FROM users WHERE id = ?").get(Number(userId)) as { name: string } | undefined;
    const agentRows = user
      ? (db
          .prepare(
            "SELECT id, username, coin, side, entry_price, size, strategy_reason, opened_at, closed_at, exit_price, realized_pnl, leverage, comment FROM hl_trades WHERE username = ? AND closed_at IS NULL ORDER BY opened_at DESC"
          )
          .all(user.name) as Record<string, unknown>[])
      : [];
    res.json([...rows.map(rowToPosition), ...agentRows.map(hlTradeToPosition)]);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/positions/closed?userId= — closed positions for user (includes agent hl_trades if applicable) */
router.get("/closed", (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    res.status(400).json({ error: "userId query param is required" });
    return;
  }
  try {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, user_id, coin, side, entry_price, size, strategy_id, opened_at, closed_at, exit_price, realized_pnl, leverage, comment FROM positions WHERE user_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC"
      )
      .all(Number(userId)) as Record<string, unknown>[];
    const user = db.prepare("SELECT name FROM users WHERE id = ?").get(Number(userId)) as { name: string } | undefined;
    const agentRows = user
      ? (db
          .prepare(
            "SELECT id, username, coin, side, entry_price, size, strategy_reason, opened_at, closed_at, exit_price, realized_pnl, leverage, comment FROM hl_trades WHERE username = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC"
          )
          .all(user.name) as Record<string, unknown>[])
      : [];
    const combined = [...rows.map(rowToPosition), ...agentRows.map(hlTradeToPosition)];
    combined.sort((a, b) => ((b.closedAt as number) ?? 0) - ((a.closedAt as number) ?? 0));
    res.json(combined);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/positions — open a position */
router.post("/", (req, res) => {
  const { userId, coin, side, entryPrice, size, strategyId, leverage, comment } = req.body ?? {};
  if (!userId || !coin || !side || !entryPrice || !size || !strategyId) {
    res.status(400).json({
      error: "userId, coin, side, entryPrice, size, strategyId are required",
    });
    return;
  }
  if (side !== "long" && side !== "short") {
    res.status(400).json({ error: "side must be long or short" });
    return;
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const openedAt = Date.now();
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO positions (id, user_id, coin, side, entry_price, size, strategy_id, opened_at, leverage, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, Number(userId), coin, side, Number(entryPrice), Number(size), String(strategyId), openedAt, leverage ?? null, comment ? String(comment) : null);
    const row = db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as Record<string, unknown>;
    res.status(201).json(rowToPosition(row));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/positions/:id/close — close a position */
router.post("/:id/close", (req, res) => {
  const { id } = req.params;
  const { exitPrice, comment } = req.body ?? {};
  if (!id || exitPrice == null) {
    res.status(400).json({ error: "position id and exitPrice are required" });
    return;
  }
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM positions WHERE id = ? AND closed_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Position not found or already closed" });
      return;
    }
    const side = row.side as "long" | "short";
    const entryPrice = row.entry_price as number;
    const size = row.size as number;
    const realizedPnl = computeRealizedPnl(side, entryPrice, Number(exitPrice), size);
    const closedAt = Date.now();
    const finalComment = comment != null && String(comment).trim() ? String(comment).trim() : (row.comment ?? null);
    db.prepare(
      "UPDATE positions SET closed_at = ?, exit_price = ?, realized_pnl = ?, comment = ? WHERE id = ?"
    ).run(closedAt, Number(exitPrice), realizedPnl, finalComment, id);
    const updated = db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as Record<string, unknown>;
    res.json(rowToPosition(updated));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const TAKER_FEE_RATE = 0.00035;
function grossPnl(side: "long" | "short", entry: number, exit: number, size: number): number {
  return side === "long" ? size * (exit - entry) : size * (entry - exit);
}
function feeCost(notional: number): number {
  return notional * TAKER_FEE_RATE;
}
function computeRealizedPnl(side: "long" | "short", entry: number, exit: number, size: number): number {
  const gross = grossPnl(side, entry, exit, size);
  return gross - feeCost(size * entry) - feeCost(size * exit);
}

export default router;
