# CLAUDE.md — Trader Agent Context

This is a **crypto trading system** against live Hyperliquid perpetual markets. It supports both paper trading (simulated) and real-money automated trading. A new agent should be able to read this file and start trading.

## Quick Start

### Paper Trading (simulated, no real money)

```bash
npm run server                    # Start Express + SQLite backend (port 3000)
npx tsx src/cli.ts scan           # Scan all coins for signals
npx tsx src/cli.ts -u claude-opus-20260216-1530 buy -c BTC -s 0.01 -S trend -m "RULE 3: reason"
npx tsx src/cli.ts -u claude-opus-20260216-1530 list # See positions
```

**Username convention:** Always use `{model}-{YYYYMMDD}-{HHMM}` for paper trading sessions. Examples: `claude-opus-20260216-1530`, `qwen-20260217-0900`, `llama-20260218-1400`. This identifies which model agent opened the trades and when the session started.

### Real-Money Trading (automated agent)

```bash
# 1. Set up credentials in hyperliquid-trader/.env:
#    HYPERLIQUID_PRIVATE_KEY=0x...       (agent wallet key)
#    HYPERLIQUID_ACCOUNT_ADDRESS=0x...   (main wallet address)

# 2. Dry-run first (no real trades)
npx tsx hyperliquid-trader/src/agent.ts --dry-run --interval 1 --verbose

# 3. Live trading
npx tsx hyperliquid-trader/src/agent.ts --interval 5 --verbose
```

The agent runs R1-R6 entry rules and EXIT 1-5 exit rules in a loop. It sends authenticated push notifications to `ntfy.sh/$NTFY_CHANNEL` every cycle and writes a full session log to `logs/`.

---

## Architecture

| Component | Purpose | Location |
|-----------|---------|----------|
| Paper trading backend | Express + SQLite, positions/stats | `npm run server` → port 3000 |
| Paper trading CLI | Manual trades, indicators, scan | `npx tsx src/cli.ts` |
| Real trading agent | Automated loop, live perps | `npx tsx hyperliquid-trader/src/agent.ts` |
| Real trading CLI | Manual real trades | `npx tsx hyperliquid-trader/src/cli.ts` |
| Indicators | RSI, MACD, BB, ATR, ADX | `src/lib/indicators.ts` |
| Strategy engine | Signal computation, entries/exits | `hyperliquid-trader/src/strategy.ts` |
| Backtest engine | Historical rule validation | `src/lib/backtest.ts` |
| ML scorer | Empirical win-probability from trade history | `hyperliquid-trader/ml/scorer.py` + `src/scorer.ts` |
| Backtest export | Generates ML training data from candle history | `hyperliquid-trader/src/backtest-export.ts` |

## Hyperliquid Account

- **Unified account** — Spot and Perp share one balance. No spot↔perp transfers needed.
- Use an **agent wallet** (trade-only, no withdrawals) from app.hyperliquid.xyz/API
- Set `HYPERLIQUID_ACCOUNT_ADDRESS` to your main wallet (where USDC lives)
- The automated agent handles unified accounts — checks spot USDC when perp shows $0

---

## Trading Rules

**CRITICAL: 1h is the PRIMARY timeframe for ALL decisions. 15m is ONLY for entry timing.**

### Regime Detection (1h indicators)

| 1h Regime | 1h ADX | Strategy | Rules |
|-----------|--------|----------|-------|
| `trending` / `volatile_trend` | > 25 | Trend following | R3, R4 |
| `quiet` / `ranging` | < 20 | Mean reversion | R1, R2 |
| Transitional | 20-25 | Cautious / half size | Any |
| Squeeze (BB width < 0.01) | any | Breakout | R5 (disabled) |

**NEVER apply trend rules in quiet/ranging regime. NEVER apply mean-reversion in trending regime.**

### Entry Rules

**RULE 1 — RSI Oversold Bounce (long):** RSI < 30, regime NOT trending. Strategy: `mean-reversion`

**RULE 2 — RSI Overbought Fade (short):** RSI > 70, regime NOT trending. Strategy: `mean-reversion`

**RULE 3 — Trend Follow Long:** ADX > 25, +DI > -DI, RSI > 45, MACD histogram > 0. Strategy: `trend`
- RSI threshold lowered from 50→45 based on near-miss data (64% of skips at RSI 47-49 were winners)
- **Sentiment-assisted:** When strong bullish sentiment (galaxy>70 or sentiment>=80%), RSI accepted down to 40 (confidence 0.55)

**RULE 4 — Trend Follow Short:** ADX > 22 (with DI spread > 8) or ADX > 25, -DI > +DI, RSI < 50, MACD histogram < 0.05. Strategy: `trend`
- **This is the dominant winner** — 63% win rate in backtests, positive on all coins
- ADX threshold lowered from 25→22 (with DI spread > 8): near-miss data showed HYPE R4-shorts at ADX 20-24 consistently won +0.5-1.6%. Slight confidence discount (-0.05) for ADX 22-25 entries.
- Low-price coins (DOGE, SUI): MACD hist may be ~0. If ADX > 35 and DI spread > 10, treat as passing.

**RULE 5 — Bollinger Squeeze Breakout:** Two-step: width < 0.01 (squeeze forming), then width > 0.015 + price outside bands.
- **Disabled in automated agent** (confidence below threshold) — consistent backtest loser

**RULE 6 — Sentiment-Confirmed:** Extreme LunarCrush sentiment + DI pointing in the right direction. Strategy: `sentiment-confirmed`
- **Long:** Galaxy > 75 AND sentiment >= 85% AND +DI > -DI AND RSI 40-65
- **Short:** Galaxy < 30 OR sentiment <= 15% AND -DI > +DI AND RSI 35-60
- Confidence: 0.52 (just above threshold — speculative). Scale: 0.3 (30% allocation).
- Exchange TP/SL: tighter stops (-1.5%) since less technical backing.
- Near-miss data showed 61% of sentiment-only signals were winners — this rule captures them at reduced size.

### Exit Rules (checked every cycle, 1h only)

**EXIT 1 — Trailing Stop:** Widened to let winners run (previous settings closed at +0.26% avg while stoploss fired at -2%).
- **Volatile coins** (MOODENG/TAO/HYPE/WIF/POPCAT/DOGE/SUI): arm +2.0%, trigger +0.8%, cap +5%
- **Big caps** (BTC/ETH/SOL): arm +1.2%, trigger +0.5%, cap +3%

**EXIT 2 — Stop Loss:**
- **R3-long:** -1.5% (tighter — R3 has only ~50% win rate, limits damage per loss)
- **R4/R6/others:** -2% of notional

**EXIT 3 — Signal Reversal (1h only):**
- Trend position + ADX < 20 → close (ADX collapse)
- Long + -DI > +DI → close (DI flip)
- Short + +DI > -DI → close (DI flip)
- Long + RSI > 70 → close (overbought)
- Short + RSI < 30 → close (oversold)

**EXIT 4 — Time Stop:** Open > 4 hours + PnL between -0.5% and +0.5% → close (going nowhere).

**WARNING:** NEVER exit a 1h trend trade because 15m ADX dropped. This is normal consolidation, not reversal. This mistake caused -$146 in a previous session.

### Contrarian Mode (fade-the-crowd)

When enabled (`--contrarian-pct N`, default 20%), the agent allocates a portion of trades to go AGAINST extreme crowd sentiment. This is a proven institutional strategy — fading euphoria and buying panic.

**Triggers (all three required):**
1. **Sentiment extreme:** LunarCrush sentiment >= 85% (euphoria) or <= 20% (panic)
2. **RSI stretched:** >= 65 for longs (overbought) or <= 35 for shorts (oversold)
3. **Probability gate:** Random roll against `CONTRARIAN_PCT` — not every qualifying signal flips

**Signal transformation:** When triggered, the original R1-R5 signal is inverted:

| Original | Contrarian | When |
|----------|------------|------|
| R3 trend long | C-R3 short | Sentiment > 85% + RSI > 65 |
| R4 trend short | C-R4 long | Sentiment < 20% + RSI < 35 |
| R1/R2 | C-R1/C-R2 | Same sentiment extremes |

**Sizing & confidence:**
- Confidence: original × 0.6 (minimum 0.4 to take the trade)
- Position scale: 0.4 (40% of normal allocation)
- Max contrarian positions: `ceil(MAX_POSITIONS × CONTRARIAN_PCT / 100)`

**Tighter exits:** Contrarian trades use faster stops since fades should resolve quickly:
- Trailing: arm +0.5%, trigger +0.2%, cap +1.5% (vs +0.8%/+0.3%/+2% normal)
- Stop loss: -1.5% (vs -2%)
- Time stop: 2 hours (vs 4 hours)

**Tracking:** Contrarian wins/losses are tracked separately and reported alongside the main record in all notifications. Rule labels are prefixed with `C-` (e.g. `C-R3-trend`). Strategy type is `"contrarian"`.

---

## Automated Agent Configuration

Default settings (adjustable via CLI flags):

| Setting | Default | Description |
|---------|---------|-------------|
| `--max-positions` | 3 | Max simultaneous positions |
| `--max-alloc` | 20 | Max % of balance per trade |
| `--leverage` | 3 | Leverage for new positions |
| `--circuit-breaker` | 30 | Session loss limit in USD |
| `--contrarian-pct` | 20 | % of qualifying signals to flip contrarian (0=off) |
| `--interval` | 5 | Loop interval in minutes |
| `--session-hours` | 24 | Auto-shutdown |
| `--coins` | BTC,ETH,SOL,SUI,DOGE | Coins to scan |

### Position Sizing (at $210 balance, 20%, 3x)

| Rule | Scale | Margin | Notional |
|------|-------|--------|----------|
| R4 (trend short) | 1.0 | $42 | $126 |
| R3 (trend long) | 0.7 | $29 | $88 |
| R1/R2 (mean-reversion) | 0.6 | $25 | $76 |
| R5 (breakout) | 0.5 | $21 | $63 |
| Contrarian (C-R*) | 0.4 | $17 | $50 |
| R6 (sentiment-confirmed) | 0.3 | $13 | $38 |

Minimum notional: $10. Minimum balance for new entries: $20.

### Agent Loop

1. Fetch balance + positions
2. Fetch sentiment from LunarCrush (advisory, non-fatal if unavailable)
3. Run sentiment discovery — scan all crypto for extreme sentiment, auto-add to scan list if on Hyperliquid
4. For each open position: compute 1h indicators → check exit rules → close if triggered
5. If room for more positions: scan each coin + dynamic coins (1h+15m) → evaluate entry signals → open best signal
6. Circuit breaker: if total session loss exceeds limit → close all + stop
7. Send ntfy notifications for every trade open/close
8. Hourly summary every 12th cycle
9. Sleep for interval, repeat

### Sentiment (LunarCrush)

The agent uses LunarCrush API v4 for social sentiment as an **advisory layer** — it boosts confidence on technical signals when sentiment aligns, and tracks sentiment-only signals as near-misses.

**Setup:** Add `LUNARCRUSH_API_KEY` to `hyperliquid-trader/.env`. Get a key at https://lunarcrush.com/developers. If missing, the agent runs without sentiment (doctor warns but doesn't block).

**Sentiment throttling:** In normal mode, sentiment is fetched 3x/hour (every 7th cycle at 3-min intervals). In high-volatility mode (sleepMultiplier < 1), sentiment is fetched every cycle but in lean mode — only the watchlist coins, no discovery scan.

**Sentiment discovery:** On normal-mode sentiment cycles, the agent also scans the full LunarCrush coin list for extreme outliers (galaxy >= 80, sentiment >= 95% or <= 15%, alt rank <= 10) that aren't in the base coin list. If they exist on Hyperliquid, they're temporarily added to the scan list. When sentiment normalizes, they're removed. Discovery is skipped in high-vol lean mode.

**MCP Server (for Claude Code sessions):** A LunarCrush MCP server is configured in `.mcp.json` for interactive sentiment research during Claude Code conversations. It uses the env var `LUNARCRUSH_MCP` (set in root `.env`) for the connection URL. **On first session start, check that the LunarCrush MCP connection is active — if not, notify the user to activate it in their MCP settings.** The MCP tools are conversation-time only (not available to the Node.js agent runtime).

#### Using the MCP effectively

**COMPUTE BUDGET WARNING: MCP calls are expensive. Each call consumes significant context and API quota. Make as few calls as possible per session — ideally 1-3 total for a research request. Never call MCP speculatively or "just to check". Always ask: can I answer this from the agent's own sentiment data or a previous MCP response first?**

The MCP returns large payloads. Follow these rules to avoid flooding context:

- **Max 3 MCP calls per user request.** Plan what you need before calling. Do not chain calls unnecessarily.
- **Be surgical.** Use `Topic` for a single coin deep-dive, `Cryptocurrencies` with a `sort` + small `limit` (10-20) for ranked lists. Never pull the full 1000-coin list.
- **Focus on extremes.** The actionable data is at the edges: sort by `galaxy_score` desc (top momentum), `sentiment` asc (contrarian oversold), `alt_rank` asc (rising stars), or `interactions` desc (social volume spikes). Middle-of-the-road data is noise.
- **Cross-reference with the trading coin list.** After pulling a ranked list, filter to coins tradeable on Hyperliquid. Flag any that overlap with the agent's active or discovery coins.
- **Summarize, don't dump.** When the user asks for sentiment data, return a compact table (coin, galaxy, sentiment%, alt rank, one-line signal) — not raw API output. Cap at ~15 rows.
- **Use `Topic_Time_Series` sparingly.** Only when the user asks about a specific coin's trend over time. Use `1w` or `1m` intervals, pick 2-3 metrics max (e.g. `galaxy_score`, `sentiment`, `close`).
- **`Topic_Posts` for narratives.** When a coin has extreme sentiment, pull top posts (`1d` interval) to understand _why_ — is it a rumor, partnership, exploit, or meme? Summarize the top 3-5 posts in one line each.
- **Discovery workflow:** `Cryptocurrencies` sorted by `galaxy_score` desc limit 20 → filter to Hyperliquid-listed → `Topic` on any standouts → report to user with trading relevance.
- **Never use `Topic` for a coin the agent's sentiment data already covers** — just read `currentSentiment[]` from the log output instead.

**Key module:** `hyperliquid-trader/src/sentiment.ts` — exports `fetchSentiment()`, `detectSentimentSignals()`, `discoverSentimentCoins()`.

### Notifications (ntfy.sh)

All notifications go to **`ntfy.sh/$NTFY_CHANNEL`** (read from env, set by start-erde) with authentication and rich formatting. Notifications should have **personality** — be concise but human, use emoji naturally, and make the feed enjoyable to read.

#### Setup

`.env` must contain:
```
NTFY_CHANNEL=your-channel   # ntfy channel name (set by start-erde)
NTFY_TOKEN=tk_...           # ntfy access token (required)
```

#### How to Publish

**Always use these headers** — plain-text posts without headers are not acceptable.
**Always read channel from `$NTFY_CHANNEL` env var — never hardcode a channel name.**

```bash
curl -s \
  -H "Authorization: Bearer $NTFY_TOKEN" \
  -H "Title: Short descriptive title" \
  -H "Priority: default" \
  -H "Tags: emoji_shortcode1,emoji_shortcode2" \
  -H "Markdown: yes" \
  -d 'Markdown body here' \
  "https://ntfy.sh/${NTFY_CHANNEL}"
```

```typescript
await fetch(`https://ntfy.sh/${process.env.NTFY_CHANNEL}`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.NTFY_TOKEN}`,
    "Title": "Short descriptive title",
    "Priority": "default",
    "Tags": "emoji_shortcode1,emoji_shortcode2",
    "Markdown": "yes",
  },
  body: "Markdown body here",
});
```

#### Identity Prefix

**Every notification body starts with this line** to identify the agent:
```
[{agent-name} · {wallet-last-6 OR "no-wallet"} · {Paper Trading | Hyperliquid REAL $ | DRY-RUN}]
```
Examples:
- `[claude-opus-20260216-1530 · no-wallet · Paper Trading]`
- `[claude-opus-20260216-1530 · YOUR_WALLET_SUFFIX · Hyperliquid REAL $]`
- `[qwen-20260217-0900 · YOUR_WALLET_SUFFIX · DRY-RUN]`

#### Formatting Rules

- **Use bullet lists** (`- item`) for all structured data — never markdown tables (they render poorly in ntfy)
- **Use bold** (`**value**`) for key numbers: PnL, prices, percentages
- **Use code** (`` `backticks` ``) for agent names and technical identifiers
- **Use italics** (`_text_`) for commentary, color, personality
- **Use code blocks** only for raw position dumps in hourly summaries
- **Have personality** — brief quips, natural emoji, make it fun to read

#### PnL — Critical

**NEVER compute PnL from scan prices** — scan output truncates decimals (DOGE shows `0.1` not `0.101025`). Always pull PnL from the **position list output** which has accurate `ROE%` and `USDC` values from the server.

#### Templates

Full notification templates with examples are in `knowledge/ntfy-templates.md`. Load that file only if modifying notification formatting. The templates are already implemented in `agent.ts` notify() function.

**Priority:** `high` for circuit breaker, crashes, losses > $10. `default` for everything else. Never `urgent`.

**Notification frequency:** Per-cycle status updates are only sent when a trade opens or closes. Quiet cycles (no trades) are silent — all data still goes to the log file. Hourly summaries, trade notifications, circuit breaker, and session start/stop always send. Every notification includes the session **Record** (wins/losses/win rate %) and **near-miss accuracy** when available.

### Logging

Full session log written to `logs/claude-opus-YYYY-MM-DDTHH-MM-SS.log` (gitignored). Contains all indicator values, signals, order results, errors with stack traces, and ntfy messages.

### Graceful Shutdown

Ctrl+C (SIGINT) logs positions but does NOT auto-close them. Positions persist on Hyperliquid.

---

## Backtest Results (14-day, 1h candles)

| Rule | Win Rate | Notes |
|------|----------|-------|
| R4 trend short | 63% avg | **Best rule** — positive on all coins |
| R3 trend long | ~50% | Breakeven, use cautiously |
| R1/R2 mean-reversion | Rarely triggers | RSI rarely hits 30/70 |
| R5 breakout | Consistent loser | Avoid (disabled in agent) |

**Best coins by Sharpe:** SUI (9.8), DOGE (8.4), SOL (4.7), AVAX (1.5), BTC (0.95)
**Worst coins:** ETH (-1.07), LINK (-0.81) — avoid for trend trades

**Correlation** across BTC/ETH/SOL/DOGE/SUI/LINK/AVAX is ~0.81. Seven shorts ≈ 1.5 real bets. Consolidate to top 3 by Sharpe.

---

## ML Confidence Scorer

The agent uses a local `RandomForestClassifier` to produce an empirical win-probability for each entry signal, blended with the hand-tuned rule confidence.

### How It Works

```
backtest-export.ts → ml/data/backtest_export.jsonl ─┐
                                                      ├→ scorer.py --mode train → ml/model/confidence_model.pkl
hl_trades.indicators_json (live closes) ─────────────┘
                                                       ↓
agent.ts checkEntries():
  evaluateEntrySignals() → ruleConf 0.70
  scorer.ts scoreTrade() → mlScore 0.68   (3s timeout, non-blocking)
  blendConfidence()       → finalConf 0.726
  finalConf >= 0.5        → enter
```

**Blending formula:** `mlWeight = min(samples / 500, 0.6)` — ML influence grows from 0% (no model) to 60% (500+ live trades). At cold start (backtest only, ~217 samples), ML weight ≈ 43%. Rule confidence always has at least 40% weight.

**Cold-start accuracy:** ~53% on bootstrap data (expected — R3/R4 at ~51-55% on backtest 2x TP/SL). Improves as live trades accumulate. Model is **always advisory** — a bad score can't drop a strong signal below the 0.5 threshold if the rule confidence is high enough.

### First-Time Setup (run once per machine)

```bash
# 1. Create Python venv + install scikit-learn
bash hyperliquid-trader/ml/setup.sh

# 2. Generate ~200-500 backtest training samples (takes ~60s)
npx tsx hyperliquid-trader/src/backtest-export.ts

# 3. Train the model
hyperliquid-trader/ml/.venv/bin/python3 hyperliquid-trader/ml/scorer.py \
  --mode train --data hyperliquid-trader/ml/data/backtest_export.jsonl

# 4. Smoke test
echo '{"coin":"BTC","side":"short","rule":"R4-trend","adx":28,"plus_di":18,"minus_di":31,
  "rsi":44,"macd_histogram":-0.002,"bb_width":0.045,"atr_pct":0.008,
  "regime":"trending","galaxy_score":55,"sentiment_pct":48,"alt_rank":120}' | \
  hyperliquid-trader/ml/.venv/bin/python3 hyperliquid-trader/ml/scorer.py --mode score
# Expected: {"score": 0.3-0.7, "modelSamples": ~217}
```

**The agent works fine without the model** — if `ml/model/confidence_model.pkl` is missing, `scoreTrade()` returns `{score: null}` and blending is skipped. Doctor check #13 warns if model is absent.

### Live Learning (automatic)

- Every trade close appends to `ml/data/live_trades.jsonl` (entry indicators + won/lost)
- Every 5 closed live trades, `triggerRetrain()` is called in the hourly cycle — updates the model in the background
- DB `hl_trades.indicators_json` stores entry indicator snapshot for future retraining
- Re-export backtest data periodically (`backtest-export.ts`) to refresh the bootstrap set

### Feature Vector (15 features)

| Feature | Source |
|---------|--------|
| `adx`, `plus_di`, `minus_di`, `di_spread` | 1h ADX indicators |
| `rsi`, `macd_histogram`, `bb_width`, `atr_pct` | 1h other indicators |
| `regime_encoded`, `side_encoded`, `rule_encoded`, `coin_encoded` | Categorical |
| `galaxy_score`, `sentiment_pct`, `alt_rank_norm` | LunarCrush (0 if unavailable) |

### Notifications

- **Trade open:** Shows `ML score: 0.65 → blended conf 0.72`
- **Near-miss report (hourly):** Shows "ML disagreements — model wanted in but rule said no: X of Y, Z% would have won"
- **Doctor check:** `ML Scorer: ok — 217 samples (acc: 53.0%, trained 2026-02-18)`
- **Verbose log:** `BTC: ML=0.65 samples=217 → conf 0.70 → 0.72`

### Accuracy Progression

| Phase | Samples | Expected Accuracy |
|-------|---------|-------------------|
| Cold start (backtest) | ~217 | 53-57% |
| Early live | 217 BT + 50 live | 56-62% |
| Growing | 217 BT + 200 live | 62-67% |
| Mature | 500+ live | 65-70% |

### Key Files

| File | Purpose |
|------|---------|
| `hyperliquid-trader/ml/scorer.py` | Python train + score (stdin/stdout JSON) |
| `hyperliquid-trader/ml/requirements.txt` | scikit-learn 1.5.2, numpy 1.26.4, joblib 1.4.2 |
| `hyperliquid-trader/ml/setup.sh` | Creates `.venv`, installs deps |
| `hyperliquid-trader/ml/data/backtest_export.jsonl` | Bootstrap training data (gitignored) |
| `hyperliquid-trader/ml/data/live_trades.jsonl` | Live trade outcomes (gitignored) |
| `hyperliquid-trader/ml/model/confidence_model.pkl` | Trained model (gitignored) |
| `hyperliquid-trader/ml/model/training_meta.json` | Sample count, accuracy, train date (gitignored) |
| `hyperliquid-trader/src/scorer.ts` | Node wrapper: `scoreTrade()`, `blendConfidence()`, `triggerRetrain()` |
| `hyperliquid-trader/src/backtest-export.ts` | CLI: candle replay → JSONL |

---

## Paper Trading CLI Reference

```bash
# Market data (no -u needed)
npx tsx src/cli.ts price -c BTC,ETH,SOL
npx tsx src/cli.ts indicators -c BTC -i 1h
npx tsx src/cli.ts scan                          # All coins, both timeframes
npx tsx src/cli.ts backtest -c BTC -d 14         # 14-day backtest
npx tsx src/cli.ts correlate                     # Correlation matrix

# Trading (requires -u <username>)
npx tsx src/cli.ts -u claude buy -c ETH -s 5.0 -S trend -m "RULE 3: reason"
npx tsx src/cli.ts -u claude sell -c BTC -s 0.175 -S trend -m "RULE 4: reason"
npx tsx src/cli.ts -u claude list                # Open positions
npx tsx src/cli.ts -u claude close --id <id>     # Close by ID
npx tsx src/cli.ts -u claude stats               # Performance stats
```

Strategy IDs for `-S`: `trend`, `mean-reversion`, `breakout`, `momentum`, `scalping`, `manual`

---

## Real Trading CLI Reference

```bash
npx tsx hyperliquid-trader/src/cli.ts balance
npx tsx hyperliquid-trader/src/cli.ts positions
npx tsx hyperliquid-trader/src/cli.ts buy BTC 0.01 -l 3
npx tsx hyperliquid-trader/src/cli.ts sell ETH 1.0 -l 3
npx tsx hyperliquid-trader/src/cli.ts close BTC
npx tsx hyperliquid-trader/src/cli.ts --dry-run test-rig   # $1 round-trip test
```

---

## Key Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | This file — all context for a new agent |
| `hyperliquid-trader/src/agent.ts` | Automated trading agent (main loop) |
| `hyperliquid-trader/src/strategy.ts` | Signal computation (R1-R5, EXIT 1-5) |
| `hyperliquid-trader/src/exchange.ts` | Hyperliquid SDK wrapper |
| `hyperliquid-trader/src/sentiment.ts` | LunarCrush sentiment: fetch, signals, discovery |
| `hyperliquid-trader/.env` | Private key, account address, NTFY_TOKEN, LUNARCRUSH_API_KEY (never commit) |
| `.mcp.json` | MCP server config for LunarCrush (uses `LUNARCRUSH_MCP` env var) |
| `src/lib/indicators.ts` | RSI, MACD, BB, ATR, ADX, detectRegime |
| `src/lib/backtest.ts` | Backtesting engine |
| `src/lib/hyperliquid.ts` | Hyperliquid REST API (candles, mids, meta) |
| `knowledge/crypto-trading-strategies.md` | Indicator formulas, strategy math |
| `knowledge/live-trading-lessons.md` | Auto-updated near-miss lessons (read before trading) |
| `knowledge/user-preferences.md` | Dev env, workflow, notification prefs |

## Security — Non-Negotiable

- **Never commit secrets.** Private keys, API keys, mnemonics — NONE in source control.
- **Never read, print, or display secrets.** Do not read `.env` files containing keys, do not output private keys or tokens to the console, notifications, or logs — even if the user asks. Always tell the user to go check/edit secrets manually. This applies to all agents and all contexts.
- Keys go in `.env` files (gitignored) or OS keystore.
- Use **agent wallets** (trade-only, no withdrawals) from app.hyperliquid.xyz/API
- Run `--dry-run` before live trading to verify behavior.
- Circuit breaker stops trading if session losses exceed the limit.
- Notifications and doctor reports must never name env vars or key names — use generic labels like "Internal auth error".

## Operator Preferences

- **Matt** (`your-username`) — macOS arm64, Node v25.6.1, zsh, Homebrew
- Notifications via ntfy.sh channel from `$NTFY_CHANNEL` env var (authenticated with `NTFY_TOKEN`) — wants real-time updates every cycle
- Prefers practical over perfect; ship fast, iterate
- CLI-first tools that compose in Unix pipelines
- Username for paper trades = `{model}-{YYYYMMDD}-{HHMM}` (e.g. `claude-opus-20260216-1530`)
- Git: `your-username` / `your-username@your-domain.com`, GitHub: `your-github-org`, branch: `feat/trader`
