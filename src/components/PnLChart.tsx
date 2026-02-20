/**
 * P&L over time chart — cumulative realized PnL computed from closed positions.
 * No API call: uses data already fetched by Dashboard.
 */

import { useMemo, useState } from "react";
import { Button } from "./Button";
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
import type { ClosedPosition } from "../lib/positionsStore";
import { getStrategy } from "../lib/strategies/registry";
import { hyperliquidTradeUrl } from "../lib/hyperliquid";

const WINDOWS = [
  { value: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "30D", ms: 30 * 24 * 60 * 60 * 1000 },
  { value: "90d", label: "90D", ms: 90 * 24 * 60 * 60 * 1000 },
  { value: "all", label: "All", ms: 0 },
] as const;

interface PnLChartProps {
  closed: ClosedPosition[];
}

function computePnlPoints(closed: ClosedPosition[], window: string): { time: number; pnl: number; timeStr: string; trade?: Record<string, unknown> }[] {
  const end = Date.now();
  const start = window === "all" ? 0 : end - (WINDOWS.find((w) => w.value === window)?.ms ?? 0);
  const sorted = [...closed].sort((a, b) => a.closedAt - b.closedAt);
  const filtered = sorted.filter((p) => p.closedAt >= start);
  if (filtered.length === 0) {
    return [{ time: end, pnl: 0, timeStr: "—", trade: undefined }];
  }
  let cumulative = 0;
  const points: { time: number; pnl: number; timeStr: string; trade?: Record<string, unknown> }[] = [
    { time: filtered[0].openedAt, pnl: 0, timeStr: new Date(filtered[0].openedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), trade: undefined },
  ];
  for (const p of filtered) {
    cumulative += p.realizedPnl;
    points.push({
      time: p.closedAt,
      pnl: cumulative,
      timeStr: new Date(p.closedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      trade: {
        id: p.id,
        coin: p.coin,
        side: p.side,
        entryPrice: p.entryPrice,
        size: p.size,
        strategyId: p.strategyId,
        realizedPnl: p.realizedPnl,
        comment: p.comment ?? null,
      },
    });
  }
  return points;
}

function computeDomain(pnlValues: number[]): [number, number] {
  if (pnlValues.length === 0) return [-10, 10];
  const min = Math.min(0, ...pnlValues);
  const max = Math.max(0, ...pnlValues);
  const range = max - min;
  const padding = range < 1 ? 0.5 : Math.max(range * 0.1, 1);
  return [min - padding, max + padding];
}

export function PnLChart({ closed }: PnLChartProps) {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]["value"]>("all");
  const data = useMemo(() => computePnlPoints(closed, window), [closed, window]);
  const domain = useMemo(() => computeDomain(data.map((d) => d.pnl)), [data]);

  const isEmpty = closed.length === 0 || (data.length <= 1 && !data[0]?.trade);
  if (isEmpty) {
    return (
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem", color: "#e2e8f0" }}>Cumulative P&L</h2>
        <div
          style={{
            height: 220,
            background: "#1e293b",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
            fontSize: "0.9rem",
          }}
        >
          {closed.length === 0
            ? "No closed trades yet — close a position to see P&L over time"
            : "No trades in selected period"}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", minWidth: 0, marginBottom: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", color: "#e2e8f0" }}>
          Cumulative P&L
        </h2>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {WINDOWS.map(({ value, label }) => (
            <Button
              key={value}
              variant="toggle"
              active={window === value}
              onClick={() => setWindow(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div
        style={{
          width: "100%",
          minWidth: 300,
          height: 220,
          minHeight: 220,
          background: "#1e293b",
          borderRadius: "8px",
          padding: "0.5rem",
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 20, left: 50, bottom: 5 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pnlGradientNeg" x1="0" y1="1" x2="0" y2="0">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="timeStr"
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              dataKey="pnl"
              domain={domain}
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              tickFormatter={(v) => {
                const n = Number(v);
                if (Math.abs(n) >= 100) return `${n >= 0 ? "+" : ""}${n.toFixed(0)}`;
                if (Math.abs(n) >= 1) return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
                return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
              }}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                color: "#e2e8f0",
                maxWidth: 320,
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as { pnl: number; trade?: Record<string, unknown> };
                const trade = p?.trade;
                return (
                  <div style={{ padding: "0.5rem", fontSize: "0.85rem" }}>
                    <div style={{ marginBottom: "0.25rem", color: "#94a3b8" }}>{label}</div>
                    <div>Cumulative P&L: {p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(2)} USDC</div>
                    {trade && Object.keys(trade).length > 0 && (
                      <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid #334155" }}>
                        <div>
                          <strong>
                            <a
                              href={hyperliquidTradeUrl(String(trade.coin))}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#3b82f6", textDecoration: "none" }}
                            >
                              {String(trade.coin)}
                            </a>{" "}
                            {String(trade.side)}
                          </strong>
                        </div>
                        <div>Strategy: {getStrategy(String(trade.strategyId))?.name ?? String(trade.strategyId)}</div>
                        <div>Size: {String(trade.size)} @ {Number(trade.entryPrice).toLocaleString()}</div>
                        <div>Trade P&L: {Number(trade.realizedPnl) >= 0 ? "+" : ""}{Number(trade.realizedPnl).toFixed(2)} USDC</div>
                        {trade.comment ? (
                          <div style={{ marginTop: "0.25rem", color: "#94a3b8", fontStyle: "italic" }}>
                            &quot;{String(trade.comment)}&quot;
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#pnlGradient)"
              fillOpacity={1}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
