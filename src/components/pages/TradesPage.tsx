/**
 * TradesPage — main erde dashboard page.
 * Shows all agent trades with filtering, a candlestick position chart, and pagination.
 * Columns are sortable. Rows are expandable to show indicators + ML/sentiment detail.
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
  cursor: "pointer",
  userSelect: "none" as const,
};

const HEAD_NOSORT: React.CSSProperties = {
  ...HEAD,
  cursor: "default",
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

// ── Indicator expand panel ─────────────────────────────────────────────────────

function IndicatorGrid({ indicators }: { indicators: Record<string, unknown> }) {
  const LABEL_MAP: Record<string, string> = {
    adx: "ADX", plus_di: "+DI", minus_di: "-DI", di_spread: "DI Spread",
    rsi: "RSI", macd_histogram: "MACD Hist", macd_line: "MACD Line",
    bb_width: "BB Width", bb_position: "BB Pos", atr_pct: "ATR %",
    atr_percentile: "ATR %ile", galaxy_score: "Galaxy", sentiment_pct: "Sentiment",
    alt_rank_norm: "Alt Rank", funding_rate: "Funding", fear_greed: "Fear/Greed",
    has_sentiment: "Has Sentiment", regime_encoded: "Regime (enc)",
  };

  const entries = Object.entries(indicators)
    .filter(([k]) => LABEL_MAP[k])
    .map(([k, v]) => ({ label: LABEL_MAP[k], value: v }));

  if (entries.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "0.4rem" }}>
      {entries.map(({ label, value }) => (
        <div key={label} style={{ background: "#0f172a", borderRadius: "4px", padding: "0.3rem 0.5rem" }}>
          <div style={{ fontSize: "0.68rem", color: "#475569", marginBottom: "1px" }}>{label}</div>
          <div style={{ fontSize: "0.8rem", color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>
            {typeof value === "number" ? value.toFixed(value > 10 ? 1 : 3) : String(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpandedRow({ trade, colSpan }: { trade: V2TradeRow; colSpan: number }) {
  let indicators: Record<string, unknown> = {};
  if (trade.indicators_json) {
    try { indicators = JSON.parse(trade.indicators_json); } catch { /* ignore */ }
  }

  const mlScore = indicators.ml_score as number | undefined;
  const blendedConf = indicators.blended_conf as number | undefined;
  const regime = indicators.regime as string | undefined;

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "0 0.75rem 0.75rem 2.5rem", background: "#0a1628", borderBottom: "2px solid #1e293b" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", paddingTop: "0.6rem" }}>

          {/* Strategy reasoning */}
          {trade.strategy_reason && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
              <span style={{ fontSize: "0.72rem", color: "#475569", minWidth: "60px", paddingTop: "1px" }}>RULE</span>
              <span style={{ fontSize: "0.82rem", color: "#93c5fd", fontWeight: 600 }}>{trade.strategy_reason}</span>
            </div>
          )}

          {/* Regime / ML / Sentiment row */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {regime && (
              <div style={{ background: "#1e293b", borderRadius: "4px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
                <span style={{ color: "#475569" }}>Regime </span>
                <span style={{ color: "#e2e8f0" }}>{regime}</span>
              </div>
            )}
            {mlScore != null && (
              <div style={{ background: "#1e293b", borderRadius: "4px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
                <span style={{ color: "#475569" }}>ML score </span>
                <span style={{ color: mlScore >= 0.5 ? "#4ade80" : "#f87171" }}>{mlScore.toFixed(3)}</span>
              </div>
            )}
            {blendedConf != null && (
              <div style={{ background: "#1e293b", borderRadius: "4px", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
                <span style={{ color: "#475569" }}>Blended conf </span>
                <span style={{ color: "#e2e8f0" }}>{blendedConf.toFixed(3)}</span>
              </div>
            )}
          </div>

          {/* Indicator grid */}
          {Object.keys(indicators).length > 0 && <IndicatorGrid indicators={indicators} />}

          {/* Full comment */}
          {trade.comment && (
            <div style={{ background: "#1e293b", borderRadius: "4px", padding: "0.5rem 0.75rem", fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.5 }}>
              {trade.comment}
            </div>
          )}

          {!trade.comment && Object.keys(indicators).length === 0 && (
            <div style={{ fontSize: "0.78rem", color: "#334155" }}>No detail available for this trade.</div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Column definitions ─────────────────────────────────────────────────────────

interface ColDef {
  label: string;
  sortKey?: string;
}

const COLUMNS: ColDef[] = [
  { label: "▸",         sortKey: undefined },   // expand toggle — no sort
  { label: "Date",      sortKey: "opened_at" },
  { label: "Agent",     sortKey: "agent" },
  { label: "Operator",  sortKey: undefined },
  { label: "Coin",      sortKey: "coin" },
  { label: "Side",      sortKey: "side" },
  { label: "Rule",      sortKey: "strategy_reason" },
  { label: "Entry",     sortKey: "entry_price" },
  { label: "Exit",      sortKey: "exit_price" },
  { label: "Size",      sortKey: undefined },
  { label: "P&L",       sortKey: "realized_pnl" },
  { label: "Duration",  sortKey: "duration" },
  { label: "Mode",      sortKey: undefined },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function TradesPage() {
  const [filters, setFilters] = useState<V2FilterParams>({ limit: 50, page: 1, sortBy: "opened_at", sortDir: "desc" });
  const [trades, setTrades] = useState<V2TradeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<V2TradeRow | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  function handleSort(sortKey: string) {
    const isSame = filters.sortBy === sortKey;
    const sortDir = isSame && filters.sortDir === "desc" ? "asc" : "desc";
    setFilters((f) => ({ ...f, sortBy: sortKey, sortDir, page: 1 }));
  }

  function handleRowClick(t: V2TradeRow) {
    setSelectedTrade(t);
  }

  function handleExpandClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const totalPages = Math.ceil(total / (filters.limit ?? 50));
  const page = filters.page ?? 1;

  function SortArrow({ col }: { col: ColDef }) {
    if (!col.sortKey) return null;
    const active = filters.sortBy === col.sortKey;
    return (
      <span style={{ marginLeft: "3px", color: active ? "#60a5fa" : "#334155" }}>
        {active ? (filters.sortDir === "asc" ? "▲" : "▼") : "▼"}
      </span>
    );
  }

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

              {/* Expand hint */}
              <div style={{ fontSize: "0.72rem", color: "#334155", marginTop: "0.25rem" }}>
                Click ▸ in the row to see full indicator detail
              </div>
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
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    style={col.sortKey ? HEAD : HEAD_NOSORT}
                    onClick={col.sortKey ? () => handleSort(col.sortKey!) : undefined}
                  >
                    {col.label === "▸" ? "" : col.label}
                    {col.sortKey && <SortArrow col={col} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const isSelected = selectedTrade?.id === t.id;
                const isExpanded = expandedId === t.id;
                return (
                  <>
                    <tr
                      key={t.id}
                      onClick={() => handleRowClick(t)}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "#1e40af22" : "transparent",
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#1e293b"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Expand toggle */}
                      <td
                        style={{ ...CELL, width: "24px", padding: "0.5rem 0.25rem 0.5rem 0.75rem", color: "#475569" }}
                        onClick={(e) => handleExpandClick(e, t.id)}
                      >
                        <span style={{ fontSize: "0.75rem", transition: "transform 0.15s", display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "none" }}>▸</span>
                      </td>
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
                    {isExpanded && <ExpandedRow key={`exp-${t.id}`} trade={t} colSpan={COLUMNS.length} />}
                  </>
                );
              })}
              {!loading && trades.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>
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
