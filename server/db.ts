/**
 * SQLite database — unified schema.
 *
 * Environment switching via TRADER_ENV:
 *   testing    → :memory:                  (in-process tests, no side effects)
 *   local      → .trader/trader-local.db   (dev/paper trading)
 *   production → .trader/trader.db         (default, real trading)
 *
 * DB path can also be overridden with TRADER_DATA_DIR env var.
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

export type DbEnv = "testing" | "local" | "production";

function resolveEnv(): DbEnv {
  const e = process.env.TRADER_ENV ?? "production";
  if (e === "testing" || e === "local" || e === "production") return e;
  return "production";
}

function resolveDbPath(env: DbEnv): string {
  if (env === "testing") return ":memory:";
  const dataDir =
    process.env.TRADER_DATA_DIR || path.join(process.cwd(), ".trader");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filename = env === "local" ? "trader-local.db" : "trader.db";
  return path.join(dataDir, filename);
}

let dbInstance: Database.Database | null = null;

export function getDb(env?: DbEnv): Database.Database {
  if (dbInstance) return dbInstance;
  const resolved = env ?? resolveEnv();
  const dbPath = resolveDbPath(resolved);
  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("busy_timeout = 5000");
  initSchema(dbInstance);
  return dbInstance;
}

/** Reset singleton — only used in tests */
export function _resetDb(): void {
  dbInstance = null;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- ── Legacy tables (kept for backward compat during transition) ────────────

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      coin TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('long','short')),
      entry_price REAL NOT NULL,
      size REAL NOT NULL,
      strategy_id TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      exit_price REAL,
      realized_pnl REAL,
      leverage INTEGER,
      comment TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_positions_closed ON positions(closed_at);

    CREATE TABLE IF NOT EXISTS hl_trades (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      coin TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('long','short')),
      entry_price REAL NOT NULL,
      size REAL NOT NULL,
      leverage INTEGER,
      strategy_reason TEXT,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      exit_price REAL,
      realized_pnl REAL,
      fee REAL,
      order_id TEXT,
      tid TEXT,
      hash TEXT,
      source TEXT DEFAULT 'cli',
      comment TEXT,
      indicators_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_hl_trades_username ON hl_trades(username);
    CREATE INDEX IF NOT EXISTS idx_hl_trades_opened ON hl_trades(opened_at);
    CREATE INDEX IF NOT EXISTS idx_hl_trades_coin ON hl_trades(coin);

    -- ── Unified schema ────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      marketplace TEXT NOT NULL DEFAULT 'hyperliquid',
      mode        TEXT NOT NULL DEFAULT 'live',
      env         TEXT NOT NULL DEFAULT 'production',
      profile_json TEXT,
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      stats_json  TEXT,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

    CREATE TABLE IF NOT EXISTS trades (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id),
      marketplace     TEXT NOT NULL DEFAULT 'hyperliquid',
      mode            TEXT NOT NULL DEFAULT 'live',
      coin            TEXT NOT NULL,
      side            TEXT NOT NULL,
      entry_price     REAL NOT NULL,
      size            REAL NOT NULL,
      leverage        REAL,
      strategy_reason TEXT,
      opened_at       INTEGER NOT NULL,
      closed_at       INTEGER,
      exit_price      REAL,
      realized_pnl    REAL,
      fee             REAL,
      comment         TEXT,
      indicators_json TEXT,
      order_id        TEXT,
      tx_hash         TEXT,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_trades_session     ON trades(session_id);
    CREATE INDEX IF NOT EXISTS idx_trades_marketplace ON trades(marketplace, mode);
    CREATE INDEX IF NOT EXISTS idx_trades_opened      ON trades(opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_coin        ON trades(coin);

    -- ── Backward-compat views (drop after 2+ sessions of unified data) ────────
    CREATE VIEW IF NOT EXISTS v_hl_trades AS
      SELECT * FROM trades WHERE marketplace = 'hyperliquid';

    CREATE VIEW IF NOT EXISTS v_positions AS
      SELECT * FROM trades WHERE mode = 'simulated';
  `);

  // ── Migrations for existing DBs ──────────────────────────────────────────
  safeAlter(db, "positions", "comment", "TEXT");
  safeAlter(db, "hl_trades", "indicators_json", "TEXT");

  // Backfill users from hl_trades usernames — agents that ran before registerSession()
  // added the /api/users POST call won't appear in the Simulated dashboard dropdown.
  try {
    db.exec(`
      INSERT OR IGNORE INTO users (name)
      SELECT DISTINCT username FROM hl_trades
      WHERE username NOT IN (SELECT name FROM users)
    `);
  } catch { /* hl_trades may not exist in edge cases */ }

  // Backfill sessions from hl_trades — historical agent runs that predate the sessions
  // table (or ran before registerSession() existed) need synthetic entries so they
  // appear in the Live Sessions tab.
  try {
    db.exec(`
      INSERT OR IGNORE INTO sessions (id, marketplace, mode, env, started_at, created_at)
      SELECT username, 'hyperliquid', 'live', 'production', MIN(opened_at), MIN(opened_at)
      FROM hl_trades
      WHERE username NOT IN (SELECT id FROM sessions)
      GROUP BY username
    `);
  } catch { /* non-fatal */ }
}

function safeAlter(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  try {
    const info = db.pragma(`table_info(${table})`) as { name: string }[];
    if (!info.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch {
    /* table may not exist yet — ok */
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  created_at: number;
}

export interface PositionRow {
  id: string;
  user_id: number;
  coin: string;
  side: "long" | "short";
  entry_price: number;
  size: number;
  strategy_id: string;
  opened_at: number;
  closed_at: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  leverage: number | null;
  comment: string | null;
}

export interface HlTradeRow {
  id: string;
  username: string;
  coin: string;
  side: "long" | "short";
  entry_price: number;
  size: number;
  leverage: number | null;
  strategy_reason: string | null;
  opened_at: number;
  closed_at: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  fee: number | null;
  order_id: string | null;
  tid: string | null;
  hash: string | null;
  source: string | null;
  comment: string | null;
  indicators_json: string | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  marketplace: string;
  mode: "live" | "simulated";
  env: string;
  profile_json: string | null;
  started_at: number;
  ended_at: number | null;
  stats_json: string | null;
  created_at: number;
}

export interface TradeRow {
  id: string;
  session_id: string;
  marketplace: string;
  mode: "live" | "simulated";
  coin: string;
  side: "long" | "short";
  entry_price: number;
  size: number;
  leverage: number | null;
  strategy_reason: string | null;
  opened_at: number;
  closed_at: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  fee: number | null;
  comment: string | null;
  indicators_json: string | null;
  order_id: string | null;
  tx_hash: string | null;
  created_at: number;
}
