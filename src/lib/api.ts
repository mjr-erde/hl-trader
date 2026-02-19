/**
 * Shared API client for positions and users.
 * Used by web app and CLI when TRADER_API_URL is set (or in browser, defaults to same origin).
 */

import type { Position } from "./strategies/types";
import type { ClosedPosition } from "./positionsStore";

const DEFAULT_API = typeof window !== "undefined" ? "" : "http://localhost:3000";

function base(): string {
  if (typeof window === "undefined") {
    return process.env.TRADER_API_URL ?? DEFAULT_API;
  }
  // In browser: use VITE_API_URL if set, else same origin (fallback to localhost for file:// or edge cases)
  const url = import.meta.env.VITE_API_URL ?? "";
  if (url) return url;
  const origin = window.location.origin;
  if (origin && origin !== "null" && !origin.startsWith("file")) return origin;
  return "http://localhost:3000";
}

export interface User {
  id: number;
  name: string;
  created_at: number;
}

export async function apiGetUsers(): Promise<User[]> {
  const res = await fetch(`${base()}/api/users`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiEnsureUser(name: string): Promise<User> {
  const res = await fetch(`${base()}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiGetOpenPositions(userId: number): Promise<Position[]> {
  const res = await fetch(`${base()}/api/positions?userId=${userId}`);
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return rows.map(normalizePosition);
}

export async function apiGetClosedPositions(userId: number): Promise<ClosedPosition[]> {
  const res = await fetch(`${base()}/api/positions/closed?userId=${userId}`);
  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();
  return rows.map(normalizeClosedPosition);
}

export async function apiOpenPosition(
  userId: number,
  coin: string,
  side: "long" | "short",
  entryPrice: number,
  size: number,
  strategyId: string,
  leverage?: number,
  comment?: string
): Promise<Position> {
  const res = await fetch(`${base()}/api/positions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      coin,
      side,
      entryPrice,
      size,
      strategyId,
      leverage,
      comment,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const row = await res.json();
  return normalizePosition(row);
}

export async function apiClosePosition(positionId: string, exitPrice: number, comment?: string): Promise<ClosedPosition> {
  const res = await fetch(`${base()}/api/positions/${positionId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exitPrice, comment }),
  });
  if (!res.ok) throw new Error(await res.text());
  const row = await res.json();
  return normalizeClosedPosition(row);
}

function normalizePosition(row: Record<string, unknown>): Position {
  return {
    id: String(row.id),
    coin: String(row.coin),
    side: row.side as "long" | "short",
    entryPrice: Number(row.entryPrice),
    size: Number(row.size),
    strategyId: String(row.strategyId),
    openedAt: Number(row.openedAt),
    leverage: row.leverage != null ? Number(row.leverage) : undefined,
    comment: row.comment != null ? String(row.comment) : undefined,
  };
}

function normalizeClosedPosition(row: Record<string, unknown>): ClosedPosition {
  return {
    ...normalizePosition(row),
    closedAt: Number(row.closedAt),
    exitPrice: Number(row.exitPrice),
    realizedPnl: Number(row.realizedPnl),
    comment: row.comment != null ? String(row.comment) : undefined,
  };
}

export interface ExportData {
  user: User;
  positions: Array<{
    id: string;
    coin: string;
    side: string;
    entryPrice: number;
    size: number;
    strategyId: string;
    openedAt: number;
    closedAt: number | null;
    exitPrice: number | null;
    realizedPnl: number | null;
    comment: string | null;
  }>;
  exportedAt?: number;
}

export async function apiExportUserHistory(userId: number): Promise<ExportData> {
  const res = await fetch(`${base()}/api/users/${userId}/export?_=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiResetUser(userId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${base()}/api/users/${userId}/reset`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiDeleteUser(userId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${base()}/api/users/${userId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Process logs via Ollama and return summary text for download */
export async function apiProcessLogs(model?: string): Promise<Blob> {
  const res = await fetch(`${base()}/api/logs/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model || "llama3.2" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `Failed: ${res.status}`);
  }
  return res.blob();
}

export function isApiAvailable(): boolean {
  if (typeof window !== "undefined") return true;
  return !!process.env.TRADER_API_URL;
}

// Admin API — full CRUD for users and positions
export interface AdminUserRow {
  id: number;
  name: string;
  created_at: number;
}

export interface AdminPositionRow {
  id: string;
  user_id: number;
  user_name?: string;
  coin: string;
  side: string;
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

export async function apiAdminGetUsers(): Promise<AdminUserRow[]> {
  const res = await fetch(`${base()}/api/admin/users`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiAdminGetPositions(): Promise<AdminPositionRow[]> {
  const res = await fetch(`${base()}/api/admin/positions`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiAdminUpdateUser(id: number, patch: Partial<Pick<AdminUserRow, "name" | "created_at">>): Promise<AdminUserRow> {
  const res = await fetch(`${base()}/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Hyperliquid real-money API
export interface HlPosition {
  coin: string;
  side: "long" | "short";
  szi: string;
  size: number;
  entryPx: string;
  entryPrice: number;
  leverage: number;
}

export interface HlPositionsResponse {
  account: string;
  positions: HlPosition[];
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: string };
    return j.error ?? text;
  } catch {
    return text || res.statusText;
  }
}

export async function apiHlPositions(): Promise<HlPositionsResponse> {
  const res = await fetch(`${base()}/api/hl/positions`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export interface HlClosedPosition {
  coin: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  closedAt: number;
  hash: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min for trades
const CLOSED_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min for chain closed positions (immutable)

const tradesCache = new Map<string, { data: HlTrade[]; ts: number }>();
const closedCache = new Map<string, { data: HlClosedPosition[]; ts: number }>();

export async function apiHlClosedPositions(days = 90): Promise<HlClosedPosition[]> {
  const key = `closed-${days}`;
  const hit = closedCache.get(key);
  if (hit && Date.now() - hit.ts < CLOSED_CACHE_TTL_MS) return hit.data;
  const res = await fetch(`${base()}/api/hl/closed-positions?days=${days}`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as HlClosedPosition[];
  closedCache.set(key, { data, ts: Date.now() });
  return data;
}

export interface HlTrade {
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
  comment: string | null;
}

export async function apiHlTrades(username: string): Promise<HlTrade[]> {
  const hit = tradesCache.get(username);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  const res = await fetch(`${base()}/api/hl/trades?username=${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as HlTrade[];
  tradesCache.set(username, { data, ts: Date.now() });
  return data;
}

/** Invalidate trades cache when a new trade is logged or closed (call after POST/PATCH). */
export function invalidateTradesCache(username?: string): void {
  if (username) tradesCache.delete(username);
  else tradesCache.clear();
}

export async function apiHlTradeUsernames(): Promise<string[]> {
  const res = await fetch(`${base()}/api/hl/trades/usernames`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface SessionRow {
  id: string;
  marketplace: string;
  mode: "live" | "simulated";
  env: string;
  started_at: number;
  ended_at: number | null;
  stats_json: string | null;
}

export async function apiGetSessions(limit = 50): Promise<SessionRow[]> {
  const res = await fetch(`${base()}/api/sessions?limit=${limit}`);
  if (!res.ok) return []; // non-fatal — may not exist yet on old installations
  return res.json();
}

export interface HlClosedTrade {
  id: string;
  username: string;
  coin: string;
  side: "long" | "short";
  strategy_reason: string | null;
  opened_at: number;
  closed_at: number;
  exit_price: number | null;
  realized_pnl: number | null;
}

export async function apiHlClosedTrades(days = 90): Promise<HlClosedTrade[]> {
  const res = await fetch(`${base()}/api/hl/trades/closed?days=${days}`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export interface HlOpenTrade {
  id: string;
  username: string;
  coin: string;
  side: "long" | "short";
  strategy_reason: string | null;
  entry_price: number;
  size: number;
  opened_at: number;
}

export async function apiHlOpenTrades(): Promise<HlOpenTrade[]> {
  const res = await fetch(`${base()}/api/hl/trades/open`);
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function apiAdminUpdatePosition(
  id: string,
  patch: Partial<Omit<AdminPositionRow, "id">>
): Promise<AdminPositionRow> {
  const res = await fetch(`${base()}/api/admin/positions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
