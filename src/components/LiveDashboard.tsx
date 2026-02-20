/**
 * Real Hyperliquid positions — live from chain.
 * Requires HYPERLIQUID_ACCOUNT_ADDRESS or HYPERLIQUID_PRIVATE_KEY in hyperliquid-trader/.env.
 */

import { useState, useEffect, useCallback } from "react";
import {
  apiHlPositions,
  apiHlClosedPositions,
  apiHlTrades,
  apiHlTradeUsernames,
  apiHlClosedTrades,
  apiHlOpenTrades,
  type HlPosition,
  type HlTrade,
  type HlClosedPosition,
  type HlClosedTrade,
  type HlOpenTrade,
} from "../lib/api";
import { getAllMids, hyperliquidTradeUrl } from "../lib/hyperliquid";
import { unrealizedPnl } from "../lib/pnl";
import { PriceChart } from "./PriceChart";
import { LiveStrategyInfo } from "./LiveStrategyInfo";
import {
  PageLayout,
  StatCards,
  StatCard,
  PnLCard,
  Select,
  Section,
  DataTable,
  ErrorBanner,
  RateLimitLoader,
} from "./ui";

export function LiveDashboard() {
  const [positions, setPositions] = useState<HlPosition[]>([]);
  const [account, setAccount] = useState<string>("");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selectedCoin, setSelectedCoin] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [walletClosed, setWalletClosed] = useState<HlClosedPosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<HlClosedTrade[]>([]);
  const [openTrades, setOpenTrades] = useState<HlOpenTrade[]>([]);
  const [tradesUsername, setTradesUsername] = useState<string>("");
  const [usernames, setUsernames] = useState<string[]>([]);
  const [trades, setTrades] = useState<HlTrade[]>([]);
  const [tradesForChart, setTradesForChart] = useState<HlTrade[]>([]);
  const [rateLimitRetrying, setRateLimitRetrying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRateLimitRetrying(false);
      const res = await apiHlPositions();
      setPositions(res.positions);
      setAccount(res.account);
      setError(null);
      if (res.positions.length > 0) {
        if (!selectedCoin) setSelectedCoin(res.positions[0].coin);
        else if (!res.positions.some((p) => p.coin === selectedCoin)) setSelectedCoin(res.positions[0].coin);
      }
    } catch (e) {
      const msg = (e as Error).message;
      const is429 = msg.includes("429") || msg.includes("Too Many Requests");
      if (is429) {
        setRateLimitRetrying(true);
      }
      setError(msg);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCoin]);

  const retryAfterRateLimit = useCallback(() => {
    setError(null);
    setRateLimitRetrying(false);
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    getAllMids()
      .then((m) => {
        const map: Record<string, number> = {};
        for (const [k, v] of Object.entries(m)) map[k] = parseFloat(v);
        setPrices(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      getAllMids()
        .then((m) => {
          const map: Record<string, number> = {};
          for (const [k, v] of Object.entries(m)) map[k] = parseFloat(v);
          setPrices((prev) => ({ ...prev, ...map }));
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const load = () => apiHlTradeUsernames().then(setUsernames).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (error) return;
    const load = () =>
      apiHlClosedPositions(90)
        .then(setWalletClosed)
        .catch(() => setWalletClosed([]));
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [error]);

  useEffect(() => {
    if (error) return;
    apiHlClosedTrades(90)
      .then(setClosedTrades)
      .catch(() => setClosedTrades([]));
    const id = setInterval(() => {
      apiHlClosedTrades(90).then(setClosedTrades).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [error]);

  useEffect(() => {
    if (error) return;
    apiHlOpenTrades()
      .then(setOpenTrades)
      .catch(() => setOpenTrades([]));
    const id = setInterval(() => apiHlOpenTrades().then(setOpenTrades).catch(() => {}), 60000);
    return () => clearInterval(id);
  }, [error]);

  useEffect(() => {
    if (!tradesUsername) {
      setTrades([]);
      setTradesForChart([]);
      return;
    }
    apiHlTrades(tradesUsername)
      .then((t) => {
        setTrades(t);
        if (selectedCoin) {
          setTradesForChart(t.filter((tr) => tr.coin === selectedCoin));
        } else {
          setTradesForChart([]);
        }
      })
      .catch(() => setTrades([]));
  }, [tradesUsername, selectedCoin]);

  const chartPositions = positions.map((p) => ({
    coin: p.coin,
    entryPrice: p.entryPrice,
    side: p.side,
  }));

  const currentPrice = selectedCoin ? prices[selectedCoin] : undefined;

  const unrealizedPnlTotal = positions.reduce((sum, p) => {
    const price = prices[p.coin];
    if (price == null) return sum;
    return sum + unrealizedPnl(p.side, p.entryPrice, price, p.size);
  }, 0);
  const realizedPnlTotal =
    trades
      .filter((t) => t.realized_pnl != null)
      .reduce((sum, t) => sum + (t.realized_pnl ?? 0), 0) +
    walletClosed.reduce((sum, c) => sum + c.realizedPnl, 0);

  if (loading) {
    return (
      <p style={{ color: "#94a3b8" }}>Loading real positions from Hyperliquid…</p>
    );
  }

  if (error) {
    const is429 = error.includes("429") || error.includes("Too Many Requests");
    const isNoWallet = error.includes("no_wallet") || error.includes("No wallet configured");
    const isFetchFailed = error.includes("fetch failed") || error.includes("Unknown HTTP request error");
    if (is429 && rateLimitRetrying) {
      return (
        <PageLayout>
          <RateLimitLoader retryIn={12} onRetry={retryAfterRateLimit} />
        </PageLayout>
      );
    }
    if (isNoWallet) {
      return (
        <PageLayout>
          <div style={{ padding: "2rem", background: "#1e293b", borderRadius: "12px", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>📄</div>
            <div style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: "0.5rem" }}>Paper Trading Mode</div>
            <div style={{ color: "#94a3b8", fontSize: "0.9rem", maxWidth: 380, margin: "0 auto" }}>
              No live wallet configured. Real positions won't appear here.
              <br /><br />
              Run <code style={{ background: "#0f172a", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>./start-erde</code> and choose live trading to connect a wallet, or check the <strong>P&L → Live Sessions</strong> tab for your paper trades.
            </div>
          </div>
        </PageLayout>
      );
    }
    const detail = is429
      ? "Hyperliquid API rate limit. Wait a minute and refresh, or reduce polling."
      : isFetchFailed
        ? "Server cannot reach Hyperliquid API. Ensure the server is running (make dev) and can reach api.hyperliquid.xyz (no firewall/VPN blocking)."
        : "Check hyperliquid-trader/.env and server logs.";
    return <ErrorBanner message={error} detail={detail} />;
  }

  return (
    <PageLayout>
      <StatCards>
        <StatCard
          label="Live Account"
          value={<span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{account || "—"}</span>}
          minWidth={180}
        />
        <PnLCard label="Unrealized P&L" value={unrealizedPnlTotal} />
        <PnLCard label="Realized P&L (trades)" value={realizedPnlTotal} />
      </StatCards>

      <PriceChart
        coin={selectedCoin || positions[0]?.coin || trades[0]?.coin || walletClosed[0]?.coin || "BTC"}
        positions={chartPositions}
        trades={tradesForChart.filter((t) => t.closed_at == null)}
        currentPrice={currentPrice}
      />

      <LiveStrategyInfo />

      <Section title="Open Positions">
        <DataTable<HlPosition>
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
              render: (p) => {
                const match = openTrades.find((t) => t.coin === p.coin && t.side === p.side);
                const strat = match?.strategy_reason?.trim();
                return (
                  <div title={strat ?? undefined} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {strat || "—"}
                  </div>
                );
              },
              style: { maxWidth: 160 },
            },
            {
              key: "opened",
              header: "Opened",
              render: (p) => {
                const match = openTrades.find((t) => t.coin === p.coin && t.side === p.side);
                return match ? new Date(match.opened_at).toLocaleString() : "—";
              },
              style: { fontSize: "0.85rem" },
            },
            { key: "side", header: "Side", render: (p) => p.side },
            { key: "entry", header: "Entry", render: (p) => p.entryPrice.toLocaleString() },
            { key: "size", header: "Size", render: (p) => p.size },
            { key: "lev", header: "Lev", render: (p) => `${p.leverage}x` },
            {
              key: "value",
              header: "Value",
              render: (p) =>
                prices[p.coin] != null
                  ? `${(p.size * prices[p.coin]!).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} USDC`
                  : "—",
            },
            {
              key: "pnl",
              header: "P&L",
              render: (p) => {
                const price = prices[p.coin];
                const pnl = price ? unrealizedPnl(p.side, p.entryPrice, price, p.size) : null;
                return pnl != null ? (
                  <span style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {pnl >= 0 ? "+" : ""}
                    {pnl.toFixed(2)}
                  </span>
                ) : (
                  "—"
                );
              },
            },
          ]}
          data={positions}
          getRowKey={(p) => p.coin}
          selectedKey={selectedCoin}
          onSelect={(p) => setSelectedCoin(p.coin)}
          emptyMessage="No open positions."
        />
      </Section>

      <Section title="Closed Positions (Logged)">
        <DataTable<HlClosedTrade>
          columns={[
            {
              key: "coin",
              header: "Coin",
              render: (t) => (
                <a
                  href={hyperliquidTradeUrl(t.coin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#3b82f6", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.coin}
                </a>
              ),
            },
            { key: "side", header: "Side", render: (t) => t.side },
            {
              key: "opened",
              header: "Opened",
              render: (t) => new Date(t.opened_at).toLocaleString(),
              style: { fontSize: "0.85rem" },
            },
            {
              key: "closed",
              header: "Closed",
              render: (t) => new Date(t.closed_at).toLocaleString(),
              style: { fontSize: "0.85rem" },
            },
            {
              key: "exit",
              header: "Exit",
              render: (t) =>
                t.exit_price != null
                  ? t.exit_price.toLocaleString(undefined, { maximumFractionDigits: 4 })
                  : "—",
            },
            {
              key: "pnl",
              header: "P&L",
              render: (t) =>
                t.realized_pnl != null ? (
                  <span style={{ color: t.realized_pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {t.realized_pnl >= 0 ? "+" : ""}
                    {t.realized_pnl.toFixed(2)}
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              key: "strategy",
              header: "Strategy",
              render: (t) => (
                <div title={t.strategy_reason ?? undefined} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.strategy_reason?.trim() || "—"}
                </div>
              ),
              style: { maxWidth: 160 },
            },
          ]}
          data={closedTrades.slice(0, 50)}
          getRowKey={(t) => t.id}
          selectedKey={selectedCoin}
          onSelect={(t) => setSelectedCoin(t.coin)}
          emptyMessage="No closed positions in database (last 90 days)."
        />
      </Section>

      <Section title="Closed Positions (Wallet)">
        <DataTable<HlClosedPosition>
          columns={[
            {
              key: "coin",
              header: "Coin",
              render: (c) => (
                <a
                  href={hyperliquidTradeUrl(c.coin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#3b82f6", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {c.coin}
                </a>
              ),
            },
            { key: "side", header: "Side", render: (c) => c.side },
            {
              key: "entryExit",
              header: "Entry → Exit",
              render: (c) =>
                `${c.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} → ${c.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
            },
            {
              key: "size",
              header: "Size",
              render: (c) => c.size,
            },
            {
              key: "pnl",
              header: "P&L",
              render: (c) => (
                <span style={{ color: c.realizedPnl >= 0 ? "#22c55e" : "#ef4444" }}>
                  {c.realizedPnl >= 0 ? "+" : ""}
                  {c.realizedPnl.toFixed(2)}
                </span>
              ),
            },
            {
              key: "strategy",
              header: "Strategy",
              render: (c) => {
                const match = closedTrades.find(
                  (t) =>
                    t.coin === c.coin &&
                    t.side === c.side &&
                    Math.abs(t.closed_at - c.closedAt) < 5 * 60 * 1000
                );
                const strat = match?.strategy_reason?.trim();
                return (
                  <div title={strat ?? undefined} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {strat || "—"}
                  </div>
                );
              },
              style: { maxWidth: 160 },
            },
            {
              key: "closed",
              header: "Closed",
              render: (c) => new Date(c.closedAt).toLocaleString(),
              style: { fontSize: "0.85rem" },
            },
          ]}
          data={walletClosed.slice(0, 50)}
          getRowKey={(c) => c.hash}
          selectedKey={selectedCoin}
          onSelect={(c) => setSelectedCoin(c.coin)}
          emptyMessage="No closed positions from wallet (last 90 days)."
        />
      </Section>

      <Section title="CLI Trades by Username">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <Select
            value={tradesUsername}
            onChange={setTradesUsername}
            options={usernames.map((u) => ({ value: u, label: u }))}
            placeholder="Select username…"
            minWidth={220}
          />
        </div>
        <DataTable<HlTrade>
          columns={[
            { key: "coin", header: "Coin", render: (t) => t.coin },
            { key: "side", header: "Side", render: (t) => t.side },
            { key: "entry", header: "Entry", render: (t) => t.entry_price.toLocaleString() },
            {
              key: "exit",
              header: "Exit",
              render: (t) => (t.exit_price != null ? t.exit_price.toLocaleString() : "—"),
            },
            {
              key: "pnl",
              header: "P&L",
              render: (t) =>
                t.realized_pnl != null ? (
                  <span style={{ color: t.realized_pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {t.realized_pnl >= 0 ? "+" : ""}
                    {t.realized_pnl.toFixed(2)}
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              key: "strategy",
              header: "Strategy",
              render: (t) => (
                <div title={t.strategy_reason ?? undefined}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.strategy_reason?.trim() || "unknown"}
                  </div>
                </div>
              ),
              style: { maxWidth: 160 },
            },
            {
              key: "exitReason",
              header: "Exit reason",
              render: (t) => (
                <div title={t.comment ?? undefined}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}>
                    {t.comment?.trim() || (t.closed_at != null ? "—" : "")}
                  </div>
                </div>
              ),
              style: { maxWidth: 200 },
            },
            {
              key: "opened",
              header: "Opened",
              render: (t) => new Date(t.opened_at).toLocaleString(),
              style: { fontSize: "0.85rem" },
            },
          ]}
          data={trades.slice(0, 20)}
          getRowKey={(t) => t.id}
          selectedKey={selectedCoin}
          onSelect={(t) => setSelectedCoin(t.coin)}
          emptyMessage={tradesUsername ? "No trades for this user." : undefined}
        />
      </Section>

      {tradesUsername && (
        <Section title="Closed Positions (CLI)">
          <DataTable<HlTrade>
            columns={[
              {
                key: "coin",
                header: "Coin",
                render: (t) => (
                  <a
                    href={hyperliquidTradeUrl(t.coin)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#3b82f6", textDecoration: "none" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.coin}
                  </a>
                ),
              },
              { key: "side", header: "Side", render: (t) => t.side },
              {
                key: "entryExit",
                header: "Entry → Exit",
                render: (t) =>
                  t.exit_price != null
                    ? `${t.entry_price.toLocaleString()} → ${t.exit_price.toLocaleString()}`
                    : "—",
              },
              {
                key: "pnl",
                header: "P&L",
                render: (t) =>
                  t.realized_pnl != null ? (
                    <span style={{ color: t.realized_pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                      {t.realized_pnl >= 0 ? "+" : ""}
                      {t.realized_pnl.toFixed(2)}
                    </span>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "strategy",
                header: "Strategy",
                render: (t) => (
                  <div title={t.strategy_reason ?? undefined}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.strategy_reason?.trim() || "unknown"}
                    </div>
                  </div>
                ),
                style: { maxWidth: 160 },
              },
              {
                key: "exitReason",
                header: "Exit reason",
                render: (t) => (
                  <div title={t.comment ?? undefined}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}>
                      {t.comment?.trim() || "—"}
                    </div>
                  </div>
                ),
                style: { maxWidth: 200 },
              },
              {
                key: "closed",
                header: "Closed",
                render: (t) =>
                  t.closed_at != null ? new Date(t.closed_at).toLocaleString() : "—",
                style: { fontSize: "0.85rem" },
              },
            ]}
            data={trades.filter((t) => t.closed_at != null).slice(0, 20)}
            getRowKey={(t) => t.id}
            selectedKey={selectedCoin}
            onSelect={(t) => setSelectedCoin(t.coin)}
            emptyMessage="No closed positions for this user."
          />
        </Section>
      )}
    </PageLayout>
  );
}
