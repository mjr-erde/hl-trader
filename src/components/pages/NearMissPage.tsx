/**
 * NearMissPage — analysis of blocked entry signals.
 * Shows stats, per-rule/coin breakdowns, recommendations, and recent near-miss table.
 */

import { useState, useEffect } from "react";
import {
  apiV2NearMissAnalysis,
  apiV2NearMisses,
  type V2NearMissAnalysis,
  type V2NearMiss,
} from "../../lib/api";

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
  fontSize: "0.72rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  background: "#0f172a",
};

function pnlColor(v: number | null) {
  if (v == null) return "#64748b";
  return v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#64748b";
}

function winRateColor(wr: number) {
  if (wr >= 0.65) return "#22c55e";
  if (wr >= 0.5) return "#facc15";
  return "#f87171";
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "#0f172a",
      border: "1px solid #1e293b",
      borderRadius: "8px",
      padding: "1rem 1.25rem",
      minWidth: "140px",
    }}>
      <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 700, color: color ?? "#f1f5f9" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: "0.15rem" }}>{sub}</div>}
    </div>
  );
}

function formatDate(ms: number) {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function NearMissPage() {
  const [analysis, setAnalysis] = useState<V2NearMissAnalysis | null>(null);
  const [recent, setRecent] = useState<V2NearMiss[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"rule" | "coin" | "recent">("rule");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiV2NearMissAnalysis(),
      apiV2NearMisses({ limit: 50 }),
    ])
      .then(([a, r]) => {
        setAnalysis(a);
        setRecent(r.near_misses);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "2rem", color: "#64748b", textAlign: "center" }}>
        Loading near-miss data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: "#7f1d1d22", border: "1px solid #7f1d1d55", color: "#fca5a5", padding: "0.75rem 1rem", borderRadius: "6px" }}>
        {error}
      </div>
    );
  }

  const a = analysis!;

  // Summary stats
  const totalChecked = a.byRule.reduce((s, r) => s + r.checked_count, 0);
  const totalWon = a.byRule.reduce((s, r) => s + r.won_count, 0);
  const overallWinRate = totalChecked > 0 ? totalWon / totalChecked : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#f1f5f9" }}>Near Miss Analysis</h2>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "#64748b" }}>
          Blocked entry signals — trades the agent considered but didn't take. Use this to improve strategy thresholds.
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <StatCard label="Total Near Misses" value={a.total.toLocaleString()} />
        {totalChecked > 0 && (
          <>
            <StatCard
              label="Estimated Win Rate"
              value={`${(overallWinRate! * 100).toFixed(0)}%`}
              sub={`${totalChecked} outcomes checked`}
              color={winRateColor(overallWinRate!)}
            />
            <StatCard
              label="Would-Have-Won"
              value={totalWon}
              sub={`of ${totalChecked} checked`}
              color="#22c55e"
            />
          </>
        )}
        <StatCard
          label="Rules Affected"
          value={a.byRule.length}
          sub="distinct strategies"
        />
        <StatCard
          label="Coins Affected"
          value={a.byCoin.length}
          sub="distinct coins"
        />
      </div>

      {/* Recommendations */}
      {a.recommendations.length > 0 && (
        <div style={{
          background: "#0f172a",
          border: "1px solid #1e3a5f",
          borderRadius: "8px",
          padding: "1rem",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#60a5fa", marginBottom: "0.6rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Recommendations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {a.recommendations.map((rec, i) => (
              <div key={i} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                <span style={{ color: "#60a5fa", marginTop: "1px", flexShrink: 0 }}>→</span>
                <span style={{ fontSize: "0.83rem", color: "#cbd5e1", lineHeight: 1.5 }}>{rec}</span>
              </div>
            ))}
          </div>
          {totalChecked > 0 && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#1e293b", borderRadius: "4px", fontSize: "0.75rem", color: "#475569" }}>
              Copy these recommendations and paste them into the agent configuration session or CLAUDE.md to update the strategy. The agent can apply threshold adjustments directly.
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b" }}>
          {(["rule", "coin", "recent"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "0.6rem",
                border: "none",
                background: activeTab === tab ? "#1e293b" : "transparent",
                color: activeTab === tab ? "#f1f5f9" : "#64748b",
                fontSize: "0.82rem",
                fontWeight: activeTab === tab ? 600 : 400,
                cursor: "pointer",
                textTransform: "capitalize",
                borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
              }}
            >
              {tab === "rule" ? "By Rule" : tab === "coin" ? "By Coin" : "Recent"}
            </button>
          ))}
        </div>

        {/* By Rule tab */}
        {activeTab === "rule" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Rule", "Near Misses", "Checked", "Win Rate", "Avg PnL %", "Avg Conf", "Avg ML Score"].map((h) => (
                    <th key={h} style={HEAD}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.byRule.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>No data yet</td></tr>
                ) : a.byRule.map((r) => {
                  const wr = r.checked_count > 0 ? r.won_count / r.checked_count : null;
                  return (
                    <tr key={r.rule}>
                      <td style={{ ...CELL, fontWeight: 600, color: "#93c5fd" }}>{r.rule}</td>
                      <td style={CELL}>{r.count}</td>
                      <td style={{ ...CELL, color: "#64748b" }}>{r.checked_count}</td>
                      <td style={{ ...CELL, fontWeight: 600, color: wr != null ? winRateColor(wr) : "#64748b" }}>
                        {wr != null ? `${(wr * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td style={{ ...CELL, color: pnlColor(r.avg_pnl_pct) }}>
                        {r.avg_pnl_pct != null ? `${r.avg_pnl_pct >= 0 ? "+" : ""}${r.avg_pnl_pct.toFixed(2)}%` : "—"}
                      </td>
                      <td style={CELL}>{r.avg_confidence?.toFixed(3) ?? "—"}</td>
                      <td style={{ ...CELL, color: r.avg_ml_score != null ? (r.avg_ml_score >= 0.5 ? "#22c55e" : "#f87171") : "#64748b" }}>
                        {r.avg_ml_score?.toFixed(3) ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* By Coin tab */}
        {activeTab === "coin" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Coin", "Near Misses", "Checked", "Win Rate", "Avg PnL %"].map((h) => (
                    <th key={h} style={HEAD}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.byCoin.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>No data yet</td></tr>
                ) : a.byCoin.map((c) => {
                  const wr = c.checked_count > 0 ? c.won_count / c.checked_count : null;
                  return (
                    <tr key={c.coin}>
                      <td style={{ ...CELL, fontWeight: 600 }}>{c.coin}</td>
                      <td style={CELL}>{c.count}</td>
                      <td style={{ ...CELL, color: "#64748b" }}>{c.checked_count}</td>
                      <td style={{ ...CELL, fontWeight: 600, color: wr != null ? winRateColor(wr) : "#64748b" }}>
                        {wr != null ? `${(wr * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td style={{ ...CELL, color: pnlColor(c.avg_pnl_pct) }}>
                        {c.avg_pnl_pct != null ? `${c.avg_pnl_pct >= 0 ? "+" : ""}${c.avg_pnl_pct.toFixed(2)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Recent near misses tab */}
        {activeTab === "recent" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date", "Agent", "Coin", "Side", "Rule", "Blocked By", "Conf", "ML Score", "Outcome"].map((h) => (
                    <th key={h} style={HEAD}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>No near-miss records yet</td></tr>
                ) : recent.map((nm) => (
                  <tr key={nm.id}>
                    <td style={CELL}>
                      <div>{formatDate(nm.created_at)}</div>
                      <div style={{ color: "#64748b", fontSize: "0.75rem" }}>{formatTime(nm.created_at)}</div>
                    </td>
                    <td style={{ ...CELL, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span title={nm.session_id}>{nm.session_id.slice(-25)}</span>
                    </td>
                    <td style={{ ...CELL, fontWeight: 600 }}>{nm.coin}</td>
                    <td style={CELL}>
                      <span style={{ color: nm.side === "long" ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                        {nm.side.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...CELL, color: "#93c5fd" }}>{nm.rule}</td>
                    <td style={{ ...CELL, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", color: "#94a3b8" }}>
                      <span title={nm.reason}>{nm.reason}</span>
                    </td>
                    <td style={{ ...CELL, color: nm.confidence != null && nm.confidence < 0.5 ? "#f87171" : "#94a3b8" }}>
                      {nm.confidence?.toFixed(3) ?? "—"}
                    </td>
                    <td style={{ ...CELL, color: nm.ml_score != null ? (nm.ml_score >= 0.5 ? "#4ade80" : "#f87171") : "#64748b" }}>
                      {nm.ml_score?.toFixed(3) ?? "—"}
                    </td>
                    <td style={CELL}>
                      {nm.outcome_won === 1 ? (
                        <span style={{ color: "#22c55e", fontWeight: 600 }}>
                          Win {nm.outcome_pnl_pct != null ? `+${nm.outcome_pnl_pct.toFixed(2)}%` : ""}
                        </span>
                      ) : nm.outcome_won === 0 ? (
                        <span style={{ color: "#ef4444", fontWeight: 600 }}>
                          Loss {nm.outcome_pnl_pct != null ? `${nm.outcome_pnl_pct.toFixed(2)}%` : ""}
                        </span>
                      ) : (
                        <span style={{ color: "#334155" }}>Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Block reason breakdown */}
      {a.byBlockReason.length > 0 && (
        <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", overflow: "hidden" }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #1e293b" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Block Reasons (top 10)
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Reason", "Count", "Checked", "Win Rate"].map((h) => (
                    <th key={h} style={HEAD}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.byBlockReason.map((r, i) => {
                  const wr = r.checked_count > 0 ? r.won_count / r.checked_count : null;
                  return (
                    <tr key={i}>
                      <td style={{ ...CELL, color: "#94a3b8", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.reason}
                      </td>
                      <td style={CELL}>{r.count}</td>
                      <td style={{ ...CELL, color: "#64748b" }}>{r.checked_count}</td>
                      <td style={{ ...CELL, fontWeight: 600, color: wr != null ? winRateColor(wr) : "#64748b" }}>
                        {wr != null ? `${(wr * 100).toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
