/**
 * Positions store — open and closed virtual positions.
 * Browser: persists to localStorage. CLI: use initStorage with file adapter.
 */

import type { Position } from "./strategies/types";
import { realizedPnl } from "./pnl";

export interface ClosedPosition extends Position {
  closedAt: number;
  exitPrice: number;
  realizedPnl: number;
  comment?: string;
}

export interface PositionsState {
  open: Position[];
  closed: ClosedPosition[];
}

export interface StorageAdapter {
  load: () => PositionsState;
  save: (state: PositionsState) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultLoad(): PositionsState {
  if (typeof window !== "undefined") {
    try {
      const s = localStorage.getItem("trader-positions");
      if (s) return JSON.parse(s) as PositionsState;
    } catch {
      /* ignore */
    }
  }
  return { open: [], closed: [] };
}

function defaultSave(s: PositionsState): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("trader-positions", JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }
}

let storage: StorageAdapter = {
  load: defaultLoad,
  save: defaultSave,
};

/** Call from CLI to use file storage. */
export function initStorage(adapter: StorageAdapter): void {
  storage = adapter;
  state = storage.load();
}

let state: PositionsState = storage.load();

function saveState(): void {
  storage.save(state);
}

export function getOpenPositions(): Position[] {
  return [...state.open];
}

export function getClosedPositions(): ClosedPosition[] {
  return [...state.closed];
}

export function openPosition(
  coin: string,
  side: "long" | "short",
  entryPrice: number,
  size: number,
  strategyId: string
): Position {
  const position: Position = {
    id: generateId(),
    coin,
    side,
    entryPrice,
    size,
    strategyId,
    openedAt: Date.now(),
  };
  state.open.push(position);
  saveState();
  return position;
}

export function closePosition(
  positionId: string,
  exitPrice: number
): ClosedPosition | null {
  const idx = state.open.findIndex((p) => p.id === positionId);
  if (idx === -1) return null;
  const pos = state.open[idx];
  state.open.splice(idx, 1);
  const pnl = realizedPnl(pos.side, pos.entryPrice, exitPrice, pos.size);
  const closed: ClosedPosition = {
    ...pos,
    closedAt: Date.now(),
    exitPrice,
    realizedPnl: pnl,
  };
  state.closed.push(closed);
  saveState();
  return closed;
}

export function getState(): PositionsState {
  return { open: [...state.open], closed: [...state.closed] };
}
