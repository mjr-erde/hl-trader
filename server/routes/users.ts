/**
 * Users API — identify by name only (no password).
 */

import { Router } from "express";
import { getDb } from "../db.ts";
import { getAllMids } from "../../hyperliquid-trader/src/info.js";

const TAKER_FEE_RATE = 0.00035;

function computeRealizedPnl(side: "long" | "short", entry: number, exit: number, size: number): number {
  const gross = side === "long" ? size * (exit - entry) : size * (entry - exit);
  return gross - TAKER_FEE_RATE * (size * entry + size * exit);
}

const router = Router();

/** GET /api/users — list all users */
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT id, name, created_at FROM users ORDER BY created_at DESC").all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/users — create or get user by name */
router.post("/", (req, res) => {
  const name = (req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const db = getDb();
    let row = db.prepare("SELECT id, name, created_at FROM users WHERE name = ?").get(name) as { id: number; name: string; created_at: number } | undefined;
    if (!row) {
      const stmt = db.prepare("INSERT INTO users (name) VALUES (?)");
      const info = stmt.run(name);
      row = db.prepare("SELECT id, name, created_at FROM users WHERE id = ?").get(info.lastInsertRowid) as { id: number; name: string; created_at: number };
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/users/:id/export — full trade history. Open positions logged as closed at export time. */
router.get("/:id/export", async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    res.status(400).json({ error: "user id required" });
    return;
  }
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, name, created_at FROM users WHERE id = ?").get(userId) as { id: number; name: string; created_at: number } | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const rows = db.prepare(
      "SELECT id, coin, side, entry_price, size, strategy_id, opened_at, closed_at, exit_price, realized_pnl, comment FROM positions WHERE user_id = ? ORDER BY opened_at ASC"
    ).all(userId) as Record<string, unknown>[];
    const exportedAt = Date.now();
    const openRows = rows.filter((r) => r.closed_at == null);
    let mids: Record<string, string> = {};
    if (openRows.length > 0) {
      mids = await getAllMids(false);
    }

    const history = rows.map((r) => {
      if (r.closed_at != null) {
        return {
          id: r.id,
          coin: r.coin,
          side: r.side,
          entryPrice: r.entry_price,
          size: r.size,
          strategyId: r.strategy_id,
          openedAt: r.opened_at,
          closedAt: r.closed_at,
          exitPrice: r.exit_price,
          realizedPnl: r.realized_pnl,
          comment: r.comment ?? null,
        };
      }
      const exitPrice = parseFloat(mids[r.coin as string] ?? "0") || (r.entry_price as number);
      const entryPrice = r.entry_price as number;
      const size = r.size as number;
      const side = r.side as "long" | "short";
      const realizedPnl = computeRealizedPnl(side, entryPrice, exitPrice, size);
      return {
        id: r.id,
        coin: r.coin,
        side: r.side,
        entryPrice: r.entry_price,
        size: r.size,
        strategyId: r.strategy_id,
        openedAt: r.opened_at,
        closedAt: exportedAt,
        exitPrice,
        realizedPnl,
        comment: r.comment ?? null,
      };
    });

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.json({ user, positions: history, exportedAt });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/users/:id/reset — close all positions, delete all position history (keep user) */
router.post("/:id/reset", (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    res.status(400).json({ error: "user id required" });
    return;
  }
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, name FROM users WHERE id = ?").get(userId) as { id: number; name: string } | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    db.prepare("DELETE FROM positions WHERE user_id = ?").run(userId);
    res.json({ ok: true, message: "User reset: all positions cleared" });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** DELETE /api/users/:id — remove user and all positions from database */
router.delete("/:id", (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    res.status(400).json({ error: "user id required" });
    return;
  }
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, name FROM users WHERE id = ?").get(userId) as { id: number; name: string } | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    db.prepare("DELETE FROM positions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    res.json({ ok: true, message: "User deleted" });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
