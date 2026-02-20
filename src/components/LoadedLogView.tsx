/**
 * Read-only view of a loaded user log (exported trade history).
 * Shows trade history and P&L. No trading allowed.
 */

import { useMemo } from "react";
import { Button } from "./Button";
import type { ClosedPosition } from "../lib/positionsStore";
import type { Position } from "../lib/strategies/types";
import type { ExportData } from "../lib/api";
import { aggregatePnlByStrategy, aggregatePnlByAsset } from "../lib/pnlByStrategy";
import { hyperliquidTradeUrl } from "../lib/hyperliquid";
import { getStrategy } from "../lib/strategies/registry";
import { PnLChart } from "./PnLChart";

function parseExportToClosed(data: ExportData): ClosedPosition[] {
  const closed: ClosedPosition[] = [];
  for (const p of data.positions) {
    if (p.closedAt == null || p.exitPrice == null || p.realizedPnl == null) continue;
    closed.push({
      id: String(p.id ?? ""),
      coin: p.coin,
      side: p.side as "long" | "short",
      entryPrice: p.entryPrice,
      size: p.size,
      strategyId: p.strategyId,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      exitPrice: p.exitPrice,
      realizedPnl: p.realizedPnl,
      comment: p.comment ?? undefined,
    });
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}

function parseExportToOpen(data: ExportData): Position[] {
  const open: Position[] = [];
  for (const p of data.positions) {
    if (p.closedAt != null) continue;
    open.push({
      id: String(p.id ?? ""),
      coin: p.coin,
      side: p.side as "long" | "short",
      entryPrice: p.entryPrice,
      size: p.size,
      strategyId: p.strategyId,
      openedAt: p.openedAt,
      comment: p.comment ?? undefined,
    });
  }
  return open.sort((a, b) => b.openedAt - a.openedAt);
}

interface LoadedLogViewProps {
  data: ExportData;
  onClose: () => void;
}

export function LoadedLogView({ data, onClose }: LoadedLogViewProps) {
  const closed = useMemo(() => parseExportToClosed(data), [data]);
  const open = useMemo(() => parseExportToOpen(data), [data]);
  const byStrategy = useMemo(() => aggregatePnlByStrategy(closed), [closed]);
  const byAsset = useMemo(() => aggregatePnlByAsset(closed), [closed]);
  const totalPnl = closed.reduce((sum, p) => sum + p.realizedPnl, 0);

  return (
    <div style={{ width: "100%", minWidth: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          padding: "1rem",
          background: "#1e293b",
          borderRadius: "8px",
          border: "1px solid #334155",
        }}
      >
        <div>
          <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.25rem" }}>
            Loaded log (read-only)
          </div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#e2e8f0" }}>
            {data.user.name}
          </div>
          <div style={{ fontSize: "0.9rem", color: "#94a3b8", marginTop: "0.25rem" }}>
            {open.length} open · {closed.length} closed
            {data.exportedAt ? (
              <> · Exported {new Date(data.exportedAt).toLocaleString()} · </>
            ) : null}
            Realized P&L:{" "}
            <span style={{ color: totalPnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
              {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} USDC
            </span>
          </div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {open.length > 0 && (
        <section>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
            Open Positions
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#1e293b", borderRadius: "8px", overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                <th style={thStyle}>Coin</th>
                <th style={thStyle}>Side</th>
                <th style={thStyle}>Strategy</th>
                <th style={thStyle}>Entry</th>
                <th style={thStyle}>Size</th>
                <th style={thStyle}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {open.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #334155" }}>
                  <td style={tdStyle}>
                    <a href={hyperliquidTradeUrl(p.coin)} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>
                      {p.coin}
                    </a>
                  </td>
                  <td style={tdStyle}>{p.side}</td>
                  <td style={tdStyle}>{getStrategy(p.strategyId)?.name ?? p.strategyId}</td>
                  <td style={tdStyle}>{p.entryPrice.toLocaleString()}</td>
                  <td style={tdStyle}>{p.size}</td>
                  <td style={{ ...tdStyle, fontSize: "0.85rem", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.comment || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section style={{ width: "100%", minWidth: 0 }}>
        <PnLChart closed={closed} />
      </section>

      <section>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
          P&L by Strategy
        </h2>
        {byStrategy.length === 0 ? (
          <div style={{ padding: "1rem", background: "#1e293b", borderRadius: "8px", color: "#64748b", fontSize: "0.9rem" }}>
            No closed trades in this log.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#1e293b", borderRadius: "8px", overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                <th style={thStyle}>Strategy</th>
                <th style={thStyle}>Trades</th>
                <th style={thStyle}>Total P&L</th>
              </tr>
            </thead>
            <tbody>
              {byStrategy.map((row) => (
                <tr key={row.strategyId} style={{ borderTop: "1px solid #334155" }}>
                  <td style={tdStyle}>{row.name}</td>
                  <td style={tdStyle}>{row.trades}</td>
                  <td style={{ ...tdStyle, color: row.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                    {row.pnl >= 0 ? "+" : ""}{row.pnl.toFixed(2)} USDC
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
          P&L by Asset
        </h2>
        {byAsset.length === 0 ? (
          <div style={{ padding: "1rem", background: "#1e293b", borderRadius: "8px", color: "#64748b", fontSize: "0.9rem" }}>
            No closed trades in this log.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#1e293b", borderRadius: "8px", overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                <th style={thStyle}>Asset</th>
                <th style={thStyle}>Trades</th>
                <th style={thStyle}>Total P&L</th>
              </tr>
            </thead>
            <tbody>
              {byAsset.map((row) => (
                <tr key={row.asset} style={{ borderTop: "1px solid #334155" }}>
                  <td style={tdStyle}>
                    <a href={hyperliquidTradeUrl(row.asset)} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>
                      {row.asset}
                    </a>
                  </td>
                  <td style={tdStyle}>{row.trades}</td>
                  <td style={{ ...tdStyle, color: row.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                    {row.pnl >= 0 ? "+" : ""}{row.pnl.toFixed(2)} USDC
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
          Trade History
        </h2>
        {closed.length === 0 ? (
          <div style={{ padding: "1rem", background: "#1e293b", borderRadius: "8px", color: "#64748b", fontSize: "0.9rem" }}>
            No closed trades in this log.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#1e293b", borderRadius: "8px", overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                <th style={thStyle}>Coin</th>
                <th style={thStyle}>Side</th>
                <th style={thStyle}>Strategy</th>
                <th style={thStyle}>Entry → Exit</th>
                <th style={thStyle}>P&L</th>
                <th style={thStyle}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {[...closed].reverse().map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #334155" }}>
                  <td style={tdStyle}>
                    <a href={hyperliquidTradeUrl(p.coin)} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>
                      {p.coin}
                    </a>
                  </td>
                  <td style={tdStyle}>{p.side}</td>
                  <td style={tdStyle}>{getStrategy(p.strategyId)?.name ?? p.strategyId}</td>
                  <td style={tdStyle}>
                    {p.entryPrice.toLocaleString()} → {p.exitPrice.toLocaleString()}
                  </td>
                  <td style={{ ...tdStyle, color: p.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {p.realizedPnl >= 0 ? "+" : ""}{p.realizedPnl.toFixed(2)}
                  </td>
                  <td style={{ ...tdStyle, fontSize: "0.85rem", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.comment || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.75rem",
  textAlign: "left",
  fontWeight: 600,
  color: "#94a3b8",
};

const tdStyle: React.CSSProperties = {
  padding: "0.75rem",
  color: "#e2e8f0",
};
