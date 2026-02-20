/**
 * Admin API — full CRUD for users and positions.
 * Lists all rows, supports inline field updates (saved in real time).
 */

import { Router } from "express";
import { getDb } from "../db.ts";

const router = Router();

/** GET /api/admin — health check */
router.get("/", (req, res) => {
  res.json({ ok: true, message: "Admin API" });
});

/** GET /api/admin/users — list all users (raw DB rows) */
router.get("/users", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT id, name, created_at FROM users ORDER BY id").all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** PATCH /api/admin/users/:id — update user row */
router.patch("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, created_at } = req.body ?? {};
  if (!id) {
    res.status(400).json({ error: "user id required" });
    return;
  }
  try {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    if (name !== undefined) {
      updates.push("name = ?");
      values.push(String(name).trim());
    }
    if (created_at !== undefined) {
      updates.push("created_at = ?");
      values.push(Number(created_at));
    }
    if (updates.length === 0) {
      const row = db.prepare("SELECT id, name, created_at FROM users WHERE id = ?").get(id);
      return res.json(row);
    }
    values.push(id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT id, name, created_at FROM users WHERE id = ?").get(id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/admin/positions — list all positions (raw DB rows) with user name */
router.get("/positions", (req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.id, p.user_id, u.name AS user_name, p.coin, p.side, p.entry_price, p.size, p.strategy_id,
         p.opened_at, p.closed_at, p.exit_price, p.realized_pnl, p.leverage, p.comment
         FROM positions p
         LEFT JOIN users u ON p.user_id = u.id
         ORDER BY p.opened_at DESC`
      )
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** PATCH /api/admin/positions/:id — update position row */
router.patch("/positions/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const body = req.body ?? {};
  if (!id) {
    res.status(400).json({ error: "position id required" });
    return;
  }
  try {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM positions WHERE id = ?").get(id);
    if (!existing) {
      res.status(404).json({ error: "Position not found" });
      return;
    }
    const allowed = [
      "user_id",
      "coin",
      "side",
      "entry_price",
      "size",
      "strategy_id",
      "opened_at",
      "closed_at",
      "exit_price",
      "realized_pnl",
      "leverage",
      "comment",
    ] as const;
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      updates.push(`${key} = ?`);
      const v = body[key];
      if (key === "closed_at" || key === "exit_price" || key === "realized_pnl" || key === "leverage") {
        values.push(v === null || v === "" ? null : Number(v));
      } else if (key === "comment") {
        values.push(v === null || v === "" ? null : String(v));
      } else if (key === "opened_at") {
        values.push(Number(v));
      } else {
        values.push(v);
      }
    }
    if (updates.length === 0) {
      const row = db.prepare("SELECT * FROM positions WHERE id = ?").get(id);
      return res.json(row);
    }
    if (body.side !== undefined && body.side !== "long" && body.side !== "short") {
      res.status(400).json({ error: "side must be long or short" });
      return;
    }
    values.push(id);
    db.prepare(`UPDATE positions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    const row = db.prepare("SELECT * FROM positions WHERE id = ?").get(id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
