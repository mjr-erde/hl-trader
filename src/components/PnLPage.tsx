/**
 * P&L section — cumulative P&L over time chart + P&L by strategy table.
 * Navigable via the section dropdown in the header.
 */

import { Fragment, useMemo, useState, useEffect, useCallback } from "react";
import { useUser } from "../context/UserContext";
import { apiGetClosedPositions, apiHlTrades, apiGetSessions, type HlTrade, type SessionRow } from "../lib/api";
import type { ClosedPosition } from "../lib/positionsStore";
import { aggregatePnlByStrategy, aggregatePnlByAsset } from "../lib/pnlByStrategy";
import { hyperliquidTradeUrl } from "../lib/hyperliquid";
import { PnLChart } from "./PnLChart";

function sessionStats(trades: HlTrade[] | undefined) {
  if (!trades) return { count: "—", winRate: "—", pnl: null as number | null };
  const closed = trades.filter((t) => t.closed_at != null);
  const wins = closed.filter((t) => (t.realized_pnl ?? 0) > 0);
  const pnl = closed.reduce((sum, t) => sum + (t.realized_pnl ?? 0), 0);
  const winRate = closed.length > 0 ? `${Math.round((wins.length / closed.length) * 100)}%` : "—";
  return { count: closed.length, winRate, pnl: closed.length > 0 ? pnl : null };
}

export function PnLPage() {
  const { user } = useUser();
  const [tab, setTab] = useState<"paper" | "live">("paper");

  // Paper trading state
  const [closed, setClosed] = useState<ClosedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live sessions state
  const [liveSessions, setLiveSessions] = useState<SessionRow[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tradesBySession, setTradesBySession] = useState<Map<string, HlTrade[]>>(new Map());
  const [sessionLoading, setSessionLoading] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!user) {
      setClosed([]);
      setLoading(false);
      return;
    }
    try {
      const list = await apiGetClosedPositions(user.id);
      setClosed(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [user, refresh]);

  useEffect(() => {
    if (tab !== "live") return;
    setLiveLoading(true);
    apiGetSessions(200)
      .then((sessions: SessionRow[]) => setLiveSessions(sessions))
      .catch(() => setLiveSessions([]))
      .finally(() => setLiveLoading(false));
  }, [tab]);

  function toggleSession(username: string) {
    const next = new Set(expanded);
    if (next.has(username)) {
      next.delete(username);
      setExpanded(next);
      return;
    }
    next.add(username);
    setExpanded(next);

    if (!tradesBySession.has(username)) {
      setSessionLoading((prev) => new Set(prev).add(username));
      apiHlTrades(username)
        .then((trades) => {
          setTradesBySession((prev) => new Map(prev).set(username, trades));
        })
        .catch(() => {
          setTradesBySession((prev) => new Map(prev).set(username, []));
        })
        .finally(() => {
          setSessionLoading((prev) => {
            const s = new Set(prev);
            s.delete(username);
            return s;
          });
        });
    }
  }

  const byStrategy = useMemo(() => aggregatePnlByStrategy(closed), [closed]);
  const byAsset = useMemo(() => aggregatePnlByAsset(closed), [closed]);

  if (!user && tab === "paper") {
    return (
      <p style={{ color: "#fbbf24", fontSize: "0.9rem" }}>
        Select or create a user to view P&L.
      </p>
    );
  }

  return (
    <div style={{ width: "100%", minWidth: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {(["paper", "live"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "6px",
              border: "1px solid",
              borderColor: tab === t ? "#3b82f6" : "#334155",
              background: tab === t ? "#1e40af" : "#1e293b",
              color: tab === t ? "#fff" : "#94a3b8",
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            {t === "paper" ? "Paper Trading" : "Live Sessions"}
          </button>
        ))}
      </div>

      {tab === "paper" && (
        <>
          {!user ? (
            <p style={{ color: "#fbbf24", fontSize: "0.9rem" }}>
              Select or create a user to view P&L.
            </p>
          ) : loading ? (
            <p style={{ color: "#94a3b8" }}>Loading closed positions…</p>
          ) : error ? (
            <div
              style={{
                padding: "1rem",
                background: "#7f1d1d",
                borderRadius: "8px",
                color: "#fecaca",
                fontSize: "0.95rem",
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          ) : (
            <>
              <section style={{ width: "100%", minWidth: 0 }}>
                <PnLChart closed={closed} />
              </section>

              <section>
                <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
                  P&L by Strategy
                </h2>
                {byStrategy.length === 0 ? (
                  <div style={{ padding: "1rem", background: "#1e293b", borderRadius: "8px", color: "#64748b", fontSize: "0.9rem" }}>
                    No closed trades yet — close a position to see P&L by strategy.
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
                    No closed trades yet — close a position to see P&L by asset.
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
                            <a
                              href={hyperliquidTradeUrl(row.asset)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#3b82f6", textDecoration: "none" }}
                            >
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
            </>
          )}
        </>
      )}

      {tab === "live" && (
        <section>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
            Live Agent Sessions
          </h2>
          {liveLoading ? (
            <p style={{ color: "#94a3b8" }}>Loading sessions…</p>
          ) : liveSessions.length === 0 ? (
            <div style={{ padding: "1rem", background: "#1e293b", borderRadius: "8px", color: "#64748b", fontSize: "0.9rem" }}>
              No agent sessions recorded yet. Start the trading agent to begin logging.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#1e293b", borderRadius: "8px", overflow: "hidden" }}>
              <thead>
                <tr style={{ background: "#0f172a" }}>
                  <th style={thStyle}>Session</th>
                  <th style={{ ...thStyle, width: 60 }}>Mode</th>
                  <th style={thStyle}>Trades</th>
                  <th style={thStyle}>Win Rate</th>
                  <th style={thStyle}>P&L</th>
                  <th style={{ ...thStyle, width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {liveSessions.map((session) => {
                  const username = session.id;
                  const trades = tradesBySession.get(username);
                  const isExpanded = expanded.has(username);
                  const isLoading = sessionLoading.has(username);
                  const stats = sessionStats(trades);
                  const mode = session.mode;
                  return (
                    <Fragment key={username}>
                      <tr
                        onClick={() => toggleSession(username)}
                        style={{ borderTop: "1px solid #334155", cursor: "pointer" }}
                      >
                        <td style={{ ...tdStyle, maxWidth: 280 }}>
                          <div style={{ fontFamily: "monospace", fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {username}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.1rem" }}>
                            {new Date(session.started_at).toLocaleString()}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          {mode ? (
                            <span style={{
                              display: "inline-block",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "4px",
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              letterSpacing: "0.05em",
                              background: mode === "live" ? "#15803d" : "#334155",
                              color: mode === "live" ? "#bbf7d0" : "#94a3b8",
                            }}>
                              {mode === "live" ? "LIVE" : "SIM"}
                            </span>
                          ) : null}
                        </td>
                        <td style={tdStyle}>{isLoading ? "…" : stats.count}</td>
                        <td style={tdStyle}>{isLoading ? "…" : stats.winRate}</td>
                        <td style={tdStyle}>
                          {isLoading ? "…" : stats.pnl != null ? (
                            <span style={{ color: stats.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                              {stats.pnl >= 0 ? "+" : ""}{stats.pnl.toFixed(2)}
                            </span>
                          ) : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                          {isExpanded ? "▼" : "▶"}
                        </td>
                      </tr>
                      {isExpanded && (
                        isLoading ? (
                          <tr key={`${username}-loading`} style={{ background: "#0f172a" }}>
                            <td colSpan={6} style={{ ...tdStyle, color: "#64748b", fontSize: "0.85rem", paddingLeft: "2rem" }}>
                              Loading trades…
                            </td>
                          </tr>
                        ) : trades && trades.length === 0 ? (
                          <tr key={`${username}-empty`} style={{ background: "#0f172a" }}>
                            <td colSpan={6} style={{ ...tdStyle, color: "#64748b", fontSize: "0.85rem", paddingLeft: "2rem" }}>
                              No trades recorded for this session.
                            </td>
                          </tr>
                        ) : (
                          <>
                            <tr key={`${username}-header`} style={{ background: "#0a1220" }}>
                              <th style={{ ...thStyle, fontSize: "0.78rem", paddingLeft: "2rem" }}>Coin</th>
                              <th style={{ ...thStyle, fontSize: "0.78rem" }}>Side</th>
                              <th style={{ ...thStyle, fontSize: "0.78rem" }}>Strategy</th>
                              <th style={{ ...thStyle, fontSize: "0.78rem" }}>Entry → Exit</th>
                              <th style={{ ...thStyle, fontSize: "0.78rem" }}>P&L</th>
                            </tr>
                            {(trades ?? []).map((t) => (
                              <tr key={t.id} style={{ background: "#0f172a", borderTop: "1px solid #1e293b" }}>
                                <td style={{ ...tdStyle, paddingLeft: "2rem", fontWeight: 500 }}>
                                  <a
                                    href={hyperliquidTradeUrl(t.coin)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "#3b82f6", textDecoration: "none" }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {t.coin}
                                  </a>
                                </td>
                                <td style={tdStyle}>{t.side}</td>
                                <td style={{ ...tdStyle, maxWidth: 180 }}>
                                  <div title={t.strategy_reason ?? undefined} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                                    {t.strategy_reason?.trim() || "—"}
                                  </div>
                                  {t.comment && (
                                    <div title={t.comment} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.78rem", color: "#64748b", marginTop: "0.15rem" }}>
                                      {t.comment}
                                    </div>
                                  )}
                                </td>
                                <td style={{ ...tdStyle, fontSize: "0.85rem" }}>
                                  {t.entry_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                  {t.exit_price != null ? ` → ${t.exit_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : " → open"}
                                </td>
                                <td style={tdStyle}>
                                  {t.realized_pnl != null ? (
                                    <span style={{ color: t.realized_pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                                      {t.realized_pnl >= 0 ? "+" : ""}{t.realized_pnl.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span style={{ color: "#64748b" }}>open</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </>
                        )
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
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
