/**
 * TradesPage — main erde dashboard page.
 * Shows all agent trades with filtering, a candlestick position chart, and pagination.
 */

import { useState, useEffect, useCallback } from "react";
import { apiV2Trades, type V2TradeRow, type V2FilterParams } from "../../lib/api";
import { downloadTradesCsv, type ExportFilters } from "../../lib/export";
import { FilterBar } from "../FilterBar";
import { PositionChart } from "../PositionChart";

const CELL: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.82rem",
  color: "#cbd5e1",
  borderBottom: "1px solid #1e293b",
  whiteSpace: "nowrap",
};

const HEAD: React.CSSProperties = {
  ...CELL,
  color: "#64748b",
  fontWeight: 600,
  fontSize: "0.75rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  background: "#0f172a",
  position: "sticky" as const,
  top: 0,
  zIndex: 1,
};

function pnlColor(pnl: number | null | undefined) {
  if (pnl == null) return "#64748b";
  return pnl > 0 ? "#22c55e" : pnl < 0 ? "#ef4444" : "#64748b";
}

function ModeBadge({ mode }: { mode: string }) {
  const isLive = mode === "live";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: "10px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: isLive ? "#15803d22" : "#33415522",
        color: isLive ? "#4ade80" : "#94a3b8",
        border: `1px solid ${isLive ? "#15803d55" : "#33415555"}`,
      }}
    >
      {isLive ? "LIVE" : "SIM"}
    </span>
  );
}

function SideBadge({ side }: { side: string }) {
  const isLong = side === "long";
  return (
    <span style={{ color: isLong ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
      {side.toUpperCase()}
    </span>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDuration(openedAt: number, closedAt: number | null): string {
  if (!closedAt) return "open";
  const h = (closedAt - openedAt) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function formatPrice(p: number | null | undefined): string {
  if (p == null) return "—";
  if (p > 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p > 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function TradesPage() {
  const [filters, setFilters] = useState<V2FilterParams>({ limit: 50, page: 1 });
  const [trades, setTrades] = useState<V2TradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<V2TradeRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetch = useCallback(async (f: V2FilterParams) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiV2Trades(f);
      setTrades(res.trades);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch(filters);
  }, [filters, fetch]);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadTradesCsv(filters as ExportFilters);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / (filters.limit ?? 50));
  const page = filters.page ?? 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", height: "100%" }}>
      {/* Filter bar */}
      <FilterBar filters={filters} onChange={setFilters} />

      {error && (
        <div style={{ background: "#7f1d1d22", border: "1px solid #7f1d1d55", color: "#fca5a5", padding: "0.5rem 1rem", borderRadius: "6px", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}

      {/* Chart + Detail panel */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1rem", height: "280px" }}>
        <div style={{ background: "#0f172a", borderRadius: "8px", overflow: "hidden", border: "1px solid #1e293b" }}>
          <PositionChart trade={selectedTrade} />
        </div>

        {/* Detail panel */}
        <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", padding: "1rem", overflow: "auto" }}>
          {selectedTrade ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f1f5f9" }}>{selectedTrade.coin}</span>
                <SideBadge side={selectedTrade.side} />
                <ModeBadge mode={selectedTrade.session_mode ?? "live"} />
              </div>

              {[
                ["Agent", selectedTrade.agent?.slice(-30) ?? "—"],
                ["Operator", selectedTrade.operator ?? "—"],
                ["Rule", selectedTrade.strategy_reason ?? "—"],
                ["Entry", formatPrice(selectedTrade.entry_price)],
                ["Exit", formatPrice(selectedTrade.exit_price)],
                ["Size", `${selectedTrade.size}${selectedTrade.leverage ? ` @ ${selectedTrade.leverage}x` : ""}`],
                ["Duration", formatDuration(selectedTrade.opened_at, selectedTrade.closed_at)],
                ["Opened", `${formatDate(selectedTrade.opened_at)} ${formatTime(selectedTrade.opened_at)}`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{label}</span>
                  <span style={{ color: "#e2e8f0", fontSize: "0.82rem", textAlign: "right" }}>{value}</span>
                </div>
              ))}

              {/* PnL highlighted */}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1e293b", paddingTop: "0.5rem" }}>
                <span style={{ color: "#64748b", fontSize: "0.8rem" }}>P&L</span>
                <span style={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  color: pnlColor(selectedTrade.realized_pnl),
                }}>
                  {selectedTrade.realized_pnl != null
                    ? `${selectedTrade.realized_pnl >= 0 ? "+" : ""}$${selectedTrade.realized_pnl.toFixed(2)}`
                    : "open"}
                </span>
              </div>

              {selectedTrade.comment && (
                <div style={{ marginTop: "0.25rem", padding: "0.5rem", background: "#1e293b", borderRadius: "4px", fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.4 }}>
                  {selectedTrade.comment}
                </div>
              )}
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: "0.85rem" }}>
              Select a row
            </div>
          )}
        </div>
      </div>

      {/* Trades table */}
      <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", overflow: "hidden" }}>
        {/* Table header with count + export */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", borderBottom: "1px solid #1e293b" }}>
          <span style={{ color: "#64748b", fontSize: "0.82rem" }}>
            {loading ? "Loading…" : `${total.toLocaleString()} trade${total !== 1 ? "s" : ""}`}
          </span>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              color: "#93c5fd",
              padding: "0.25rem 0.75rem",
              borderRadius: "6px",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Agent", "Operator", "Coin", "Side", "Rule", "Entry", "Exit", "Size", "P&L", "Duration", "Mode"].map((h) => (
                  <th key={h} style={HEAD}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const isSelected = selectedTrade?.id === t.id;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTrade(t)}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "#1e40af22" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#1e293b"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <td style={CELL}>
                      <div>{formatDate(t.opened_at)}</div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>{formatTime(t.opened_at)}</div>
                    </td>
                    <td style={{ ...CELL, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span title={t.agent}>{t.agent?.slice(-25) ?? "—"}</span>
                    </td>
                    <td style={CELL}>{t.operator ?? <span style={{ color: "#334155" }}>—</span>}</td>
                    <td style={{ ...CELL, fontWeight: 600 }}>{t.coin}</td>
                    <td style={CELL}><SideBadge side={t.side} /></td>
                    <td style={{ ...CELL, maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span title={t.strategy_reason ?? ""}>{t.strategy_reason ?? "—"}</span>
                    </td>
                    <td style={CELL}>{formatPrice(t.entry_price)}</td>
                    <td style={CELL}>{formatPrice(t.exit_price)}</td>
                    <td style={CELL}>{t.size}{t.leverage ? <span style={{ color: "#64748b" }}> ×{t.leverage}</span> : null}</td>
                    <td style={{ ...CELL, color: pnlColor(t.realized_pnl), fontWeight: 600 }}>
                      {t.realized_pnl != null
                        ? `${t.realized_pnl >= 0 ? "+" : ""}$${t.realized_pnl.toFixed(2)}`
                        : <span style={{ color: "#334155" }}>—</span>}
                    </td>
                    <td style={CELL}>{formatDuration(t.opened_at, t.closed_at)}</td>
                    <td style={CELL}><ModeBadge mode={t.session_mode ?? "live"} /></td>
                  </tr>
                );
              })}
              {!loading && trades.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>
                    No trades found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", padding: "0.75rem", borderTop: "1px solid #1e293b" }}>
            <button
              disabled={page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              style={{ background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", padding: "0.25rem 0.75rem", borderRadius: "6px", cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}
            >
              ‹ Prev
            </button>
            <span style={{ color: "#64748b", fontSize: "0.82rem" }}>Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              style={{ background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0", padding: "0.25rem 0.75rem", borderRadius: "6px", cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.4 : 1 }}
            >
              Next ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
