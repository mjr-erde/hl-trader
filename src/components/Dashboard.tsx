/**
 * Simulated trading — paper positions from local DB.
 * Same UI design as Live page for consistency.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Position } from "../lib/strategies/types";
import type { ClosedPosition } from "../lib/positionsStore";
import {
  apiGetOpenPositions,
  apiGetClosedPositions,
  apiOpenPosition,
  apiClosePosition,
} from "../lib/api";
import { useUser } from "../context/UserContext";
import { getCoins, getMid, getAllMids, getMeta, hyperliquidTradeUrl } from "../lib/hyperliquid";
import { unrealizedPnl } from "../lib/pnl";
import { strategies, getStrategy } from "../lib/strategies/registry";
import { Button } from "./Button";
import { PriceChart } from "./PriceChart";
import { StrategyPanel } from "./StrategyPanel";
import {
  PageLayout,
  StatCards,
  StatCard,
  PnLCard,
  Select,
  Section,
  DataTable,
  ErrorBanner,
  Input,
} from "./ui";

function PositionValue({ position, price }: { position: Position; price: number | undefined }) {
  const value = price != null ? position.size * price : null;
  const prevValueRef = useRef<number | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (value != null && prevValueRef.current != null && Math.abs(value - prevValueRef.current) > 0.0001) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(t);
    }
    if (value != null) prevValueRef.current = value;
  }, [value]);

  if (value == null) return <span>—</span>;
  return (
    <span className={flash ? "value-flash" : ""} style={{ display: "inline-block", padding: "0.1rem 0.25rem", borderRadius: "4px" }}>
      {value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
    </span>
  );
}

export function Dashboard() {
  const { user } = useUser();
  const [positions, setPositions] = useState<Position[]>([]);
  const [closed, setClosed] = useState<ClosedPosition[]>([]);
  const [coins, setCoins] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selectedCoin, setSelectedCoin] = useState("");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [maxLeverageByCoin, setMaxLeverageByCoin] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [strategyId, setStrategyId] = useState("trend");
  const [closeModal, setCloseModal] = useState<Position | null>(null);
  const [closeComment, setCloseComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setPositions([]);
      setClosed([]);
      return;
    }
    try {
      const [open, closedList] = await Promise.all([
        apiGetOpenPositions(user.id),
        apiGetClosedPositions(user.id),
      ]);
      setPositions(open);
      setClosed(closedList);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [user, refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, c, p] = await Promise.all([getMeta(), getCoins(), getAllMids()]);
        if (cancelled) return;
        const maxByCoin: Record<string, number> = {};
        for (const a of meta.universe) maxByCoin[a.name] = a.maxLeverage;
        setMaxLeverageByCoin(maxByCoin);
        setCoins(c);
        if (c.length && !selectedCoin) setSelectedCoin(c.includes("SOL") ? "SOL" : c[0]);
        const priceMap: Record<string, number> = {};
        for (const [sym, v] of Object.entries(p)) priceMap[sym] = parseFloat(v);
        setPrices(priceMap);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const max = maxLeverageByCoin[selectedCoin] ?? 50;
    if (leverage > max) setLeverage(max);
  }, [selectedCoin, maxLeverageByCoin, leverage]);

  useEffect(() => {
    const id = setInterval(() => {
      getAllMids()
        .then((p) => {
          const m: Record<string, number> = {};
          for (const [k, v] of Object.entries(p)) m[k] = parseFloat(v);
          setPrices((prev) => ({ ...prev, ...m }));
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, []);

  const handleBuy = async () => {
    if (!user) return;
    const sz = parseFloat(size);
    if (!selectedCoin || !sz || sz <= 0) return;
    setError(null);
    try {
      const price = await getMid(selectedCoin);
      await apiOpenPosition(user.id, selectedCoin, "long", price, sz, strategyId, leverage, comment || undefined);
      setSize("");
      setComment("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSell = async () => {
    if (!user) return;
    const sz = parseFloat(size);
    if (!selectedCoin || !sz || sz <= 0) return;
    setError(null);
    try {
      const price = await getMid(selectedCoin);
      await apiOpenPosition(user.id, selectedCoin, "short", price, sz, strategyId, leverage, comment || undefined);
      setSize("");
      setComment("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleCloseClick = (pos: Position) => setCloseModal(pos);
  const handleCloseConfirm = async () => {
    if (!user || !closeModal) return;
    setError(null);
    try {
      const price = await getMid(closeModal.coin);
      await apiClosePosition(closeModal.id, price, closeComment || undefined);
      setCloseModal(null);
      setCloseComment("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unrealizedPnlTotal = positions.reduce((sum, p) => {
    const price = prices[p.coin];
    if (!price) return sum;
    return sum + unrealizedPnl(p.side, p.entryPrice, price, p.size);
  }, 0);
  const realizedPnlTotal = closed.reduce((sum, p) => sum + p.realizedPnl, 0);

  if (loading) {
    return (
      <p style={{ color: "#94a3b8" }}>
        Loading coins and prices from Hyperliquid…
      </p>
    );
  }

  if (!user) {
    return (
      <PageLayout>
        <span style={{ color: "#fbbf24", fontSize: "0.9rem" }}>
          Select or create a user to trade.
        </span>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {error && (
        <ErrorBanner
          message={error}
          detail="Check your connection. The app needs to reach api.hyperliquid.xyz."
        />
      )}

      <StatCards>
        <StatCard
          label="User"
          value={<span>{user.name}</span>}
          minWidth={140}
        />
        <PnLCard label="Unrealized P&L" value={unrealizedPnlTotal} />
        <PnLCard label="Realized P&L" value={realizedPnlTotal} />
      </StatCards>

      <PriceChart
        coin={selectedCoin || positions[0]?.coin || coins[0] || "BTC"}
        positions={positions.map((p) => ({
          coin: p.coin,
          entryPrice: p.entryPrice,
          side: p.side,
          strategyId: p.strategyId,
        }))}
        trades={[]}
        currentPrice={selectedCoin ? prices[selectedCoin] : undefined}
      />

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {positions.length} open position{positions.length !== 1 ? "s" : ""}
        </span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <Select
            value={selectedCoin}
            onChange={setSelectedCoin}
            options={coins.map((c) => ({ value: c, label: c }))}
            placeholder="No coins loaded"
            minWidth={80}
          />
          <Input
            type="number"
            placeholder="Size"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            style={{ width: 100 }}
          />
          <Select
            value={String(leverage)}
            onChange={(v) => setLeverage(Number(v))}
            options={([1, 2, 3, 5, 10, 20, 50] as const)
              .filter((x) => x <= (maxLeverageByCoin[selectedCoin] ?? 50))
              .map((x) => ({ value: String(x), label: `${x}x` }))}
            minWidth={70}
          />
          <Select
            value={strategyId}
            onChange={setStrategyId}
            options={strategies.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Input
            type="text"
            placeholder="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ width: 140 }}
          />
          <Button variant="success" onClick={handleBuy}>
            Buy
          </Button>
          <Button variant="danger" onClick={handleSell}>
            Sell
          </Button>
        </div>
      </div>

      <Section title="Open Positions">
        <DataTable<Position>
          columns={[
            {
              key: "coin",
              header: "Coin",
              render: (p) => (
                <a
                  href={hyperliquidTradeUrl(p.coin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#3b82f6", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {p.coin}
                </a>
              ),
            },
            {
              key: "strategy",
              header: "Strategy",
              render: (p) => getStrategy(p.strategyId)?.name ?? p.strategyId,
            },
            {
              key: "opened",
              header: "Opened",
              render: (p) => new Date(p.openedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
            },
            { key: "side", header: "Side", render: (p) => p.side },
            { key: "entry", header: "Entry", render: (p) => p.entryPrice.toLocaleString() },
            { key: "size", header: "Size", render: (p) => p.size },
            { key: "lev", header: "Lev", render: (p) => `${p.leverage ?? 1}x` },
            {
              key: "value",
              header: "Value",
              render: (p) => <PositionValue position={p} price={prices[p.coin]} />,
            },
            {
              key: "pnl",
              header: "P&L",
              render: (p) => {
                const price = prices[p.coin];
                const pnl = price ? unrealizedPnl(p.side, p.entryPrice, price, p.size) : null;
                return pnl !== null ? (
                  <span style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {pnl >= 0 ? "+" : ""}
                    {pnl.toFixed(2)}
                  </span>
                ) : (
                  "—"
                );
              },
            },
            {
              key: "comment",
              header: "Comment",
              render: (p) => p.comment || "—",
              style: { fontSize: "0.85rem", color: "#94a3b8", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" },
            },
            {
              key: "actions",
              header: "Actions",
              render: (p) => (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleCloseClick(p); }}>
                  Close
                </Button>
              ),
            },
          ]}
          data={positions}
          getRowKey={(p) => p.id}
          selectedKey={selectedCoin}
          onSelect={(p) => setSelectedCoin(p.coin)}
          emptyMessage="No open positions."
        />
      </Section>

      {closeModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setCloseModal(null)}
        >
          <div
            style={{
              background: "#1e293b",
              padding: "1.5rem",
              borderRadius: "8px",
              border: "1px solid #334155",
              minWidth: 320,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
              Close{" "}
              <a
                href={hyperliquidTradeUrl(closeModal.coin)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#3b82f6", textDecoration: "none" }}
              >
                {closeModal.coin}
              </a>{" "}
              {closeModal.side}
            </h3>
            <p style={{ margin: "0 0 1rem", color: "#94a3b8", fontSize: "0.9rem" }}>
              Size {closeModal.size} @ {closeModal.entryPrice.toLocaleString()}
            </p>
            <Input
              type="text"
              placeholder="Comment (optional)"
              value={closeComment}
              onChange={(e) => setCloseComment(e.target.value)}
              style={{ width: "100%", marginBottom: "1rem" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setCloseModal(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleCloseConfirm}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <Section title="Closed Positions">
          <DataTable<ClosedPosition>
            columns={[
              {
                key: "coin",
                header: "Coin",
                render: (p) => (
                  <a
                    href={hyperliquidTradeUrl(p.coin)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#3b82f6", textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.coin}
                  </a>
                ),
              },
              { key: "side", header: "Side", render: (p) => p.side },
              {
                key: "opened",
                header: "Opened",
                render: (p) => new Date(p.openedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
              },
              {
                key: "closed",
                header: "Closed",
                render: (p) => new Date(p.closedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }),
              },
              {
                key: "entryExit",
                header: "Entry → Exit",
                render: (p) => `${p.entryPrice.toLocaleString()} → ${p.exitPrice.toLocaleString()}`,
              },
              {
                key: "pnl",
                header: "P&L",
                render: (p) => (
                  <span style={{ color: p.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {p.realizedPnl >= 0 ? "+" : ""}
                    {p.realizedPnl.toFixed(2)}
                  </span>
                ),
              },
              {
                key: "comment",
                header: "Comment",
                render: (p) => p.comment || "—",
                style: { fontSize: "0.85rem", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" },
              },
            ]}
            data={closed.slice(-10).reverse()}
            getRowKey={(p) => p.id}
            selectedKey={selectedCoin}
            onSelect={(p) => setSelectedCoin(p.coin)}
          />
        </Section>
      )}

      <StrategyPanel selectedId={strategyId} onSelect={setStrategyId} />
    </PageLayout>
  );
}
