import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "./Button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Brush,
} from "recharts";
import { getCandles, type Candle } from "../lib/hyperliquid";
import { strategyMeta } from "../lib/strategies/meta";

const INTERVALS = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
] as const;

type IntervalValue = (typeof INTERVALS)[number]["value"];

export interface TradeAnnotation {
  id?: string;
  coin: string;
  side: string;
  entry_price: number;
  exit_price?: number | null;
  strategy_reason?: string | null;
  strategyId?: string | null;
  realized_pnl?: number | null;
  opened_at?: number;
  closed_at?: number | null;
  comment?: string | null;
}

interface ChartPosition {
  coin: string;
  entryPrice: number;
  side: string;
  strategyId?: string | null;
}

interface PriceChartProps {
  coin: string;
  positions?: ChartPosition[];
  trades?: TradeAnnotation[];
  currentPrice?: number;
}

export function PriceChart({ coin, positions = [], trades = [], currentPrice }: PriceChartProps) {
  const [interval, setInterval] = useState<IntervalValue>("1h");
  const [data, setData] = useState<{ t: number; price: number; time: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brushRange, setBrushRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [yDomain, setYDomain] = useState<[number, number] | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!coin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBrushRange(null);
    setYDomain(null);
    const defaultDays = interval === "5m" ? 1 : interval === "15m" ? 3 : interval === "1h" ? 7 : interval === "4h" ? 30 : 90;
    const end = Date.now();
    const start = end - defaultDays * 24 * 60 * 60 * 1000;
    getCandles(coin, interval, start, end)
      .then((candles: Candle[]) => {
        if (cancelled) return;
        const chartData = candles.map((c) => ({
          t: c.t,
          price: parseFloat(c.c),
          time: new Date(c.t).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: interval === "1h" || interval === "15m" || interval === "5m" ? "2-digit" : undefined,
            minute: interval === "5m" || interval === "15m" ? "2-digit" : undefined,
          }),
        }));
        setData(chartData);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coin, interval]);

  const relevantPositions = positions.filter((p) => p.coin === coin);
  const relevantTrades = trades.filter((t) => t.coin === coin && t.closed_at == null);
  const dataMinT = data.length > 0 ? Math.min(...data.map((d) => d.t)) : 0;
  const dataMaxT = data.length > 0 ? Math.max(...data.map((d) => d.t)) : Date.now();

  const MIN_ZOOM_MS = 60 * 1000; // 1 min minimum window (1 candle at 1m)

  const handleBrushChange = useCallback(
    (e: { startIndex?: number; endIndex?: number }) => {
      if (e?.startIndex == null || e?.endIndex == null || data.length === 0) return;
      let startIdx = Math.max(0, e.startIndex);
      let endIdx = Math.min(data.length - 1, e.endIndex);
      const startT = data[startIdx]?.t ?? 0;
      const endT = data[endIdx]?.t ?? 0;
      let span = endT - startT;
      if (span < MIN_ZOOM_MS) {
        const midT = (startT + endT) / 2;
        const halfSpan = MIN_ZOOM_MS / 2;
        const targetStartT = midT - halfSpan;
        const targetEndT = midT + halfSpan;
        const si = data.findIndex((d) => d.t >= targetStartT);
        const ei = data.findIndex((d) => d.t >= targetEndT);
        startIdx = si >= 0 ? si : 0;
        endIdx = ei >= 0 ? ei : data.length - 1;
      }
      setBrushRange({ startIndex: startIdx, endIndex: endIdx });
      setYDomain(null);
    },
    [data]
  );

  const resetZoom = useCallback(() => {
    setBrushRange(null);
  }, []);

  const displayData = brushRange
    ? data.slice(brushRange.startIndex, brushRange.endIndex + 1)
    : data;
  const domainX: [number, number] =
    displayData.length > 0
      ? [Math.min(...displayData.map((d) => d.t)), Math.max(...displayData.map((d) => d.t))]
      : [dataMinT, dataMaxT];

  const brushStartIndex = brushRange?.startIndex ?? 0;
  const brushEndIndex = brushRange?.endIndex ?? Math.max(0, data.length - 1);

  const DEFAULT_STRATEGY = "trend";

  const referenceLinesInfo: { label: string; value: number; color: string }[] = [];
  relevantPositions.forEach((p) => {
    referenceLinesInfo.push({
      label: `Entry (${p.side})`,
      value: p.entryPrice,
      color: p.side === "long" ? "#22c55e" : "#ef4444",
    });
    const meta = (p.strategyId ? strategyMeta[p.strategyId] : undefined) ?? strategyMeta[DEFAULT_STRATEGY];
    if (meta?.takeProfitPct != null) {
      const tp = p.side === "long" ? p.entryPrice * (1 + meta.takeProfitPct) : p.entryPrice * (1 - meta.takeProfitPct);
      referenceLinesInfo.push({ label: `TP target (${(meta.takeProfitPct * 100).toFixed(1)}%)`, value: tp, color: "#22c55e" });
    }
    if (meta?.stopLossPct != null) {
      const sl = p.side === "long" ? p.entryPrice * (1 - meta.stopLossPct) : p.entryPrice * (1 + meta.stopLossPct);
      referenceLinesInfo.push({ label: `SL target (${(meta.stopLossPct * 100).toFixed(1)}%)`, value: sl, color: "#ef4444" });
    }
  });
  relevantTrades.forEach((t) => {
    referenceLinesInfo.push({
      label: `Entry (${t.side})`,
      value: t.entry_price,
      color: t.side === "long" ? "#22c55e" : "#ef4444",
    });
    const meta = (t.strategyId ? strategyMeta[t.strategyId] : undefined) ?? strategyMeta[DEFAULT_STRATEGY];
    if (meta?.takeProfitPct != null) {
      const tp = t.side === "long" ? t.entry_price * (1 + meta.takeProfitPct) : t.entry_price * (1 - meta.takeProfitPct);
      referenceLinesInfo.push({ label: `TP target (${(meta.takeProfitPct * 100).toFixed(1)}%)`, value: tp, color: "#22c55e" });
    }
    if (meta?.stopLossPct != null) {
      const sl = t.side === "long" ? t.entry_price * (1 - meta.stopLossPct) : t.entry_price * (1 + meta.stopLossPct);
      referenceLinesInfo.push({ label: `SL target (${(meta.stopLossPct * 100).toFixed(1)}%)`, value: sl, color: "#ef4444" });
    }
  });

  const ChartTooltip = useCallback(
    (props: { active?: boolean; payload?: { value?: number }[]; label?: string | number }) => {
      const { active, payload, label } = props;
      if (!active || !payload?.length) return null;
      const price = payload[0]?.value as number | undefined;
      return (
        <div
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: "6px",
            padding: "8px 10px",
            color: "#e2e8f0",
            fontSize: "12px",
            minWidth: 140,
          }}
        >
          {label != null && (
            <div style={{ marginBottom: 4, color: "#94a3b8" }}>
              {new Date(Number(label)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
          {price != null && (
            <div style={{ marginBottom: referenceLinesInfo.length > 0 ? 6 : 0 }}>
              <strong>Price:</strong> {price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </div>
          )}
          {referenceLinesInfo.length > 0 && (
            <div style={{ borderTop: "1px solid #334155", paddingTop: 6, marginTop: 4 }}>
              {referenceLinesInfo.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: r.color }} />
                  <span>{r.label}:</span>
                  <span style={{ fontWeight: 600 }}>{r.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },
    [referenceLinesInfo]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!chartRef.current || displayData.length === 0) return;
      e.preventDefault();
      const prices = displayData.map((d) => d.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const range = maxP - minP || 1;
      const center = (minP + maxP) / 2;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const newRange = Math.max(range * 0.05, Math.min(range * 50, range * factor));
      const newMin = center - newRange / 2;
      const newMax = center + newRange / 2;
      setYDomain([newMin, newMax]);
    },
    [displayData]
  );

  const resetYZoom = useCallback(() => setYDomain(null), []);

  const pos = relevantPositions[0];
  const trade = relevantTrades[0];
  const entryPrice = pos?.entryPrice ?? trade?.entry_price;
  const isWinning =
    pos && currentPrice != null && entryPrice != null
      ? (pos.side === "long" && currentPrice > entryPrice) ||
        (pos.side === "short" && currentPrice < entryPrice)
      : trade?.realized_pnl != null
        ? trade.realized_pnl >= 0
        : null;

  const tickFormatter = (t: number) =>
    new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: interval === "1h" || interval === "15m" || interval === "5m" ? "2-digit" : undefined,
      minute: interval === "5m" || interval === "15m" ? "2-digit" : undefined,
    });

  if (!coin) return null;

  if (loading && data.length === 0) {
    return (
      <div
        style={{
          height: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e293b",
          borderRadius: "8px",
          color: "#94a3b8",
        }}
      >
        Loading chart…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "1rem",
          background: "#1e293b",
          borderRadius: "8px",
          color: "#f87171",
          fontSize: "0.9rem",
        }}
      >
        Chart error: {error}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", color: "#e2e8f0" }}>
            {coin} Price
          </h2>
          {currentPrice != null && (
            <span
              style={{
                fontSize: "0.9rem",
                padding: "0.2rem 0.5rem",
                borderRadius: "4px",
                background: isWinning === true ? "#14532d" : isWinning === false ? "#7f1d1d" : "#334155",
                color: isWinning === true ? "#22c55e" : isWinning === false ? "#ef4444" : "#94a3b8",
              }}
            >
              {currentPrice.toLocaleString()} {isWinning === true ? "▲" : isWinning === false ? "▼" : ""}
            </span>
          )}
          {(brushRange || yDomain) && (
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {brushRange && (
                <Button variant="ghost" size="sm" onClick={resetZoom}>
                  Reset time zoom
                </Button>
              )}
              {yDomain && (
                <Button variant="ghost" size="sm" onClick={resetYZoom}>
                  Reset Y zoom
                </Button>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {INTERVALS.map(({ value, label }) => (
            <Button
              key={value}
              variant="toggle"
              active={interval === value}
              onClick={() => setInterval(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div
        ref={chartRef}
        onWheel={handleWheel}
        style={{
          height: 300,
          background: "#1e293b",
          borderRadius: "8px",
          padding: "0.5rem",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              key={`${coin}-${interval}`}
              data={displayData}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="t"
                type="number"
                domain={domainX}
                allowDataOverflow
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
                minTickGap={60}
                tickFormatter={tickFormatter}
              />
              <YAxis
                domain={yDomain ?? ["auto", "auto"]}
                stroke="#64748b"
                fontSize={10}
                tickLine={false}
                tickFormatter={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              />
              <Tooltip content={(props: unknown) => <ChartTooltip {...(props as object)} />} />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {relevantPositions.map((p, i) => {
              const meta = (p.strategyId ? strategyMeta[p.strategyId] : undefined) ?? strategyMeta[DEFAULT_STRATEGY];
              const tp = meta?.takeProfitPct != null
                ? (p.side === "long" ? p.entryPrice * (1 + meta.takeProfitPct) : p.entryPrice * (1 - meta.takeProfitPct))
                : null;
              const sl = meta?.stopLossPct != null
                ? (p.side === "long" ? p.entryPrice * (1 - meta.stopLossPct) : p.entryPrice * (1 + meta.stopLossPct))
                : null;
              return (
                <React.Fragment key={`pos-${i}`}>
                  <ReferenceLine
                    y={p.entryPrice}
                    stroke={p.side === "long" ? "#22c55e" : "#ef4444"}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    strokeOpacity={0.9}
                    label={{
                      value: `Entry ${p.side} @ ${p.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                      position: "right",
                      fill: p.side === "long" ? "#22c55e" : "#ef4444",
                      fontSize: 11,
                    }}
                  />
                  {tp != null && (
                    <ReferenceLine
                      y={tp}
                      stroke="#22c55e"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      strokeOpacity={0.7}
                      label={{
                        value: `TP ${(meta!.takeProfitPct! * 100).toFixed(1)}%`,
                        position: "right",
                        fill: "#22c55e",
                        fontSize: 9,
                      }}
                    />
                  )}
                  {sl != null && (
                    <ReferenceLine
                      y={sl}
                      stroke="#ef4444"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      strokeOpacity={0.7}
                      label={{
                        value: `SL ${(meta!.stopLossPct! * 100).toFixed(1)}%`,
                        position: "right",
                        fill: "#ef4444",
                        fontSize: 9,
                      }}
                    />
                  )}
                </React.Fragment>
              );
            })}
            {relevantTrades.map((t, i) => {
              const strat = t.strategy_reason ? t.strategy_reason.slice(0, 30) + (t.strategy_reason.length > 30 ? "…" : "") : "";
              const meta = (t.strategyId ? strategyMeta[t.strategyId] : undefined) ?? strategyMeta[DEFAULT_STRATEGY];
              const tp = meta?.takeProfitPct != null
                ? (t.side === "long" ? t.entry_price * (1 + meta.takeProfitPct) : t.entry_price * (1 - meta.takeProfitPct))
                : null;
              const sl = meta?.stopLossPct != null
                ? (t.side === "long" ? t.entry_price * (1 - meta.stopLossPct) : t.entry_price * (1 + meta.stopLossPct))
                : null;
              return (
                <React.Fragment key={`trade-${i}`}>
                  {t.opened_at != null && t.opened_at >= domainX[0] && t.opened_at <= domainX[1] && (
                    <ReferenceLine
                      x={t.opened_at}
                      stroke={t.side === "long" ? "#22c55e" : "#ef4444"}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      strokeOpacity={0.7}
                      label={{
                        value: strat ? `Entry · ${strat}` : `Entry ${t.side}`,
                        position: "top",
                        fill: t.side === "long" ? "#22c55e" : "#ef4444",
                        fontSize: 9,
                      }}
                    />
                  )}
                  <ReferenceLine
                    y={t.entry_price}
                    stroke={t.side === "long" ? "#22c55e" : "#ef4444"}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    strokeOpacity={0.85}
                    label={{
                      value: `Entry ${t.side} @ ${t.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}${strat ? ` · ${strat}` : ""}`,
                      position: "right",
                      fill: t.side === "long" ? "#22c55e" : "#ef4444",
                      fontSize: 10,
                    }}
                  />
                  {tp != null && (
                    <ReferenceLine
                      y={tp}
                      stroke="#22c55e"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      strokeOpacity={0.7}
                      label={{
                        value: `TP ${(meta!.takeProfitPct! * 100).toFixed(1)}%`,
                        position: "right",
                        fill: "#22c55e",
                        fontSize: 9,
                      }}
                    />
                  )}
                  {sl != null && (
                    <ReferenceLine
                      y={sl}
                      stroke="#ef4444"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      strokeOpacity={0.7}
                      label={{
                        value: `SL ${(meta!.stopLossPct! * 100).toFixed(1)}%`,
                        position: "right",
                        fill: "#ef4444",
                        fontSize: 9,
                      }}
                    />
                  )}
                </React.Fragment>
              );
            })}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {data.length > 10 && (
          <div style={{ height: 28, marginTop: 4 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 0, right: 5, left: 5, bottom: 0 }}>
                <XAxis dataKey="t" type="number" hide />
                <YAxis hide />
                <Line type="monotone" dataKey="price" stroke="#334155" strokeWidth={1} dot={false} />
                <Brush
                  dataKey="t"
                  height={24}
                  stroke="#334155"
                  fill="#0f172a"
                  tickFormatter={tickFormatter}
                  startIndex={brushStartIndex}
                  endIndex={brushEndIndex}
                  onChange={handleBrushChange}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {(relevantPositions.length > 0 || relevantTrades.length > 0) && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem",
            background: "#0f172a",
            borderRadius: "8px",
            border: "1px solid #334155",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "0.5rem", fontWeight: 600 }}>
            Active positions (entry + targets)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {relevantPositions.map((p, i) => {
              const meta = (p.strategyId ? strategyMeta[p.strategyId] : undefined) ?? strategyMeta[DEFAULT_STRATEGY];
              const tp = meta?.takeProfitPct;
              const sl = meta?.stopLossPct;
              return (
                <div
                  key={`pos-${i}`}
                  style={{
                    fontSize: "0.85rem",
                    padding: "0.5rem",
                    background: "#1e293b",
                    borderRadius: "6px",
                    borderLeft: `3px solid ${p.side === "long" ? "#22c55e" : "#ef4444"}`,
                  }}
                >
                  <span style={{ color: "#e2e8f0" }}>
                    {p.side} @ {p.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    {tp != null && (
                      <> · TP {(tp * 100).toFixed(1)}%</>
                    )}
                    {sl != null && (
                      <> · SL {(sl * 100).toFixed(1)}%</>
                    )}
                  </span>
                </div>
              );
            })}
            {relevantTrades.map((t, i) => {
              const meta = (t.strategyId ? strategyMeta[t.strategyId] : undefined) ?? strategyMeta[DEFAULT_STRATEGY];
              const tp = meta?.takeProfitPct;
              const sl = meta?.stopLossPct;
              return (
                <div
                  key={t.id ?? `trade-${i}`}
                  style={{
                    fontSize: "0.85rem",
                    padding: "0.5rem",
                    background: "#1e293b",
                    borderRadius: "6px",
                    borderLeft: `3px solid ${t.side === "long" ? "#22c55e" : "#ef4444"}`,
                  }}
                >
                  <span style={{ color: "#e2e8f0" }}>
                    {t.side} @ {t.entry_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    {t.strategy_reason && <> · {t.strategy_reason}</>}
                    {tp != null && <> · TP {(tp * 100).toFixed(1)}%</>}
                    {sl != null && <> · SL {(sl * 100).toFixed(1)}%</>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
