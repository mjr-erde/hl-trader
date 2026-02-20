/**
 * Aggregate P&L by strategy or asset from closed positions.
 * Reusable for web UI and CLI.
 */

import type { ClosedPosition } from "./positionsStore";
import { getStrategy } from "./strategies/registry";

export interface AssetPnl {
  asset: string;
  pnl: number;
  trades: number;
}

export function aggregatePnlByAsset(closed: ClosedPosition[]): AssetPnl[] {
  const byAsset = new Map<string, { pnl: number; trades: number }>();
  for (const p of closed) {
    const asset = p.coin;
    const cur = byAsset.get(asset) ?? { pnl: 0, trades: 0 };
    cur.pnl += p.realizedPnl;
    cur.trades += 1;
    byAsset.set(asset, cur);
  }
  return Array.from(byAsset.entries())
    .map(([asset, { pnl, trades }]) => ({ asset, pnl, trades }))
    .sort((a, b) => b.pnl - a.pnl); // highest profit first
}

export interface StrategyPnl {
  strategyId: string;
  name: string;
  pnl: number;
  trades: number;
}

export function aggregatePnlByStrategy(closed: ClosedPosition[]): StrategyPnl[] {
  const byStrategy = new Map<string, { pnl: number; trades: number }>();
  for (const p of closed) {
    const id = p.strategyId || "manual";
    const cur = byStrategy.get(id) ?? { pnl: 0, trades: 0 };
    cur.pnl += p.realizedPnl;
    cur.trades += 1;
    byStrategy.set(id, cur);
  }
  return Array.from(byStrategy.entries())
    .map(([strategyId, { pnl, trades }]) => ({
      strategyId,
      name: getStrategy(strategyId)?.name ?? strategyId,
      pnl,
      trades,
    }))
    .sort((a, b) => b.pnl - a.pnl); // highest profit first
}
