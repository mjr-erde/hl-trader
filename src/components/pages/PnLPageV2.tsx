/**
 * P&L Page v2 — aggregated profit/loss analytics.
 * Three tabs: By Session | By Agent | By Operator
 * Uses the v2 SQL-aggregated API endpoints.
 */

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  apiV2PnlBySession,
  apiV2PnlByOperator,
  apiV2PnlCumulative,
  type V2SessionPnL,
  type V2OperatorPnL,
  type V2CumulativePoint,
} from "../../lib/api";

type Tab = "session" | "agent" | "operator";

// ── Shared styles ──────────────────────────────────────────────────────────────

const CELL: React.CSSProperties = {
  padding: "0.55rem 0.75rem",
  fontSize: "0.82rem",
  color: "#cbd5e1",
  borderBottom: "1px solid #1e293b",
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

function pnlColor(v: number) {
  return v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#64748b";
}

function fmt(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}$${n.toFixed(digits)}`;
}

function winRate(wins: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((wins / total) * 100)}%`;
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function ModeBadge({ mode }: { mode: string }) {
  const isLive = mode === "live";
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: "10px", fontSize: "0.68rem", fontWeight: 600,
      background: isLive ? "#15803d22" : "#33415522",
      color: isLive ? "#4ade80" : "#94a3b8",
      border: `1px solid ${isLive ? "#15803d55" : "#33415555"}`,
    }}>
      {isLive ? "LIVE" : "SIM"}
    </span>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: "8px", padding: "0.75rem 1rem", minWidth: "130px" }}>
      <div style={{ color: "#64748b", fontSize: "0.72rem", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: color ?? "#f1f5f9" }}>{value}</div>
    </div>
  );
}

// ── Cumulative PnL chart ──────────────────────────────────────────────────────

function CumulativeChart({ data }: { data: V2CumulativePoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: "0.85rem" }}>
        No closed trades yet
      </div>
    );
  }
  const last = data[data.length - 1];
  const isPositive = (last?.cumulative ?? 0) >= 0;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
            <stop offset="95%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} />
        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "6px" }}
          labelStyle={{ color: "#94a3b8", fontSize: "0.8rem" }}
          formatter={(v: unknown) => [`$${Number(v).toFixed(2)}`, "Cumulative"]}
        />
        <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke={isPositive ? "#22c55e" : "#ef4444"}
          strokeWidth={2}
          fill="url(#pnlGrad)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── By Session tab ────────────────────────────────────────────────────────────

function BySessionTab() {
  const [sessions, setSessions] = useState<V2SessionPnL[]>([]);
  const [cumulative, setCumulative] = useState<V2CumulativePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiV2PnlBySession({ limit: 200 }),
      apiV2PnlCumulative(),
    ]).then(([s, c]) => {
      setSessions(s);
      setCumulative(c);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const totalPnl = sessions.reduce((s, r) => s + r.total_pnl, 0);
  const totalTrades = sessions.reduce((s, r) => s + r.closed_trades, 0);
  const totalWins = sessions.reduce((s, r) => s + r.wins, 0);
  const bestSession = sessions.reduce<V2SessionPnL | null>((best, s) => (!best || s.total_pnl > best.total_pnl) ? s : best, null);

  if (loading) return <div style={{ color: "#64748b", padding: "2rem", textAlign: "center" }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Stat cards */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <StatCard label="Total P&L" value={fmt(totalPnl)} color={pnlColor(totalPnl)} />
        <StatCard label="Win Rate" value={winRate(totalWins, totalTrades)} />
        <StatCard label="Total Trades" value={String(totalTrades)} />
        <StatCard label="Sessions" value={String(sessions.length)} />
        {bestSession && (
          <StatCard label="Best Session" value={fmt(bestSession.total_pnl)} color="#22c55e" />
        )}
      </div>

      {/* Cumulative chart */}
      <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", padding: "0.75rem 1rem" }}>
        <div style={{ color: "#64748b", fontSize: "0.72rem", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Cumulative P&L</div>
        <CumulativeChart data={cumulative} />
      </div>

      {/* Sessions table */}
      <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Session", "Operator", "Mode", "Started", "Trades", "Wins", "Losses", "Win %", "Total P&L"].map((h) => (
                  <th key={h} style={HEAD}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.session_id} style={{ cursor: "default" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ ...CELL, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span title={s.session_id}>{s.session_id.slice(-30)}</span>
                  </td>
                  <td style={CELL}>{s.operator ?? <span style={{ color: "#334155" }}>—</span>}</td>
                  <td style={CELL}><ModeBadge mode={s.mode} /></td>
                  <td style={CELL}>{fmtDate(s.started_at)}</td>
                  <td style={CELL}>{s.closed_trades}</td>
                  <td style={{ ...CELL, color: "#22c55e" }}>{s.wins}</td>
                  <td style={{ ...CELL, color: "#ef4444" }}>{s.losses}</td>
                  <td style={CELL}>{winRate(s.wins, s.closed_trades)}</td>
                  <td style={{ ...CELL, fontWeight: 700, color: pnlColor(s.total_pnl) }}>
                    {fmt(s.total_pnl)}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={9} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>No sessions yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── By Agent tab ──────────────────────────────────────────────────────────────

function extractAgentPrefix(sessionId: string): string {
  // claude-opus-4-6-20260219-1930 → claude-opus-4-6
  // erde-20260219-1930 → erde
  const match = sessionId.match(/^(.+?)-\d{8}-\d{4}$/);
  return match?.[1] ?? sessionId;
}

function ByAgentTab() {
  const [sessions, setSessions] = useState<V2SessionPnL[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiV2PnlBySession({ limit: 500 }).then(setSessions).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Group by agent prefix
  const byAgent = new Map<string, { sessions: number; closed: number; wins: number; losses: number; pnl: number; last: number }>();
  for (const s of sessions) {
    const prefix = extractAgentPrefix(s.session_id);
    const cur = byAgent.get(prefix) ?? { sessions: 0, closed: 0, wins: 0, losses: 0, pnl: 0, last: 0 };
    byAgent.set(prefix, {
      sessions: cur.sessions + 1,
      closed: cur.closed + s.closed_trades,
      wins: cur.wins + s.wins,
      losses: cur.losses + s.losses,
      pnl: cur.pnl + s.total_pnl,
      last: Math.max(cur.last, s.started_at),
    });
  }
  const agents = [...byAgent.entries()].sort((a, b) => b[1].pnl - a[1].pnl);

  if (loading) return <div style={{ color: "#64748b", padding: "2rem", textAlign: "center" }}>Loading…</div>;

  return (
    <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Agent", "Sessions", "Trades", "Wins", "Losses", "Win %", "Total P&L", "Last Active"].map((h) => (
                <th key={h} style={HEAD}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(([prefix, data]) => (
              <tr key={prefix}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ ...CELL, fontWeight: 600, color: "#e2e8f0" }}>{prefix}</td>
                <td style={CELL}>{data.sessions}</td>
                <td style={CELL}>{data.closed}</td>
                <td style={{ ...CELL, color: "#22c55e" }}>{data.wins}</td>
                <td style={{ ...CELL, color: "#ef4444" }}>{data.losses}</td>
                <td style={CELL}>{winRate(data.wins, data.closed)}</td>
                <td style={{ ...CELL, fontWeight: 700, color: pnlColor(data.pnl) }}>{fmt(data.pnl)}</td>
                <td style={CELL}>{fmtDate(data.last)}</td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr><td colSpan={8} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>No data yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── By Operator tab ───────────────────────────────────────────────────────────

function ByOperatorTab() {
  const [data, setData] = useState<V2OperatorPnL[]>([]);
  const [cumulative, setCumulative] = useState<V2CumulativePoint[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiV2PnlByOperator().then(setData).catch(() => {}).finally(() => setLoading(false));
    apiV2PnlCumulative().then(setCumulative).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) {
      apiV2PnlCumulative().then(setCumulative).catch(() => {});
    } else {
      apiV2PnlCumulative({ operator: selected }).then(setCumulative).catch(() => {});
    }
  }, [selected]);

  if (loading) return <div style={{ color: "#64748b", padding: "2rem", textAlign: "center" }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Cumulative chart */}
      <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <div style={{ color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Cumulative P&L</div>
          {data.length > 1 && (
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: "4px", padding: "2px 8px", fontSize: "0.78rem" }}
            >
              <option value="">All operators</option>
              {data.map((d) => <option key={d.operator} value={d.operator}>{d.operator}</option>)}
            </select>
          )}
        </div>
        <CumulativeChart data={cumulative} />
      </div>

      {/* Operator table */}
      <div style={{ background: "#0f172a", borderRadius: "8px", border: "1px solid #1e293b", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Operator", "Sessions", "Trades", "Wins", "Losses", "Win %", "Lifetime P&L", "First Active", "Last Active"].map((h) => (
                  <th key={h} style={HEAD}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.operator}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ ...CELL, fontWeight: 600, color: "#e2e8f0" }}>{d.operator}</td>
                  <td style={CELL}>{d.session_count}</td>
                  <td style={CELL}>{d.total_trades}</td>
                  <td style={{ ...CELL, color: "#22c55e" }}>{d.wins}</td>
                  <td style={{ ...CELL, color: "#ef4444" }}>{d.losses}</td>
                  <td style={CELL}>{winRate(d.wins, d.total_trades)}</td>
                  <td style={{ ...CELL, fontWeight: 700, color: pnlColor(d.total_pnl) }}>{fmt(d.total_pnl)}</td>
                  <td style={CELL}>{fmtDate(d.first_session)}</td>
                  <td style={CELL}>{fmtDate(d.last_session)}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={9} style={{ ...CELL, textAlign: "center", color: "#334155", padding: "2rem" }}>No operator data yet — set TRADER_OPERATOR in your .env</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main PnLPageV2 ────────────────────────────────────────────────────────────

const TAB_STYLE = (active: boolean): React.CSSProperties => ({
  background: "none",
  border: "none",
  padding: "0.5rem 1rem",
  cursor: "pointer",
  fontSize: "0.9rem",
  color: active ? "#f1f5f9" : "#64748b",
  borderBottom: `2px solid ${active ? "#3b82f6" : "transparent"}`,
  marginBottom: "-1px",
  transition: "color 0.15s",
});

export function PnLPageV2() {
  const [tab, setTab] = useState<Tab>("session");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Tab bar */}
      <div style={{ borderBottom: "1px solid #1e293b", display: "flex", gap: "0" }}>
        <button style={TAB_STYLE(tab === "session")} onClick={() => setTab("session")}>By Session</button>
        <button style={TAB_STYLE(tab === "agent")} onClick={() => setTab("agent")}>By Agent</button>
        <button style={TAB_STYLE(tab === "operator")} onClick={() => setTab("operator")}>By Operator</button>
      </div>

      {tab === "session" && <BySessionTab />}
      {tab === "agent" && <ByAgentTab />}
      {tab === "operator" && <ByOperatorTab />}
    </div>
  );
}
