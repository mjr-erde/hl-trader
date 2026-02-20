/**
 * LunarCrush sentiment module.
 * Fetches social sentiment data and detects actionable signals.
 * Advisory only — does not directly trigger trades.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SentimentSnapshot {
  coin: string;
  galaxyScore: number;       // 0-100 composite (price momentum + social + sentiment + correlation)
  sentiment: number;          // 0-100 (% positive posts)
  socialVolume: number;       // total posts in 24h
  interactions24h: number;    // likes/comments/shares in 24h
  socialDominance: number;    // % of total crypto social volume
  altRank: number;            // cross-coin rank, lower = more momentum
  fetchedAt: number;          // timestamp
}

export interface SentimentSignal {
  coin: string;
  type: "bullish" | "bearish" | "alert";
  strength: "strong" | "moderate";
  reason: string;
  snapshot: SentimentSnapshot;
}

// ── Coin name mapping ────────────────────────────────────────────────────────

// Hyperliquid uses ticker symbols (BTC, ETH) but LunarCrush uses full names or
// different identifiers. This maps our coin tickers to LunarCrush symbols.
const COIN_TO_LC: Record<string, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  SUI: "SUI",
  DOGE: "DOGE",
  MOODENG: "MOODENG",
  TAO: "TAO",
  HYPE: "HYPE",
  WIF: "WIF",
  POPCAT: "POPCAT",
  AVAX: "AVAX",
  LINK: "LINK",
};

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch sentiment for all coins in one API call, filter to our watchlist.
 * Uses LunarCrush API v4 bulk endpoint (~1 credit per call).
 */
export async function fetchSentiment(coins: string[]): Promise<SentimentSnapshot[]> {
  const apiKey = process.env.LUNARCRUSH_API_KEY;
  if (!apiKey) {
    throw new Error("LUNARCRUSH_API_KEY not set");
  }

  const resp = await fetch("https://lunarcrush.com/api4/public/coins/list/v1", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`LunarCrush API error: HTTP ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json() as { data?: Array<Record<string, unknown>> };
  const allCoins = json.data;
  if (!Array.isArray(allCoins)) {
    throw new Error("LunarCrush API returned unexpected format (no data array)");
  }

  // Build a set of LunarCrush symbols we're interested in
  const lcSymbols = new Map<string, string>(); // LC symbol → our coin ticker
  for (const coin of coins) {
    const lcSym = COIN_TO_LC[coin] ?? coin;
    lcSymbols.set(lcSym.toUpperCase(), coin);
  }

  const now = Date.now();
  const snapshots: SentimentSnapshot[] = [];

  for (const entry of allCoins) {
    const symbol = String(entry.symbol ?? "").toUpperCase();
    const ourCoin = lcSymbols.get(symbol);
    if (!ourCoin) continue;

    snapshots.push({
      coin: ourCoin,
      galaxyScore: Number(entry.galaxy_score ?? 0),
      sentiment: Number(entry.sentiment ?? 0),
      socialVolume: Number(entry.social_volume_24h ?? 0),
      interactions24h: Number(entry.interactions_24h ?? 0),
      socialDominance: Number(entry.social_dominance ?? 0),
      altRank: Number(entry.alt_rank ?? 999),
      fetchedAt: now,
    });

    lcSymbols.delete(symbol); // found it
  }

  return snapshots;
}

// ── Signal Detection ─────────────────────────────────────────────────────────

/**
 * Compare current vs previous snapshot to detect actionable changes.
 * Returns signals when sentiment metrics shift significantly.
 */
export function detectSentimentSignals(
  current: SentimentSnapshot[],
  previous: SentimentSnapshot[],
): SentimentSignal[] {
  if (previous.length === 0) return []; // need baseline

  const prevMap = new Map<string, SentimentSnapshot>();
  for (const s of previous) prevMap.set(s.coin, s);

  const signals: SentimentSignal[] = [];

  for (const cur of current) {
    const prev = prevMap.get(cur.coin);

    // Galaxy score spike: jumped 20+ pts
    if (prev && cur.galaxyScore - prev.galaxyScore >= 20) {
      signals.push({
        coin: cur.coin,
        type: "bullish",
        strength: cur.galaxyScore - prev.galaxyScore >= 30 ? "strong" : "moderate",
        reason: `Galaxy score spiked to ${cur.galaxyScore} (was ${prev.galaxyScore}, +${cur.galaxyScore - prev.galaxyScore})`,
        snapshot: cur,
      });
    }

    // Galaxy score crash: dropped 20+ pts
    if (prev && prev.galaxyScore - cur.galaxyScore >= 20) {
      signals.push({
        coin: cur.coin,
        type: "bearish",
        strength: prev.galaxyScore - cur.galaxyScore >= 30 ? "strong" : "moderate",
        reason: `Galaxy score crashed to ${cur.galaxyScore} (was ${prev.galaxyScore}, ${cur.galaxyScore - prev.galaxyScore})`,
        snapshot: cur,
      });
    }

    // Extreme bullish sentiment: > 80% positive + social volume surge
    if (cur.sentiment > 80 && prev && prev.socialVolume > 0 && cur.socialVolume > prev.socialVolume * 2) {
      signals.push({
        coin: cur.coin,
        type: "bullish",
        strength: cur.sentiment > 90 ? "strong" : "moderate",
        reason: `Extreme bullish sentiment ${cur.sentiment}% with ${cur.socialVolume.toLocaleString()} social volume (${(cur.socialVolume / prev.socialVolume).toFixed(1)}x previous)`,
        snapshot: cur,
      });
    }

    // Extreme bearish sentiment: < 30%
    if (cur.sentiment > 0 && cur.sentiment < 30) {
      signals.push({
        coin: cur.coin,
        type: "bullish", // contrarian
        strength: cur.sentiment < 20 ? "strong" : "moderate",
        reason: `Contrarian: sentiment only ${cur.sentiment}% positive (socially oversold)`,
        snapshot: cur,
      });
    }

    // Social volume surge: 3x previous reading
    if (prev && prev.socialVolume > 0 && cur.socialVolume > prev.socialVolume * 3) {
      signals.push({
        coin: cur.coin,
        type: "alert",
        strength: cur.socialVolume > prev.socialVolume * 5 ? "strong" : "moderate",
        reason: `Social volume surge: ${cur.socialVolume.toLocaleString()} (${(cur.socialVolume / prev.socialVolume).toFixed(1)}x previous)`,
        snapshot: cur,
      });
    }

    // Alt rank surge: improved by 50+ positions
    if (prev && prev.altRank - cur.altRank >= 50) {
      signals.push({
        coin: cur.coin,
        type: "bullish",
        strength: prev.altRank - cur.altRank >= 100 ? "strong" : "moderate",
        reason: `Alt rank surged to #${cur.altRank} (was #${prev.altRank}, improved ${prev.altRank - cur.altRank} positions)`,
        snapshot: cur,
      });
    }
  }

  return signals;
}

// ── Discovery ───────────────────────────────────────────────────────────────

export interface SentimentDiscovery {
  coin: string;
  reason: string;
  snapshot: SentimentSnapshot;
}

/**
 * Scan the FULL LunarCrush coin list for extreme sentiment signals — coins NOT
 * already in our watchlist that are worth considering this cycle.
 *
 * Returns coins where:
 * - Galaxy score >= 80 (top-tier composite momentum)
 * - Sentiment >= 95% or <= 15% (extreme crowd positioning)
 * - Alt rank <= 10 (top momentum across all crypto)
 *
 * Caller must validate that returned coins actually exist on Hyperliquid.
 */
export async function discoverSentimentCoins(
  excludeCoins: string[],
): Promise<SentimentDiscovery[]> {
  const apiKey = process.env.LUNARCRUSH_API_KEY;
  if (!apiKey) return [];

  const resp = await fetch("https://lunarcrush.com/api4/public/coins/list/v1", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) return [];

  const json = await resp.json() as { data?: Array<Record<string, unknown>> };
  const allCoins = json.data;
  if (!Array.isArray(allCoins)) return [];

  const excludeSet = new Set(excludeCoins.map((c) => c.toUpperCase()));
  const discoveries: SentimentDiscovery[] = [];
  const now = Date.now();

  for (const entry of allCoins) {
    const symbol = String(entry.symbol ?? "").toUpperCase();
    if (!symbol || excludeSet.has(symbol)) continue;

    const galaxy = Number(entry.galaxy_score ?? 0);
    const sentiment = Number(entry.sentiment ?? 0);
    const altRank = Number(entry.alt_rank ?? 999);
    const socialVol = Number(entry.social_volume_24h ?? 0);
    const interactions = Number(entry.interactions_24h ?? 0);

    const reasons: string[] = [];
    if (galaxy >= 80) reasons.push(`galaxy=${galaxy}`);
    if (sentiment >= 95) reasons.push(`sentiment=${sentiment}% (extreme bullish)`);
    if (sentiment > 0 && sentiment <= 15) reasons.push(`sentiment=${sentiment}% (extreme bearish — contrarian)`);
    if (altRank <= 10) reasons.push(`alt_rank=#${altRank}`);

    if (reasons.length === 0) continue;

    discoveries.push({
      coin: symbol,
      reason: reasons.join(", "),
      snapshot: {
        coin: symbol,
        galaxyScore: galaxy,
        sentiment,
        socialVolume: socialVol,
        interactions24h: interactions,
        socialDominance: Number(entry.social_dominance ?? 0),
        altRank,
        fetchedAt: now,
      },
    });
  }

  // Sort by galaxy score descending, cap at 10 candidates
  discoveries.sort((a, b) => b.snapshot.galaxyScore - a.snapshot.galaxyScore);
  return discoveries.slice(0, 10);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a snapshot as a table row for CLI display */
export function formatSnapshotRow(s: SentimentSnapshot): string {
  return [
    s.coin.padEnd(10),
    String(s.galaxyScore).padStart(6),
    `${s.sentiment}%`.padStart(10),
    s.socialVolume.toLocaleString().padStart(12),
    String(s.altRank).padStart(10),
  ].join("  ");
}

/** Table header for CLI display */
export function snapshotTableHeader(): string {
  return [
    "Coin".padEnd(10),
    "Galaxy".padStart(6),
    "Sentiment".padStart(10),
    "Social Vol".padStart(12),
    "Alt Rank".padStart(10),
  ].join("  ");
}
