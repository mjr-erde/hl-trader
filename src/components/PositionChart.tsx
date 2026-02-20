/**
 * PositionChart — TradingView Lightweight Charts v5 candlestick chart.
 * Shows 1h candles for the selected trade's window with entry/exit markers.
 * Canvas-based: much faster than SVG Recharts for candlestick data.
 */

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type SeriesMarkerBarPosition,
  type SeriesMarkerBar,
  type Time,
  ColorType,
} from "lightweight-charts";
import { getCandles } from "../lib/hyperliquid";
import type { V2TradeRow } from "../lib/api";

interface PositionChartProps {
  trade: V2TradeRow | null;
}

const CHART_BG = "#0f172a";
const GRID_COLOR = "#1e293b";
const TEXT_COLOR = "#94a3b8";

export function PositionChart({ trade }: PositionChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: TEXT_COLOR,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      timeScale: {
        borderColor: GRID_COLOR,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: GRID_COLOR,
      },
      crosshair: {
        mode: 1,
      },
      width: containerRef.current.offsetWidth,
      height: containerRef.current.offsetHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Handle resize
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  const loadTrade = useCallback(async (t: V2TradeRow) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    try {
      const openedAt = t.opened_at;
      const closedAt = t.closed_at ?? Date.now();
      const padBefore = 10 * 3600 * 1000;
      const padAfter = 5 * 3600 * 1000;
      const windowStart = openedAt - padBefore;
      const windowEnd = Math.min(closedAt + padAfter, Date.now());

      const rawCandles = await getCandles(t.coin, "1h", windowStart, windowEnd);
      if (!rawCandles.length) return;

      const candles: CandlestickData<Time>[] = rawCandles.map((c) => ({
        time: Math.floor(c.t / 1000) as Time,
        open: Number(c.o),
        high: Number(c.h),
        low: Number(c.l),
        close: Number(c.c),
      }));

      series.setData(candles);

      // Add entry/exit markers using v5 createSeriesMarkers
      const isLong = t.side === "long";

      const markers: SeriesMarkerBar<Time>[] = [
        {
          time: Math.floor(openedAt / 1000) as Time,
          position: (isLong ? "belowBar" : "aboveBar") as SeriesMarkerBarPosition,
          color: isLong ? "#22c55e" : "#ef4444",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: `Entry ${t.entry_price.toFixed(4)}`,
          size: 1.5,
        },
      ];

      if (t.closed_at && t.exit_price) {
        markers.push({
          time: Math.floor(t.closed_at / 1000) as Time,
          position: (isLong ? "aboveBar" : "belowBar") as SeriesMarkerBarPosition,
          color: "#94a3b8",
          shape: isLong ? "arrowDown" : "arrowUp",
          text: `Exit ${t.exit_price.toFixed(4)}`,
          size: 1.5,
        });
      }

      createSeriesMarkers(series, markers);

      // Add entry price line
      series.createPriceLine({
        price: t.entry_price,
        color: isLong ? "#22c55e88" : "#ef444488",
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: "Entry",
      });

      // Add estimated SL line
      const slPct = t.strategy_reason?.startsWith("R3") ? 0.015 : 0.02;
      const slPrice = isLong
        ? t.entry_price * (1 - slPct)
        : t.entry_price * (1 + slPct);
      series.createPriceLine({
        price: slPrice,
        color: "#ef444466",
        lineWidth: 1,
        lineStyle: 3, // dotted
        axisLabelVisible: false,
        title: "SL~",
      });

      chart.timeScale().fitContent();
    } catch {
      // Non-fatal — chart stays empty if candles fail
    }
  }, []);

  // Load data when trade changes
  useEffect(() => {
    if (!trade) {
      seriesRef.current?.setData([]);
      return;
    }
    loadTrade(trade);
  }, [trade, loadTrade]);

  if (!trade) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: CHART_BG,
          borderRadius: "8px",
          color: TEXT_COLOR,
          fontSize: "0.9rem",
        }}
      >
        Select a trade to view its chart
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", borderRadius: "8px", overflow: "hidden" }}
    />
  );
}
