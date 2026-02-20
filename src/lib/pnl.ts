/**
 * PnL calculation for virtual perp positions.
 * Complete model from knowledge/crypto-trading-strategies.md §6.4:
 * Net PnL = Gross PnL - entry_fee - exit_fee - funding
 * Taker fee: 0.035% (3.5 bps) both sides for market orders.
 */

const TAKER_FEE_RATE = 0.00035; // 0.035%

export function grossPnl(
  side: "long" | "short",
  entryPrice: number,
  exitPrice: number,
  size: number
): number {
  if (side === "long") {
    return size * (exitPrice - entryPrice);
  }
  return size * (entryPrice - exitPrice);
}

export function feeCost(notional: number): number {
  return notional * TAKER_FEE_RATE;
}

export function unrealizedPnl(
  side: "long" | "short",
  entryPrice: number,
  currentPrice: number,
  size: number
): number {
  const gross = grossPnl(side, entryPrice, currentPrice, size);
  const entryFee = feeCost(size * entryPrice);
  const exitFee = feeCost(size * currentPrice);
  return gross - entryFee - exitFee;
}

export function realizedPnl(
  side: "long" | "short",
  entryPrice: number,
  exitPrice: number,
  size: number
): number {
  const gross = grossPnl(side, entryPrice, exitPrice, size);
  const entryFee = feeCost(size * entryPrice);
  const exitFee = feeCost(size * exitPrice);
  return gross - entryFee - exitFee;
}

/** Margin required to hold a position */
export function margin(entryPrice: number, size: number, leverage: number = 1): number {
  return (size * entryPrice) / leverage;
}

/** Estimated liquidation price (simplified: 100% margin loss minus maintenance margin ~0.5%) */
export function liquidationPrice(
  side: "long" | "short",
  entryPrice: number,
  leverage: number = 1
): number | null {
  if (leverage <= 1) return null; // no liquidation at 1x
  const maintenanceMargin = 0.005; // 0.5% maintenance margin
  const moveToLiq = (1 / leverage) - maintenanceMargin;
  if (side === "long") {
    return entryPrice * (1 - moveToLiq);
  }
  return entryPrice * (1 + moveToLiq);
}

/** Return on equity (margin-based return) */
export function roe(pnl: number, marginAmt: number): number {
  if (marginAmt === 0) return 0;
  return pnl / marginAmt;
}
