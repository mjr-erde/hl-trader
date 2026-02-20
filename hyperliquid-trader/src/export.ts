/**
 * Export all transactions for tax and financial analysis.
 * Fetches fills, funding, and non-funding ledger updates.
 */

import type { InfoClient } from "@nktkas/hyperliquid";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ExportOptions {
  /** Start time (ms since epoch). Default: 1 year ago. */
  startTime?: number;
  /** End time (ms since epoch). Default: now. */
  endTime?: number;
}

export interface ExportedTx {
  type: "fill" | "funding" | "ledger";
  time: number;
  hash: string;
  [key: string]: unknown;
}

/**
 * Fetch all fills in time range. Paginates by 7-day windows (API limit ~2000/request).
 */
async function fetchAllFills(
  info: InfoClient,
  user: `0x${string}`,
  startTime: number,
  endTime: number
): Promise<ExportedTx[]> {
  const fills: ExportedTx[] = [];
  let cursor = startTime;
  const windowMs = 7 * MS_PER_DAY;

  while (cursor < endTime) {
    const windowEnd = Math.min(cursor + windowMs, endTime);
    const batch = await info.userFillsByTime({
      user,
      startTime: cursor,
      endTime: windowEnd,
    });
    for (const f of batch as Array<Record<string, unknown>>) {
      fills.push({
        type: "fill",
        time: f.time as number,
        hash: f.hash as string,
        coin: f.coin,
        px: f.px,
        sz: f.sz,
        side: f.side,
        closedPnl: f.closedPnl,
        fee: f.fee,
        feeToken: f.feeToken,
        oid: f.oid,
        tid: f.tid,
        crossed: f.crossed,
        dir: f.dir,
        startPosition: f.startPosition,
      });
    }
    if (batch.length < 2000) {
      cursor = windowEnd;
    } else {
      cursor = (batch[batch.length - 1] as { time: number }).time + 1;
    }
    if (batch.length === 0) cursor = windowEnd;
  }

  return fills;
}

/**
 * Fetch all funding ledger updates.
 */
async function fetchFunding(
  info: InfoClient,
  user: `0x${string}`,
  startTime?: number,
  endTime?: number
): Promise<ExportedTx[]> {
  const params: { user: `0x${string}`; startTime?: number; endTime?: number } = { user };
  if (startTime != null) params.startTime = startTime;
  if (endTime != null) params.endTime = endTime;
  const batch = await info.userFunding(params);
  return (batch as Array<Record<string, unknown>>).map((f) => ({
    type: "funding" as const,
    time: f.time as number,
    hash: f.hash as string,
    delta: f.delta,
  }));
}

/**
 * Fetch all non-funding ledger updates (deposits, withdrawals, transfers, etc.).
 */
async function fetchNonFundingLedger(
  info: InfoClient,
  user: `0x${string}`,
  startTime?: number,
  endTime?: number
): Promise<ExportedTx[]> {
  const params: { user: `0x${string}`; startTime?: number; endTime?: number } = { user };
  if (startTime != null) params.startTime = startTime;
  if (endTime != null) params.endTime = endTime;
  const batch = await info.userNonFundingLedgerUpdates(params);
  return (batch as Array<Record<string, unknown>>).map((f) => ({
    type: "ledger" as const,
    time: f.time as number,
    hash: f.hash as string,
    delta: f.delta,
  }));
}

/**
 * Export all transactions for the user. Suitable for tax and financial analysis.
 */
export async function exportAllTransactions(
  info: InfoClient,
  user: `0x${string}`,
  opts: ExportOptions = {}
): Promise<ExportedTx[]> {
  const endTime = opts.endTime ?? Date.now();
  const startTime = opts.startTime ?? endTime - 365 * MS_PER_DAY;

  const [fills, funding, ledger] = await Promise.all([
    fetchAllFills(info, user, startTime, endTime),
    fetchFunding(info, user, startTime, endTime),
    fetchNonFundingLedger(info, user, startTime, endTime),
  ]);

  const all: ExportedTx[] = [...fills, ...funding, ...ledger];
  all.sort((a, b) => a.time - b.time);
  return all;
}
