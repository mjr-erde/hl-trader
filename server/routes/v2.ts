/**
 * v2 API — optimized, paginated, SQL-aggregated endpoints for the erde dashboard.
 *
 * Source of truth: hl_trades (all agent + CLI trades), joined with sessions for
 * operator / mode metadata. username in hl_trades = session id in sessions.
 *
 * Endpoints:
 *   GET /api/v2/trades          — paginated trade list with filters
 *   GET /api/v2/trades/export   — CSV export of current filtered view
 *   GET /api/v2/filters         — distinct values for filter dropdowns
 *   GET /api/v2/pnl/by-session  — P&L aggregated per session (agent run)
 *   GET /api/v2/pnl/by-operator — P&L aggregated per operator
 *   GET /api/v2/pnl/cumulative  — time-series cumulative P&L
 */

import { Router } from "express";
import { getDb } from "../db.ts";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const SORT_COLS: Record<string, string> = {
  opened_at:       "t.opened_at",
  coin:            "t.coin",
  side:            "t.side",
  entry_price:     "t.entry_price",
  exit_price:      "t.exit_price",
  realized_pnl:    "t.realized_pnl",
  agent:           "t.username",
  strategy_reason: "t.strategy_reason",
  duration:        "(COALESCE(t.closed_at, 0) - t.opened_at)",
};

function buildTradeFilter(query: Record<string, string | undefined>) {
  const { agent, operator, from, to, coin, side, mode, rule } = query;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (agent) {
    conditions.push("t.username = ?");
    values.push(agent);
  }
  if (operator) {
    conditions.push("s.operator = ?");
    values.push(operator);
  }
  if (from) {
    conditions.push("t.opened_at >= ?");
    values.push(Number(from));
  }
  if (to) {
    conditions.push("t.opened_at <= ?");
    values.push(Number(to));
  }
  if (coin) {
    conditions.push("t.coin = ?");
    values.push(coin);
  }
  if (side) {
    conditions.push("t.side = ?");
    values.push(side);
  }
  if (mode) {
    conditions.push("COALESCE(s.mode, 'live') = ?");
    values.push(mode);
  }
  if (rule) {
    conditions.push("t.strategy_reason LIKE ?");
    values.push(`${rule}%`);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const sortCol = SORT_COLS[query.sortBy ?? ""] ?? "t.opened_at";
  const sortDir = query.sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = `ORDER BY ${sortCol} ${sortDir}`;

  return { where, values, orderBy };
}

// ── GET /api/v2/trades ────────────────────────────────────────────────────────

router.get("/trades", (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const offset = (page - 1) * limit;

  const { where, values, orderBy } = buildTradeFilter(query);

  try {
    const db = getDb();
    const baseQuery = `
      FROM hl_trades t
      LEFT JOIN sessions s ON s.id = t.username
      ${where}
    `;

    const total = (db.prepare(`SELECT COUNT(*) as n ${baseQuery}`).get(...values) as { n: number }).n;

    const rows = db.prepare(`
      SELECT
        t.id,
        t.username       as agent,
        t.coin,
        t.side,
        t.entry_price,
        t.exit_price,
        t.size,
        t.leverage,
        t.strategy_reason,
        t.opened_at,
        t.closed_at,
        t.realized_pnl,
        t.fee,
        t.comment,
        t.indicators_json,
        t.source,
        COALESCE(s.operator, '') as operator,
        COALESCE(s.mode, 'live') as session_mode,
        s.profile_json
      ${baseQuery}
      ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);

    res.json({ trades: rows, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/trades/export ─────────────────────────────────────────────────

router.get("/trades/export", (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const { where, values } = buildTradeFilter(query);

  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        t.id,
        t.username       as agent,
        t.coin,
        t.side,
        t.entry_price,
        t.exit_price,
        t.size,
        t.leverage,
        t.strategy_reason,
        COALESCE(s.mode, 'live') as mode,
        t.opened_at,
        t.closed_at,
        t.realized_pnl,
        t.fee,
        t.comment,
        COALESCE(s.operator, '') as operator
      FROM hl_trades t
      LEFT JOIN sessions s ON s.id = t.username
      ${where}
      ORDER BY t.opened_at DESC
    `).all(...values) as Record<string, unknown>[];

    const headers = [
      "date", "time", "agent", "operator", "coin", "side",
      "entry_price", "exit_price", "size", "leverage",
      "strategy", "mode", "pnl", "pnl_pct", "duration_hrs", "comment",
    ];

    const csvRows = rows.map((row) => {
      const openedAt = row.opened_at as number;
      const dt = new Date(openedAt);
      const date = dt.toISOString().slice(0, 10);
      const time = dt.toISOString().slice(11, 16);
      const entryPrice = Number(row.entry_price);
      const exitPrice = row.exit_price != null ? Number(row.exit_price) : null;
      const pnl = row.realized_pnl != null ? Number(row.realized_pnl).toFixed(4) : "";
      const pnlPct = exitPrice != null && entryPrice > 0
        ? (((exitPrice - entryPrice) / entryPrice) * (row.side === "short" ? -1 : 1) * 100).toFixed(2)
        : "";
      const closedAt = row.closed_at as number | null;
      const durationHrs = closedAt
        ? ((closedAt - openedAt) / 3_600_000).toFixed(2)
        : "";
      const comment = String(row.comment ?? "").replace(/"/g, '""');
      return [
        date, time,
        row.agent, row.operator ?? "",
        row.coin, row.side,
        entryPrice, exitPrice ?? "",
        row.size, row.leverage ?? "",
        row.strategy_reason ?? "", row.mode,
        pnl, pnlPct, durationHrs,
        `"${comment}"`,
      ].join(",");
    });

    const csv = [headers.join(","), ...csvRows].join("\n");

    const now = new Date();
    const ts = now.toISOString().slice(0, 16).replace(/[-T:]/g, (c) =>
      c === "T" ? "-" : c === "-" ? "" : ""
    ).replace(/(\d{8})(\d{4})/, "$1-$2");
    const agent = (query.agent ?? "all").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);
    const operator = (query.operator ?? "all").replace(/[^a-z0-9_-]/gi, "-").slice(0, 20);
    const filename = `erde-trades-${ts}-${agent}-${operator}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/filters ───────────────────────────────────────────────────────

router.get("/filters", (req, res) => {
  try {
    const db = getDb();

    const agents = (db.prepare(
      "SELECT DISTINCT username as v FROM hl_trades ORDER BY v"
    ).all() as { v: string }[]).map((r) => r.v);

    const operators = (db.prepare(
      "SELECT DISTINCT operator as v FROM sessions WHERE operator IS NOT NULL ORDER BY v"
    ).all() as { v: string }[]).map((r) => r.v);

    const coins = (db.prepare(
      "SELECT DISTINCT coin as v FROM hl_trades ORDER BY v"
    ).all() as { v: string }[]).map((r) => r.v);

    const modes = (db.prepare(
      "SELECT DISTINCT COALESCE(s.mode, 'live') as v FROM hl_trades t LEFT JOIN sessions s ON s.id = t.username ORDER BY v"
    ).all() as { v: string }[]).map((r) => r.v);

    const rules = (db.prepare(
      `SELECT DISTINCT strategy_reason as v FROM hl_trades
       WHERE strategy_reason IS NOT NULL ORDER BY v`
    ).all() as { v: string }[]).map((r) => r.v);

    // Active agents: last_heartbeat < 5 min ago OR (no heartbeat AND started_at < 5 min ago)
    const activeThreshold = Date.now() - 5 * 60 * 1000;
    const activeAgents = (db.prepare(
      `SELECT id FROM sessions WHERE
         (last_heartbeat IS NOT NULL AND last_heartbeat > ?)
         OR (last_heartbeat IS NULL AND started_at > ?)`
    ).all(activeThreshold, activeThreshold) as { id: string }[]).map((r) => r.id);

    res.json({ agents, operators, coins, modes, rules, activeAgents });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/pnl/by-session ────────────────────────────────────────────────

router.get("/pnl/by-session", (req, res) => {
  const { operator, from, to } = req.query as Record<string, string | undefined>;
  const limit = Math.min(500, Number(req.query.limit) || 100);

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (operator) { conditions.push("s.operator = ?"); values.push(operator); }
  if (from) { conditions.push("s.started_at >= ?"); values.push(Number(from)); }
  if (to) { conditions.push("s.started_at <= ?"); values.push(Number(to)); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const db = getDb();
    // Group hl_trades by username (= session id), join sessions for metadata
    const rows = db.prepare(`
      SELECT
        t.username                                             as session_id,
        COALESCE(s.operator, '')                              as operator,
        COALESCE(s.mode, 'live')                              as mode,
        COALESCE(s.marketplace, 'hyperliquid')                as marketplace,
        COALESCE(s.started_at, MIN(t.opened_at))              as started_at,
        s.ended_at,
        s.profile_json,
        COUNT(t.id)                                           as total_trades,
        COUNT(CASE WHEN t.closed_at IS NOT NULL THEN 1 END)   as closed_trades,
        COUNT(CASE WHEN t.realized_pnl > 0 THEN 1 END)        as wins,
        COUNT(CASE WHEN t.realized_pnl < 0 THEN 1 END)        as losses,
        COALESCE(SUM(CASE WHEN t.closed_at IS NOT NULL THEN t.realized_pnl ELSE 0 END), 0) as total_pnl
      FROM hl_trades t
      LEFT JOIN sessions s ON s.id = t.username
      ${where}
      GROUP BY t.username
      ORDER BY started_at DESC
      LIMIT ?
    `).all(...values, limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/pnl/by-operator ──────────────────────────────────────────────

router.get("/pnl/by-operator", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        COALESCE(s.operator, 'unknown')                       as operator,
        COUNT(DISTINCT t.username)                            as session_count,
        COUNT(t.id)                                           as total_trades,
        COUNT(CASE WHEN t.realized_pnl > 0 THEN 1 END)        as wins,
        COUNT(CASE WHEN t.realized_pnl < 0 THEN 1 END)        as losses,
        COALESCE(SUM(CASE WHEN t.closed_at IS NOT NULL THEN t.realized_pnl ELSE 0 END), 0) as total_pnl,
        MIN(t.opened_at)                                      as first_session,
        MAX(t.opened_at)                                      as last_session
      FROM hl_trades t
      LEFT JOIN sessions s ON s.id = t.username
      GROUP BY s.operator
      ORDER BY total_pnl DESC
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/pnl/cumulative ───────────────────────────────────────────────

router.get("/pnl/cumulative", (req, res) => {
  const { operator, from, to } = req.query as Record<string, string | undefined>;
  const conditions: string[] = ["t.closed_at IS NOT NULL", "t.realized_pnl IS NOT NULL"];
  const values: unknown[] = [];

  if (operator) {
    conditions.push("s.operator = ?");
    values.push(operator);
  }
  if (from) { conditions.push("t.closed_at >= ?"); values.push(Number(from)); }
  if (to) { conditions.push("t.closed_at <= ?"); values.push(Number(to)); }
  const where = `WHERE ${conditions.join(" AND ")}`;

  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.closed_at as ts, t.realized_pnl as pnl
      FROM hl_trades t
      LEFT JOIN sessions s ON s.id = t.username
      ${where}
      ORDER BY t.closed_at ASC
    `).all(...values) as { ts: number; pnl: number }[];

    let cumulative = 0;
    const result = rows.map((r) => {
      cumulative += r.pnl;
      const dt = new Date(r.ts);
      return {
        date: dt.toISOString().slice(0, 10),
        pnl: r.pnl,
        cumulative: Math.round(cumulative * 10000) / 10000,
      };
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── POST /api/v2/near-misses ─────────────────────────────────────────────────

router.post("/near-misses", (req, res) => {
  const { sessionId, coin, side, rule, reason, confidence, mlScore, priceAtSignal, indicatorsJson } = req.body ?? {};
  if (!sessionId || !coin || !side || !rule || !reason) {
    res.status(400).json({ error: "sessionId, coin, side, rule, reason required" });
    return;
  }
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO near_misses (session_id, coin, side, rule, reason, confidence, ml_score, price_at_signal, indicators_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, coin, side, rule, reason, confidence ?? null, mlScore ?? null, priceAtSignal ?? null, indicatorsJson ?? null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/near-misses ───────────────────────────────────────────────────

router.get("/near-misses", (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (query.sessionId) { conditions.push("session_id = ?"); values.push(query.sessionId); }
  if (query.coin)      { conditions.push("coin = ?");       values.push(query.coin); }
  if (query.rule)      { conditions.push("rule LIKE ?");    values.push(`${query.rule}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) as n FROM near_misses ${where}`).get(...values) as { n: number }).n;
    const rows = db.prepare(`
      SELECT * FROM near_misses ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
    res.json({ near_misses: rows, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── GET /api/v2/near-misses/analysis ─────────────────────────────────────────

router.get("/near-misses/analysis", (req, res) => {
  try {
    const db = getDb();

    const total = (db.prepare("SELECT COUNT(*) as n FROM near_misses").get() as { n: number }).n;

    const byRule = db.prepare(`
      SELECT
        rule,
        COUNT(*) as count,
        COUNT(CASE WHEN outcome_won = 1 THEN 1 END) as won_count,
        COUNT(CASE WHEN outcome_won IS NOT NULL THEN 1 END) as checked_count,
        ROUND(AVG(CASE WHEN outcome_won IS NOT NULL THEN outcome_pnl_pct END), 2) as avg_pnl_pct,
        ROUND(AVG(confidence), 3) as avg_confidence,
        ROUND(AVG(ml_score), 3) as avg_ml_score
      FROM near_misses
      GROUP BY rule
      ORDER BY count DESC
    `).all() as Array<{
      rule: string; count: number; won_count: number; checked_count: number;
      avg_pnl_pct: number | null; avg_confidence: number | null; avg_ml_score: number | null;
    }>;

    const byCoin = db.prepare(`
      SELECT
        coin,
        COUNT(*) as count,
        COUNT(CASE WHEN outcome_won = 1 THEN 1 END) as won_count,
        COUNT(CASE WHEN outcome_won IS NOT NULL THEN 1 END) as checked_count,
        ROUND(AVG(CASE WHEN outcome_won IS NOT NULL THEN outcome_pnl_pct END), 2) as avg_pnl_pct
      FROM near_misses
      GROUP BY coin
      ORDER BY count DESC
    `).all() as Array<{
      coin: string; count: number; won_count: number; checked_count: number; avg_pnl_pct: number | null;
    }>;

    const byBlockReason = db.prepare(`
      SELECT
        reason,
        COUNT(*) as count,
        COUNT(CASE WHEN outcome_won = 1 THEN 1 END) as won_count,
        COUNT(CASE WHEN outcome_won IS NOT NULL THEN 1 END) as checked_count
      FROM near_misses
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 10
    `).all() as Array<{ reason: string; count: number; won_count: number; checked_count: number }>;

    // Compute recommendations from the data
    const recommendations: string[] = [];
    for (const r of byRule) {
      if (r.checked_count >= 5) {
        const wr = r.won_count / r.checked_count;
        if (wr >= 0.65 && r.avg_confidence != null && r.avg_confidence < 0.55) {
          recommendations.push(
            `${r.rule}: ${(wr * 100).toFixed(0)}% estimated win rate on ${r.checked_count} near-misses (avg conf ${r.avg_confidence.toFixed(2)}). Consider lowering the confidence threshold slightly.`
          );
        }
        if (wr >= 0.65 && r.avg_ml_score != null && r.avg_ml_score < 0.5) {
          recommendations.push(
            `${r.rule}: ML score averaging ${r.avg_ml_score.toFixed(2)} is blocking high-win signals (${(wr * 100).toFixed(0)}% win rate). Retrain with recent live trades to improve ML calibration.`
          );
        }
      }
    }
    for (const c of byCoin) {
      if (c.checked_count >= 5 && c.won_count / c.checked_count >= 0.7) {
        recommendations.push(
          `${c.coin}: ${(c.won_count / c.checked_count * 100).toFixed(0)}% of near-misses would have been winners. Review why entries are being blocked for this coin.`
        );
      }
    }
    if (recommendations.length === 0 && total > 0) {
      recommendations.push("Not enough outcome data yet. Near-miss outcomes are checked automatically on the next agent scan cycle after a signal is detected. Keep the agent running to build outcome data.");
    }
    if (total === 0) {
      recommendations.push("No near-miss data yet. The agent logs near misses when entry signals are blocked by confidence thresholds, circuit breaker, or position limits. Start a trading session to populate this page.");
    }

    res.json({ total, byRule, byCoin, byBlockReason, recommendations });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
