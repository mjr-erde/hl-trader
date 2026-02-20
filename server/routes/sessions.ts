/**
 * Sessions API — register and manage trading sessions.
 */

import { Router } from "express";
import { getDb } from "../db.ts";

const router = Router();

/** POST /api/sessions — register a new session */
router.post("/", (req, res) => {
  const body = req.body ?? {};
  const {
    id,
    marketplace = "hyperliquid",
    mode = "live",
    env = "production",
    profileJson,
    operator,
  } = body;

  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }

  const now = Date.now();

  try {
    const db = getDb();
    // Upsert — safe to re-register on restart
    db.prepare(
      `INSERT INTO sessions (id, marketplace, mode, env, profile_json, operator, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at,
         operator = COALESCE(excluded.operator, operator)`
    ).run(
      String(id),
      String(marketplace),
      String(mode),
      String(env),
      profileJson ? String(profileJson) : null,
      operator ? String(operator) : null,
      now,
      now
    );
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** POST /api/sessions/:id/end — mark session as ended */
router.post("/:id/end", (req, res) => {
  const { id } = req.params;
  const { statsJson } = req.body ?? {};

  try {
    const db = getDb();
    db.prepare(
      `UPDATE sessions SET ended_at = ?, stats_json = COALESCE(?, stats_json) WHERE id = ?`
    ).run(Date.now(), statsJson ? String(statsJson) : null, id);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    if (!row) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/sessions — list sessions (most recent first) */
router.get("/", (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const marketplace = req.query.marketplace as string | undefined;

  try {
    const db = getDb();
    const conditions = marketplace ? "WHERE marketplace = ?" : "";
    const values = marketplace ? [marketplace, limit] : [limit];
    const rows = db
      .prepare(`SELECT * FROM sessions ${conditions} ORDER BY started_at DESC LIMIT ?`)
      .all(...values);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/** GET /api/sessions/:id — session detail */
router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    // Also fetch trade stats
    const stats = db.prepare(
      `SELECT
         COUNT(*) as total_trades,
         COUNT(CASE WHEN closed_at IS NOT NULL THEN 1 END) as closed_trades,
         COUNT(CASE WHEN closed_at IS NULL THEN 1 END) as open_trades,
         SUM(CASE WHEN closed_at IS NOT NULL THEN realized_pnl ELSE 0 END) as total_pnl
       FROM trades WHERE session_id = ?`
    ).get(req.params.id);
    res.json({ ...(row as object), tradeStats: stats });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
