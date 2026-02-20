# Crypto Trading & Derivatives: Complete Reference

_Comprehensive reference covering Hyperliquid mechanics, options pricing mathematics, trading strategies with formulas, and risk management. Last updated: 2026-02-15._

---

## Table of Contents

1. [Hyperliquid Exchange](#1-hyperliquid-exchange)
2. [Core Trade Types in Crypto Markets](#2-core-trade-types-in-crypto-markets)
3. [Options Pricing Mathematics](#3-options-pricing-mathematics)
4. [Trading Strategies with Math](#4-trading-strategies-with-math)
5. [Risk Management Mathematics](#5-risk-management-mathematics)
6. [Profitability Factors](#6-profitability-factors)

---

## 1. Hyperliquid Exchange

### 1.1 Overview

Hyperliquid is a high-performance L1 blockchain (HyperEVM) purpose-built for on-chain trading. It runs a fully on-chain order book (Central Limit Order Book / CLOB) — no off-chain matching. The chain uses a custom consensus algorithm (HyperBFT) achieving sub-second finality and ~100k orders/second throughput.

### 1.2 Products Available

| Product | Description | Status |
|---------|-------------|--------|
| **Perpetual Futures** | Leveraged perps on 100+ assets, up to 50x leverage | Live (core product) |
| **Spot Trading** | Native spot markets with on-chain order book | Live |
| **Vaults** | On-chain copy-trading / managed strategy vaults | Live |
| **HIP-1 Tokens** | Native token standard on HyperEVM (like ERC-20) | Live |
| **HIP-2 Hyperliquidity** | Protocol-native liquidity provisioning for spot tokens | Live |
| **Options** | **Not natively available** on Hyperliquid as of early 2026 | N/A |

**Note:** Hyperliquid does NOT offer options trading. For crypto options, see Section 1.8 (Deribit, Lyra, etc.).

### 1.3 Order Book Mechanics

Hyperliquid uses a **fully on-chain Central Limit Order Book (CLOB)** — the same model as traditional exchanges but executed on-chain with each order and match recorded on the Hyperliquid L1.

**How the order book works:**

- **Bids** (buy orders) are sorted **highest to lowest** price
- **Asks** (sell orders) are sorted **lowest to highest** price
- **Spread** = lowest ask - highest bid
- **Mid-price** = (best_bid + best_ask) / 2

**Order matching:** Price-time priority (FIFO). If two orders are at the same price, the one submitted first gets filled first.

**Order types supported:**

| Order Type | Behavior |
|-----------|----------|
| **Market Order** | Executes immediately at best available price. Pays taker fee. |
| **Limit Order** | Rests on the book at specified price. Pays maker fee (or rebate) when filled. |
| **Stop-Loss (Stop Market)** | Triggers a market order when price hits trigger level. |
| **Stop-Limit** | Triggers a limit order when price hits trigger level. |
| **Take-Profit** | Triggers a market order to close at profit target. |
| **Trailing Stop** | Stop that moves with price at a fixed offset. |
| **Scale Orders** | Multiple limit orders distributed across a price range. |
| **TWAP** | Time-weighted average price — splits large orders over time. |

**Reduce-Only:** An order flag that ensures the order can only reduce (not increase) an existing position. Used for stop-loss and take-profit orders.

**Post-Only (ALO):** Add Liquidity Only — order is rejected if it would immediately match (guarantees maker fee/rebate).

**Good-Til-Cancel (GTC):** Default; order stays on book until filled or cancelled.

**Immediate-or-Cancel (IOC):** Fill what you can immediately, cancel the rest.

### 1.4 Perpetual Futures on Hyperliquid

Perpetual futures ("perps") are synthetic derivatives that track an underlying asset's price without expiry. They use a **funding rate** mechanism to keep the perp price anchored to the spot/index price.

**Key mechanics:**

- **No expiry date** — positions can be held indefinitely (subject to margin/liquidation)
- **Leverage:** 1x to 50x (varies by asset; BTC/ETH up to 50x, smaller assets lower)
- **Cross-margin** or **isolated margin** modes
- **Settlement:** USDC (all PnL and margin denominated in USDC)

**Position PnL:**

```
Long PnL = position_size * (exit_price - entry_price)
Short PnL = position_size * (entry_price - exit_price)

PnL % = PnL / initial_margin = PnL * leverage / notional_value
```

**Notional Value:**

```
notional_value = position_size * mark_price
```

### 1.5 Funding Rates

Funding is a periodic payment between longs and shorts to keep the perpetual price close to the index (spot) price. On Hyperliquid, funding is exchanged **every hour** (some exchanges use 8h).

**Funding Rate Formula:**

```
funding_rate = average_premium_index + clamp(interest_rate - average_premium_index, -0.0005, 0.0005)
```

Where:

```
premium_index = (mark_price - index_price) / index_price
average_premium_index = time-weighted average of premium_index over the funding interval
interest_rate = 0.01% per 8 hours (fixed) = 0.000125% per hour on Hyperliquid
```

**Clamping function:**

```
clamp(x, min, max) = max(min, min(x, max))
```

This clamp limits how much the interest rate component can deviate, keeping funding primarily driven by the premium.

**Funding Payment:**

```
funding_payment = position_notional * funding_rate

Where:
  position_notional = position_size * mark_price
```

**Rules:**
- If `funding_rate > 0`: **longs pay shorts** (perp trading above index, incentivizes shorting)
- If `funding_rate < 0`: **shorts pay longs** (perp trading below index, incentivizes longing)
- Funding is deducted from / added to margin balance at each interval

**Annualized Funding Rate:**

```
annual_funding_rate = hourly_funding_rate * 24 * 365
```

(On Hyperliquid with hourly funding. For 8h exchanges, multiply 8h rate by 3 * 365.)

### 1.6 Leverage and Margin

**Initial Margin:**

```
initial_margin = notional_value / leverage
               = position_size * entry_price / leverage
```

**Maintenance Margin:**

The minimum margin required to keep a position open. On Hyperliquid, maintenance margin varies by asset and position size (tiered):

```
maintenance_margin_ratio (MMR) = typically 0.5 * (1 / max_leverage) for small positions

For example:
  50x max leverage → MMR = 1% (0.5 * 2%)
  20x max leverage → MMR = 2.5% (0.5 * 5%)
```

Larger positions have higher MMR (tiered system to manage systemic risk).

**Liquidation Price (Isolated Margin):**

For a **long** position:

```
liquidation_price = entry_price * (1 - 1/leverage + MMR)
                  = entry_price * (1 - initial_margin_ratio + maintenance_margin_ratio)
```

More precisely:

```
liquidation_price_long = entry_price * (leverage - 1 + MMR * leverage) / leverage
                       = entry_price * (1 - (1 - MMR) / leverage)

Simplified:
liquidation_price_long ≈ entry_price * (1 - 1/leverage + MMR)
```

For a **short** position:

```
liquidation_price_short = entry_price * (1 + 1/leverage - MMR)
                        = entry_price * (1 + (1 - MMR) / leverage)

Simplified:
liquidation_price_short ≈ entry_price * (1 + 1/leverage - MMR)
```

**Example:** BTC at $50,000, 10x long, MMR = 0.5%:

```
liquidation_price = 50000 * (1 - 1/10 + 0.005)
                  = 50000 * (1 - 0.1 + 0.005)
                  = 50000 * 0.905
                  = $45,250
```

The position is liquidated if BTC drops to ~$45,250 (a ~9.5% move).

**Cross-Margin vs Isolated Margin:**

| Mode | Behavior |
|------|----------|
| **Isolated** | Each position has its own margin pool. Liquidation of one position doesn't affect others. |
| **Cross** | All positions share the account's total margin. Unrealized PnL from one position can support another. More capital-efficient but riskier — a large loss can liquidate multiple positions. |

### 1.7 Vaults

Hyperliquid Vaults are on-chain managed strategy pools:

- **Leader** creates a vault and trades with the pooled capital
- **Depositors** contribute USDC to the vault and receive proportional PnL
- Leader typically takes a **10% profit share** (configurable)
- All trades are on-chain and fully transparent
- Depositors can withdraw at any time (subject to lockup if applicable)
- Essentially **on-chain copy-trading** with smart contract enforcement

**Vault PnL allocation:**

```
depositor_pnl = vault_total_pnl * (depositor_share / total_vault_tvl) * (1 - leader_profit_share)
```

### 1.8 Fees on Hyperliquid

Hyperliquid uses a tiered fee structure based on 14-day trailing volume:

| Tier | 14d Volume | Maker Fee | Taker Fee |
|------|-----------|-----------|-----------|
| Retail | < $5M | 0.010% (1 bps) | 0.035% (3.5 bps) |
| Higher tiers | $5M-$100M+ | 0.005%-0.000% | 0.030%-0.020% |
| Top tier / MM | Very high volume | **Rebate** (negative fee) | Reduced |

- **Referral discounts** available (referrer earns portion of referee's fees)
- **No gas fees** for trading on the perps DEX (gas is only for HyperEVM interactions)
- **No deposit/withdrawal fees** to/from the Hyperliquid L1 (only Arbitrum bridge gas)

### 1.9 Crypto Options Platforms (Not Hyperliquid)

Since Hyperliquid doesn't offer options, here are the major crypto options venues:

**Deribit (Centralized — Dominant Options Exchange):**
- ~90% of crypto options volume globally
- European-style options (exercise at expiry only)
- BTC and ETH options with weekly, monthly, quarterly expiries
- Cash-settled in BTC or ETH
- Order book model
- Up to 100x leverage on futures; options are fully collateralized
- Portfolio margin available

**Lyra (Decentralized — On-Chain Options):**
- Built on Optimism/Arbitrum (previously on Optimism)
- AMM-based options pricing using Black-Scholes with dynamic IV
- Supports calls, puts, spreads
- Uses a liquidity pool model (LPs sell options, traders buy from pool)
- Collateral: USDC/sUSD

**Hegic (Decentralized — On-Chain Options):**
- Simplified options (no order book, pool-based)
- American-style (exercise any time before expiry)
- Premium paid upfront, no liquidation risk for buyers
- Liquidity pool writes options

**Opyn / Squeeth:**
- Squeeth = "squared ETH" — a perpetual options-like instrument
- Provides ETH^2 exposure (convexity without expiry or strikes)
- Unique product: no strike price, no expiry, continuous funding

**Aevo (Decentralized Order Book):**
- Off-chain order book, on-chain settlement (hybrid)
- Options and perps
- Similar UX to centralized exchanges

---

## 2. Core Trade Types in Crypto Markets

### 2.1 Spot Trading

Direct purchase/sale of the actual asset.

```
PnL = quantity * (sell_price - buy_price) - fees
Return = (sell_price - buy_price) / buy_price
```

- No leverage, no liquidation risk, no funding payments
- You own the actual asset (can transfer, stake, use in DeFi)
- Maximum loss = 100% of investment (price goes to zero)

### 2.2 Perpetual Futures (Perps)

See Section 1.4-1.5 for Hyperliquid-specific details. General mechanics:

**Leverage effect on returns:**

```
leveraged_return = leverage * spot_return
leveraged_return = leverage * (ΔP / P₀)
```

**Break-even price (accounting for fees and funding):**

```
break_even_long = entry_price * (1 + (entry_fee + exit_fee) / leverage + cumulative_funding)
break_even_short = entry_price * (1 - (entry_fee + exit_fee) / leverage - cumulative_funding)
```

### 2.3 Options (Calls and Puts)

**Call Option:** Right (not obligation) to BUY at strike price K by/at expiry T.

**Put Option:** Right (not obligation) to SELL at strike price K by/at expiry T.

**Payoff at expiry:**

```
Call payoff = max(S_T - K, 0)
Put payoff  = max(K - S_T, 0)

Where:
  S_T = spot price at expiry
  K   = strike price
```

**PnL (accounting for premium):**

```
Call PnL = max(S_T - K, 0) - premium_paid
Put PnL  = max(K - S_T, 0) - premium_paid
```

**Moneyness:**

| Term | Call | Put |
|------|------|-----|
| In-the-money (ITM) | S > K | S < K |
| At-the-money (ATM) | S ≈ K | S ≈ K |
| Out-of-the-money (OTM) | S < K | S > K |

**Intrinsic vs Extrinsic Value:**

```
Call:
  intrinsic = max(S - K, 0)
  extrinsic = premium - intrinsic   (time value + volatility premium)

Put:
  intrinsic = max(K - S, 0)
  extrinsic = premium - intrinsic
```

### 2.4 Order Types — Mathematical Behavior

**Market Order:**
- Fills at best available prices, walking the order book
- Expected slippage depends on order size vs book depth

```
effective_price = Σ(price_i * fill_quantity_i) / total_quantity

slippage = |effective_price - mid_price| / mid_price
```

**Limit Order:**
- Fills only at specified price or better
- No slippage guarantee, but may not fill (opportunity cost)

**Stop-Loss:**

```
For a long position:
  trigger: market_price ≤ stop_price
  Then executes: market sell (or limit sell at stop_limit_price)

Risk of gap: actual_fill may be below stop_price in fast markets
Expected loss = position_size * (entry_price - stop_price) + slippage
```

**Take-Profit:**

```
For a long position:
  trigger: market_price ≥ take_profit_price
  Then executes: market sell

Expected profit = position_size * (take_profit_price - entry_price) - fees
```

**Risk-Reward Ratio:**

```
R:R = (take_profit - entry) / (entry - stop_loss)
```

Example: Entry $100, stop $95, TP $115 → R:R = 15/5 = 3:1

---

## 3. Options Pricing Mathematics

### 3.1 Black-Scholes Model

The Black-Scholes-Merton (BSM) model prices European options (exercise only at expiry).

**Assumptions:**
1. Log-normal distribution of asset prices
2. No dividends (adapted below for continuous yield)
3. Constant volatility (σ)
4. Constant risk-free rate (r)
5. No transaction costs
6. Continuous trading possible

**Black-Scholes Formulas:**

```
Call price: C = S₀ * N(d₁) - K * e^(-rT) * N(d₂)
Put price:  P = K * e^(-rT) * N(-d₂) - S₀ * N(-d₁)

Where:
  d₁ = [ln(S₀/K) + (r + σ²/2) * T] / (σ * √T)
  d₂ = d₁ - σ * √T

  S₀ = current spot price
  K  = strike price
  T  = time to expiry (in years)
  r  = risk-free rate (annualized, continuous compounding)
  σ  = volatility (annualized standard deviation of log returns)
  N(x) = cumulative standard normal distribution function
  e  = Euler's number (≈ 2.71828)
```

**N(x) — Standard Normal CDF:**

```
N(x) = (1/√(2π)) * ∫_{-∞}^{x} e^(-t²/2) dt
```

Approximation (Abramowitz & Stegun):

```
N(x) ≈ 1 - n(x) * (a₁*k + a₂*k² + a₃*k³)   for x ≥ 0
Where:
  k = 1 / (1 + 0.33267 * x)
  a₁ = 0.4361836, a₂ = -0.1201676, a₃ = 0.9372980
  n(x) = (1/√(2π)) * e^(-x²/2)    [standard normal PDF]
For x < 0: N(x) = 1 - N(-x)
```

### 3.2 Crypto Adaptations of Black-Scholes

Crypto markets differ from traditional markets in several key ways:

**1. No risk-free rate benchmark:** Use stablecoin lending rates (e.g., USDC/USDT rates on Aave/Compound, or CEX lending rates). Typically 2-8% APY.

**2. Continuous yield / cost-of-carry:** For assets with staking yield (e.g., ETH staking at ~3-4%), use the dividend-yield adaptation:

```
C = S₀ * e^(-qT) * N(d₁) - K * e^(-rT) * N(d₂)
P = K * e^(-rT) * N(-d₂) - S₀ * e^(-qT) * N(-d₁)

d₁ = [ln(S₀/K) + (r - q + σ²/2) * T] / (σ * √T)
d₂ = d₁ - σ * √T

Where q = continuous yield rate (e.g., staking APY)
```

**3. Fat tails / non-normal returns:** Crypto returns exhibit leptokurtosis (fat tails). Adjustments:
- Use **SABR model** or **stochastic volatility models** (Heston)
- Apply **volatility smile/skew** corrections
- Use **realized volatility** measures that account for jumps

**4. 24/7 markets:** T is calculated as actual calendar time, not trading days.

```
T = seconds_to_expiry / (365.25 * 24 * 3600)
```

**5. High volatility:** Crypto σ is typically 50-120% annualized (vs 15-25% for equities), making options significantly more expensive.

### 3.3 The Greeks

The Greeks measure sensitivity of option price to various parameters.

#### Delta (Δ) — Price Sensitivity

```
Call delta: Δ_c = e^(-qT) * N(d₁)        Range: [0, 1]
Put delta:  Δ_p = -e^(-qT) * N(-d₁)      Range: [-1, 0]
            Δ_p = Δ_c - e^(-qT)

Interpretation: Δ ≈ change in option price per $1 change in underlying
Also: |Δ| ≈ probability the option expires ITM (rough approximation)
```

**Delta hedging:** To be delta-neutral, hold `-Δ * position_size` of the underlying per option contract.

#### Gamma (Γ) — Delta Sensitivity (Convexity)

```
Γ = n(d₁) * e^(-qT) / (S₀ * σ * √T)

Where n(x) = (1/√(2π)) * e^(-x²/2)   [standard normal PDF]

Same for calls and puts.
```

- Gamma is highest for ATM options near expiry
- **Long gamma** = position benefits from large moves (long options)
- **Short gamma** = position suffers from large moves (short options)
- Gamma measures the **curvature** of the PnL curve

```
ΔΔ ≈ Γ * ΔS     (change in delta for a change in spot)
PnL from gamma ≈ 0.5 * Γ * (ΔS)²
```

#### Theta (Θ) — Time Decay

```
Call theta:
Θ_c = -[S₀ * n(d₁) * σ * e^(-qT)] / (2√T) - r * K * e^(-rT) * N(d₂) + q * S₀ * e^(-qT) * N(d₁)

Put theta:
Θ_p = -[S₀ * n(d₁) * σ * e^(-qT)] / (2√T) + r * K * e^(-rT) * N(-d₂) - q * S₀ * e^(-qT) * N(-d₁)
```

- Theta is typically **negative** for long options (time decay erodes value)
- Theta accelerates as expiry approaches (fastest decay in last 30 days)
- Theta is largest for ATM options

```
Daily theta ≈ Θ / 365
```

**Theta-Gamma relationship:**

```
Θ + 0.5 * σ² * S² * Γ + r * S * Δ - r * V = 0    (Black-Scholes PDE)

For ATM, approximately:
Θ ≈ -0.5 * Γ * S² * σ²     (theta and gamma are opposing forces)
```

#### Vega (ν) — Volatility Sensitivity

```
ν = S₀ * e^(-qT) * √T * n(d₁)

Same for calls and puts.
```

- Vega is highest for ATM options with long time to expiry
- A 1 percentage-point increase in IV → option price changes by ν/100

```
Vega per 1% IV change = ν / 100
```

- **Long vega** = benefits from rising IV (long options)
- **Short vega** = benefits from falling IV (short options)

#### Rho (ρ) — Interest Rate Sensitivity

```
Call rho: ρ_c = K * T * e^(-rT) * N(d₂)
Put rho:  ρ_p = -K * T * e^(-rT) * N(-d₂)
```

- Least important Greek in crypto (rates relatively stable compared to vol)
- Still matters for longer-dated options

#### Summary Table

| Greek | Measures | Long Call | Long Put | Formula Component |
|-------|----------|-----------|----------|-------------------|
| Delta | Price sensitivity | +Δ (0 to 1) | -Δ (-1 to 0) | ∂V/∂S |
| Gamma | Delta curvature | +Γ | +Γ | ∂²V/∂S² |
| Theta | Time decay | -Θ (loses) | -Θ (loses) | ∂V/∂t |
| Vega | Vol sensitivity | +ν | +ν | ∂V/∂σ |
| Rho | Rate sensitivity | +ρ | -ρ | ∂V/∂r |

### 3.4 Implied Volatility (IV)

IV is the volatility value that, when plugged into Black-Scholes, produces the observed market price of the option. It must be solved numerically (no closed-form inverse).

**Newton-Raphson method for IV:**

```
Given: market_price (observed option premium), S, K, T, r, q

Find σ such that: BS(S, K, T, r, q, σ) = market_price

Iteration:
  σ_{n+1} = σ_n - [BS(σ_n) - market_price] / vega(σ_n)

Where vega(σ) = S * e^(-qT) * √T * n(d₁)

Starting guess: σ₀ = √(2π/T) * (market_price / S)   [Brenner-Subrahmanyam approximation]

Converge when |BS(σ_n) - market_price| < ε (e.g., ε = 0.0001)
```

Typically converges in 3-8 iterations.

**Bisection method (more robust but slower):**

```
σ_low = 0.001, σ_high = 5.0
Repeat:
  σ_mid = (σ_low + σ_high) / 2
  if BS(σ_mid) > market_price: σ_high = σ_mid
  else: σ_low = σ_mid
Until |σ_high - σ_low| < ε
```

**IV Surface / Smile / Skew:**

- **Volatility smile:** IV is higher for deep OTM and ITM options (U-shaped curve vs strike)
- **Volatility skew:** In crypto, OTM puts tend to have higher IV than OTM calls (crash protection premium)
- **Term structure:** Near-term options often have higher IV than longer-dated (especially during volatile periods)

```
IV_surface = f(K/S, T)   — a function of moneyness and time to expiry
```

### 3.5 Put-Call Parity

For European options:

```
C - P = S₀ * e^(-qT) - K * e^(-rT)

Equivalently:
C + K * e^(-rT) = P + S₀ * e^(-qT)
```

This is an arbitrage relationship. If violated:

```
If C - P > S₀ * e^(-qT) - K * e^(-rT):
  → Sell call, buy put, buy underlying   (synthetic short + real long)

If C - P < S₀ * e^(-qT) - K * e^(-rT):
  → Buy call, sell put, sell underlying   (synthetic long + real short)
```

**Put-Call Parity for Perps/Futures:**

```
C - P = (F - K) * e^(-rT)

Where F = futures/perp price
```

### 3.6 Options on Futures / Perps

When the underlying is a futures contract (as on Deribit), use **Black's model** (Black-76):

```
C = e^(-rT) * [F * N(d₁) - K * N(d₂)]
P = e^(-rT) * [K * N(-d₂) - F * N(-d₁)]

d₁ = [ln(F/K) + (σ²/2) * T] / (σ * √T)
d₂ = d₁ - σ * √T

Where F = futures price (not spot)
```

This is the standard model used on Deribit.

---

## 4. Trading Strategies with Math

### 4.1 Long/Short with Leverage

**Leveraged Long:**

```
Entry: Buy at price P₀ with leverage L
Capital required: margin = notional / L = (size * P₀) / L

PnL = size * (P_current - P₀)
ROE (Return on Equity) = PnL / margin = L * (P_current - P₀) / P₀

Liquidation price (isolated, ignoring fees):
P_liq = P₀ * (1 - 1/L + MMR)

For L=10, MMR=0.5%: P_liq = P₀ * 0.905 → liquidated at -9.5%
For L=20, MMR=0.5%: P_liq = P₀ * 0.955 → liquidated at -4.5%
For L=50, MMR=0.5%: P_liq = P₀ * 0.985 → liquidated at -1.5%
```

**Leveraged Short:**

```
PnL = size * (P₀ - P_current)
ROE = L * (P₀ - P_current) / P₀

Liquidation price (isolated):
P_liq = P₀ * (1 + 1/L - MMR)

For L=10, MMR=0.5%: P_liq = P₀ * 1.095 → liquidated at +9.5%
```

**Incorporating Fees and Funding:**

```
Effective PnL_long = size * (P_exit - P_entry) - entry_fee - exit_fee - Σ(funding_payments)

Where:
  entry_fee = size * P_entry * taker_fee_rate
  exit_fee  = size * P_exit * taker_fee_rate
  funding_payments = Σ over holding period of (size * mark_price_t * funding_rate_t)
```

### 4.2 Funding Rate Arbitrage

**Strategy:** When perpetual funding rates are significantly positive, go short on the perp and long on spot (or vice versa). This captures the funding payments while being delta-neutral.

**Setup (positive funding — longs pay shorts):**

```
1. Buy 1 BTC spot at price S
2. Short 1 BTC perp at price F
   (usually F ≈ S when funding is positive, since perp > index)
3. Collect funding payments from shorts

Net delta = +1 (spot) + (-1) (perp) = 0  → delta neutral
```

**Profitability Calculation:**

```
Revenue per period = position_size * mark_price * funding_rate

Daily revenue (hourly funding, e.g. Hyperliquid):
  daily_revenue = position_size * mark_price * hourly_funding_rate * 24

Annualized yield:
  APY = hourly_funding_rate * 24 * 365

Costs:
  entry_cost = spot_fee + perp_fee (each side)
  exit_cost  = spot_fee + perp_fee (each side)
  total_fee_cost = 2 * (spot_fee_rate + perp_fee_rate) * notional

Capital required:
  spot_capital = position_size * spot_price (1x)
  perp_margin  = position_size * perp_price / leverage
  total_capital = spot_capital + perp_margin

Net profit:
  net_profit = Σ(funding_payments) - total_fee_cost - basis_change_PnL

  basis_change_PnL = (F_exit - S_exit) - (F_entry - S_entry)
  (This can be + or - depending on basis convergence)

Annualized return on capital:
  return = net_profit / total_capital * (365 / holding_days)
```

**When to enter/exit:**

```
Enter when: annualized_funding_rate > threshold (e.g., > 20% APY after fees)
Exit when:  annualized_funding_rate < cost_of_carry or goes negative
```

**Risks:**
- Funding rate can flip negative (you start paying instead of earning)
- Liquidation risk on the perp side if price moves sharply against short
- Basis risk: spot and perp prices can diverge temporarily
- Exchange risk (counterparty risk for CEX, smart contract risk for DEX)

### 4.3 Basis Trading (Cash-and-Carry Arbitrage)

Similar to funding arb but uses **dated futures** instead of perps.

```
Basis = futures_price - spot_price
Basis_rate = (F - S) / S * (365 / days_to_expiry)   [annualized]
```

**Trade:**

```
If basis_rate > risk_free_rate + costs:
  Buy spot at S, sell futures at F
  At expiry: futures converge to spot → profit = F - S - costs

Annualized return = [(F/S - 1) * (365/T_days)] - fee_costs_annualized
```

This is a **risk-free** return (assuming no counterparty/smart contract risk), analogous to lending at the basis rate.

### 4.4 Delta-Neutral Strategies

**Concept:** Construct a portfolio with net delta = 0, so it is insensitive to small price moves. Profit comes from other factors (gamma, theta, vega, funding).

**Delta-neutral with options:**

```
Portfolio delta = Σ(Δ_i * quantity_i) + spot_position = 0

To hedge n call options with delta Δ_c:
  spot_hedge = -n * Δ_c
  (sell Δ_c shares of underlying per call option held)

Rebalancing: as price moves, delta changes (gamma effect)
  new_hedge = -n * Δ_c_new
  adjustment = new_hedge - old_hedge
```

**Gamma scalping (long gamma, delta-neutral):**

```
1. Buy ATM straddle (long call + long put, same strike)
   Portfolio: long gamma, long vega, short theta

2. Delta-hedge continuously:
   When price rises → delta goes positive → sell underlying
   When price falls → delta goes negative → buy underlying

3. Profit = gamma_gains - theta_cost

   gamma_profit_per_rebalance ≈ 0.5 * Γ * (ΔS)²
   theta_cost_per_day = |Θ|

   Break-even daily move: ΔS_BE = √(2 * |Θ| / Γ)
   In volatility terms: realized_vol_BE ≈ implied_vol
```

**The key insight:** Long gamma makes money when **realized volatility > implied volatility**. Short gamma makes money when **realized vol < implied vol**.

### 4.5 Options Spread Strategies

#### Straddle (Long)

```
Position: Buy call at strike K + Buy put at strike K (same expiry)
Cost: C(K) + P(K) = total_premium
Max loss: total_premium (if S_T = K)
Breakeven: K ± total_premium
Profit when: |S_T - K| > total_premium

Greeks:
  Δ ≈ 0 (ATM straddle is delta-neutral)
  Γ = 2 * Γ_single (high positive gamma)
  Θ = 2 * Θ_single (high negative theta — costly to hold)
  ν = 2 * ν_single (long vega — benefits from IV increase)
```

Use case: Expect large move but unsure of direction. Profitable when actual move > implied move.

#### Strangle (Long)

```
Position: Buy OTM call at K₂ + Buy OTM put at K₁ (K₁ < S < K₂, same expiry)
Cost: C(K₂) + P(K₁) = total_premium (cheaper than straddle)
Max loss: total_premium
Breakeven: K₁ - total_premium (downside) or K₂ + total_premium (upside)
Profit when: S_T < K₁ - premium OR S_T > K₂ + premium

Requires a LARGER move than straddle to profit, but cheaper entry.
```

#### Bull Call Spread

```
Position: Buy call at K₁ (lower strike) + Sell call at K₂ (higher strike), K₁ < K₂
Net cost: C(K₁) - C(K₂) = net_debit
Max profit: K₂ - K₁ - net_debit (when S_T ≥ K₂)
Max loss: net_debit (when S_T ≤ K₁)
Breakeven: K₁ + net_debit
```

#### Bear Put Spread

```
Position: Buy put at K₂ (higher strike) + Sell put at K₁ (lower strike), K₁ < K₂
Net cost: P(K₂) - P(K₁) = net_debit
Max profit: K₂ - K₁ - net_debit (when S_T ≤ K₁)
Max loss: net_debit (when S_T ≥ K₂)
Breakeven: K₂ - net_debit
```

#### Iron Condor

```
Position:
  Sell OTM put at K₁
  Buy further OTM put at K₀ (K₀ < K₁)
  Sell OTM call at K₃
  Buy further OTM call at K₄ (K₃ < K₄)

Net credit received: premium_collected - premium_paid
Max profit: net_credit (when K₁ ≤ S_T ≤ K₃)
Max loss: max(K₁ - K₀, K₄ - K₃) - net_credit
Breakeven: K₁ - net_credit (lower) and K₃ + net_credit (upper)

Ideal in low-volatility, range-bound markets.
```

#### Butterfly Spread

```
Position (long call butterfly):
  Buy 1 call at K₁ (lower)
  Sell 2 calls at K₂ (middle, ATM)
  Buy 1 call at K₃ (upper)
  Where K₂ - K₁ = K₃ - K₂ (equal spacing)

Net cost: C(K₁) - 2*C(K₂) + C(K₃) = net_debit
Max profit: K₂ - K₁ - net_debit (when S_T = K₂)
Max loss: net_debit
Breakeven: K₁ + net_debit and K₃ - net_debit
```

### 4.6 Grid Trading

**Concept:** Place buy and sell limit orders at regular price intervals ("grid lines") to profit from price oscillations in a range-bound market.

**Parameters:**

```
upper_price (U): top of the grid range
lower_price (L): bottom of the grid range
num_grids (N): number of grid lines
grid_spacing: (U - L) / N     [arithmetic grid]
              or
grid_ratio: (U/L)^(1/N)       [geometric grid]

investment: total capital allocated
order_size: investment / N     [per grid level]
```

**Arithmetic Grid (equal price spacing):**

```
grid_prices = [L + i * (U - L) / N  for i in 0, 1, ..., N]
profit_per_grid = grid_spacing * order_quantity_per_grid
```

**Geometric Grid (equal percentage spacing):**

```
grid_prices = [L * (U/L)^(i/N)  for i in 0, 1, ..., N]
profit_per_grid_pct = (U/L)^(1/N) - 1   [constant percentage]
```

Geometric grids are preferred when price ranges span large percentages (e.g., BTC from $40k to $80k).

**Expected Profit (simplified):**

```
profit_per_cycle = grid_spacing * order_size - 2 * fee * order_size * price
                 = order_size * (grid_spacing - 2 * fee * price)

Minimum grid_spacing for profitability:
  grid_spacing_min = 2 * fee_rate * price
  (Must exceed round-trip fee cost)

For 0.1% total round-trip fee at price $50,000:
  grid_spacing_min = 2 * 0.001 * 50000 = $100
```

**Optimization:**

```
1. Grid spacing vs frequency tradeoff:
   - Tighter grids → more fills but less profit per fill
   - Wider grids → fewer fills but more profit per fill
   - Optimal: depends on expected volatility and mean-reversion strength

2. Range selection:
   - Use Bollinger Bands or ATR to estimate range
   - Set U and L at ±2σ from mean (captures ~95% of price action in range-bound market)

3. Grid count optimization:
   - N_optimal ≈ (U - L) / (2 * ATR_period)
   - Where ATR_period = Average True Range over your timeframe
```

**Risk:** If price breaks out of the range, grid trading suffers (long grids lose if price drops below L; all capital is in the asset with unrealized loss).

### 4.7 Mean Reversion vs Momentum

#### Mean Reversion Indicators

**RSI (Relative Strength Index):**

```
RSI = 100 - 100 / (1 + RS)

Where:
  RS = average_gain / average_loss   (over N periods, typically N=14)

  First calculation:
    average_gain = Σ(gains over N periods) / N
    average_loss = Σ(losses over N periods) / N

  Subsequent (smoothed / exponential):
    average_gain = (prev_avg_gain * (N-1) + current_gain) / N
    average_loss = (prev_avg_loss * (N-1) + current_loss) / N

Interpretation:
  RSI > 70 → overbought (potential sell / mean reversion short)
  RSI < 30 → oversold (potential buy / mean reversion long)
  RSI = 50 → neutral
```

**Bollinger Bands:**

```
Middle band = SMA(N)       [Simple Moving Average over N periods, typically N=20]
Upper band  = SMA(N) + k * σ_N    [typically k=2]
Lower band  = SMA(N) - k * σ_N

Where:
  SMA(N) = Σ(close_prices over N periods) / N
  σ_N = √[Σ(close_i - SMA)² / N]   [population standard deviation of last N closes]

Bandwidth = (upper - lower) / middle
%B = (price - lower) / (upper - lower)   [position within bands]

Mean reversion signals:
  Price touches upper band → potential short (price extended above mean)
  Price touches lower band → potential long (price extended below mean)
  Bandwidth squeeze (narrowing) → breakout imminent (switch to momentum)
```

**Z-Score (for pairs/spread trading):**

```
z_score = (spread - mean(spread)) / std(spread)

Where spread = price_A - β * price_B   [cointegrated pair]

Trade:
  z > +2: short spread (sell A, buy B)
  z < -2: long spread (buy A, sell B)
  z ≈ 0: close position
```

#### Momentum Indicators

**MACD (Moving Average Convergence Divergence):**

```
MACD_line = EMA(12) - EMA(26)
Signal_line = EMA(9, of MACD_line)
Histogram = MACD_line - Signal_line

Where EMA(N) = exponential moving average with span N:
  EMA_today = close * α + EMA_yesterday * (1 - α)
  α = 2 / (N + 1)     [smoothing factor]

Signals:
  MACD crosses above signal → bullish (buy)
  MACD crosses below signal → bearish (sell)
  Histogram positive and growing → strengthening uptrend
  Divergence (price makes new high, MACD doesn't) → potential reversal
```

**EMA Crossover:**

```
Fast EMA: EMA(N_fast)    [e.g., N=9 or N=12]
Slow EMA: EMA(N_slow)    [e.g., N=21 or N=26]

Buy signal:  EMA_fast crosses above EMA_slow (golden cross)
Sell signal: EMA_fast crosses below EMA_slow (death cross)

Trend filter: price > EMA(200) → bullish regime; price < EMA(200) → bearish regime
```

**ADX (Average Directional Index) — Trend Strength:**

```
+DI = 100 * EMA(N, +DM) / ATR(N)
-DI = 100 * EMA(N, -DM) / ATR(N)
DX  = 100 * |+DI - -DI| / (+DI + -DI)
ADX = EMA(N, DX)       [typically N=14]

Where:
  +DM = max(high_today - high_yesterday, 0)  if > |low_yesterday - low_today|, else 0
  -DM = max(low_yesterday - low_today, 0)    if > |high_today - high_yesterday|, else 0
  ATR(N) = average true range

Interpretation:
  ADX > 25 → trending market (use momentum strategies)
  ADX < 20 → ranging market (use mean reversion strategies)
  +DI > -DI → uptrend
  -DI > +DI → downtrend
```

**ATR (Average True Range) — Volatility Measure:**

```
TR = max(high - low, |high - prev_close|, |low - prev_close|)
ATR(N) = SMA(N, TR)    or    EMA(N, TR)    [typically N=14]

Uses:
  - Position sizing: position_size = risk_amount / (ATR * multiplier)
  - Stop placement: stop = entry ± k * ATR  (typically k = 1.5 to 3)
  - Grid spacing: grid_spacing = c * ATR     (typically c = 0.5 to 1.0)
```

### 4.8 Market Making

**Concept:** Continuously quote both bid and ask, earning the spread on round-trip fills.

**Basic Market Making Math:**

```
bid_price = mid_price - spread / 2
ask_price = mid_price + spread / 2

Profit per round-trip = spread - 2 * fees

Net spread = spread - 2 * fee_per_side
```

**Optimal Spread (Avellaneda-Stoikov Model):**

```
reservation_price = S - q * γ * σ² * (T - t)
optimal_spread = γ * σ² * (T - t) + (2/γ) * ln(1 + γ/κ)

Where:
  S = mid-price
  q = current inventory (positive = long, negative = short)
  γ = risk aversion parameter
  σ = volatility
  T - t = remaining time
  κ = order arrival intensity parameter

Simplified version:
  spread ≈ 2 * σ * √(Δt) + 2 * fee
  Where Δt = expected time between fills
```

**Inventory Management:**

```
Skewed quotes to manage inventory:
  bid_price = mid - spread/2 + inventory_skew
  ask_price = mid + spread/2 + inventory_skew

  inventory_skew = -q * skew_factor * spread
  Where q = normalized inventory (-1 to +1)

  When long (q > 0): skew negative → lower both bid/ask → encourage selling
  When short (q < 0): skew positive → raise both bid/ask → encourage buying
```

**Market Making PnL:**

```
PnL = Σ(spread_captured) + inventory_pnl + fee_rebates

inventory_pnl = inventory * ΔS   (can be large and adverse)
spread_income = n_round_trips * net_spread_per_trip

Key risk: adverse selection — informed traders consistently hit your quotes on the correct side, leaving you with losing inventory.
```

---

## 5. Risk Management Mathematics

### 5.1 Position Sizing — Kelly Criterion

The Kelly criterion determines the optimal fraction of capital to risk on each trade to maximize long-run geometric growth.

**Binary outcome (win/lose):**

```
f* = (p * b - q) / b = p - q/b

Where:
  f* = optimal fraction of capital to bet
  p  = probability of winning
  q  = 1 - p = probability of losing
  b  = win/loss ratio (how much you win per $1 risked)

Example: 60% win rate, 2:1 R:R
  f* = 0.6 - 0.4/2 = 0.6 - 0.2 = 0.4 → risk 40% per trade (full Kelly)
```

**Continuous outcome (trading):**

```
f* = μ / σ²

Where:
  μ = expected return per trade (mean of return distribution)
  σ = standard deviation of returns per trade

Alternative with Sharpe ratio:
  f* = SR / σ = (μ/σ) / σ = μ/σ²

For leveraged instruments:
  optimal_leverage = μ / σ²
```

**Fractional Kelly (practical application):**

Full Kelly is aggressive and leads to large drawdowns. In practice, use **half-Kelly** or **quarter-Kelly**:

```
f_practical = f* / k    where k = 2 (half-Kelly) or k = 4 (quarter-Kelly)
```

Half-Kelly achieves ~75% of the growth rate of full Kelly with significantly lower drawdown.

**Multi-asset Kelly:**

```
f* = Σ⁻¹ * μ

Where:
  f* = vector of optimal fractions for each asset
  Σ  = covariance matrix of asset returns
  μ  = vector of expected returns
  Σ⁻¹ = inverse of covariance matrix
```

### 5.2 Value at Risk (VaR)

VaR estimates the maximum loss over a given time horizon at a specified confidence level.

**Parametric (Normal) VaR:**

```
VaR(α, T) = -μ_T + z_α * σ_T

Where:
  α = confidence level (e.g., 95% or 99%)
  z_α = quantile of standard normal (z_0.95 = 1.645, z_0.99 = 2.326)
  μ_T = expected return over period T
  σ_T = standard deviation of returns over period T

For portfolio value V:
  VaR_dollar = V * (z_α * σ_T - μ_T)

Time scaling (assuming independent returns):
  σ_T = σ_daily * √T   (for T trading days)
  VaR_T = VaR_daily * √T
```

**Historical VaR:**

```
1. Collect N historical returns: r₁, r₂, ..., r_N
2. Sort returns in ascending order
3. VaR(α) = -r_{⌊N*(1-α)⌋}

For 95% VaR with 1000 observations: VaR = -r_{50}  (50th worst return)
```

**Conditional VaR (CVaR / Expected Shortfall):**

```
CVaR(α) = E[loss | loss > VaR(α)]
         = -(1/(1-α)) * ∫_{-∞}^{VaR} r * f(r) dr

For normal distribution:
  CVaR(α) = μ + σ * φ(z_α) / (1-α)
  Where φ(z) = standard normal PDF at z
```

CVaR is considered superior to VaR because it measures the **average** loss in the tail, not just the threshold.

**Crypto-specific adjustments:**
- Crypto returns have fat tails → parametric VaR underestimates risk
- Use **Student-t distribution** or **historical simulation** instead
- Account for 24/7 markets: "daily" = 24h, not a trading day

### 5.3 Maximum Drawdown (MDD)

```
Drawdown at time t: DD(t) = (peak_value - current_value) / peak_value
                          = 1 - V(t) / max_{s≤t}(V(s))

Maximum Drawdown: MDD = max_{t} DD(t)
                      = max over all t of [1 - V(t) / running_peak(t)]
```

**Algorithm:**

```python
peak = portfolio_values[0]
max_dd = 0
for value in portfolio_values:
    peak = max(peak, value)
    dd = (peak - value) / peak
    max_dd = max(max_dd, dd)
```

**Calmar Ratio (return/drawdown efficiency):**

```
Calmar = annualized_return / MDD
```

A Calmar > 1.0 is generally considered acceptable; > 2.0 is good.

**Expected MDD for random walk:**

```
E[MDD] ≈ √(π * T / 2) * σ_daily    [for T trading periods]
```

### 5.4 Sharpe Ratio

Measures risk-adjusted return: excess return per unit of total volatility.

```
Sharpe = (R_p - R_f) / σ_p

Where:
  R_p = portfolio annualized return
  R_f = risk-free rate (use stablecoin yield in crypto, e.g., 3-5%)
  σ_p = annualized standard deviation of portfolio returns

Annualizing from daily data:
  R_annual = R_daily * 365    (crypto trades 365 days)
  σ_annual = σ_daily * √365

  Sharpe = (R_daily * 365 - R_f) / (σ_daily * √365)
         = (R_daily - R_f/365) / σ_daily * √365
```

**Interpretation:**

| Sharpe | Quality |
|--------|---------|
| < 0 | Losing money risk-adjusted |
| 0.0 - 0.5 | Poor |
| 0.5 - 1.0 | Acceptable |
| 1.0 - 2.0 | Good |
| 2.0 - 3.0 | Very good |
| > 3.0 | Excellent (verify: may indicate overfitting or survivorship bias) |

### 5.5 Sortino Ratio

Like Sharpe but penalizes only **downside** volatility (better for asymmetric return distributions).

```
Sortino = (R_p - R_f) / σ_downside

Where:
  σ_downside = √[Σ min(r_i - r_target, 0)² / N]

  r_target = minimum acceptable return (often 0 or R_f)
  Only negative deviations from target are included
```

Sortino > Sharpe when the strategy has positive skew (more upside outliers than downside).

### 5.6 Liquidation Mechanics on Leveraged Positions

**When does liquidation occur?**

```
Liquidation triggered when:
  margin_ratio = maintenance_margin / account_equity ≥ 1

  account_equity = initial_margin + unrealized_PnL
  maintenance_margin = position_notional * MMR

Equivalently:
  initial_margin + unrealized_PnL ≤ maintenance_margin
```

**Liquidation process on Hyperliquid:**

1. **Mark price** (not last trade price) is used to prevent manipulation. Mark price is derived from the oracle/index price and the order book mid-price.
2. When account equity drops below maintenance margin, the **liquidation engine** takes over the position.
3. The liquidator attempts to close the position on the order book.
4. If the position cannot be fully liquidated on the order book, the **insurance fund** absorbs the remaining loss.
5. If the insurance fund is exhausted, **auto-deleveraging (ADL)** occurs: profitable positions on the other side are forcibly reduced.
6. Any remaining margin after liquidation is returned to the trader (partial liquidation if possible).

**Partial vs Full Liquidation:**

```
If margin_ratio is between 1.0 and some threshold:
  → Partial liquidation: reduce position until margin_ratio < 1.0

If margin_ratio far exceeds 1.0:
  → Full liquidation of the position
```

**Calculating safe leverage:**

```
Given desired max_drawdown tolerance (e.g., 20% move against you):
  max_leverage = 1 / (max_drawdown + MMR)

For 20% tolerance, MMR = 0.5%:
  max_leverage = 1 / 0.205 ≈ 4.87x → use 4x or 5x

To survive a specific adverse move without liquidation:
  required_leverage ≤ 1 / (adverse_move_pct + MMR)
```

**Liquidation with cross-margin:**

```
In cross-margin, all positions share equity:

total_equity = balance + Σ(unrealized_PnL_i for all positions)
total_maintenance = Σ(position_notional_i * MMR_i)

Liquidation when: total_equity ≤ total_maintenance

This means a losing position can be kept open by profits from another position,
but a catastrophic loss in one position can trigger liquidation of ALL positions.
```

---

## 6. Profitability Factors

### 6.1 Fee Structures and Impact

**Hyperliquid fee tiers (typical):**

| | Maker | Taker |
|---|---|---|
| **Base** | 0.010% (1 bps) | 0.035% (3.5 bps) |
| **High volume** | 0.000% - rebate | 0.020% (2 bps) |

**Fee impact on strategies:**

```
Scalping/HFT (many trades, small profit per trade):
  profit_per_trade = expected_move - 2 * fee
  If expected_move = 0.05%, round_trip_fee = 0.07% (taker both sides)
  → NET LOSS on average. Must use limit orders (maker fees) or high volume tiers.

Swing trading (fewer trades, larger targets):
  profit_target = 2-10%
  round_trip_fee = 0.07%
  fee_drag = 0.07% / 5% = 1.4% of profit → manageable

Market making (earning the spread):
  net_income_per_round_trip = spread - maker_fee_buy - maker_fee_sell
  With rebates: can even earn MORE than the spread
```

**Break-even calculation:**

```
For a trade to be profitable after fees:
  |price_change| > entry_fee_rate + exit_fee_rate
  |price_change| > round_trip_fee_rate

With leverage:
  |price_change| > round_trip_fee_rate / leverage   (in PnL terms)
  But the fee is on notional, so absolute fee is the same
```

### 6.2 Slippage Modeling

**Slippage** is the difference between the expected execution price and the actual fill price.

**Factors:**
1. Order size relative to order book depth
2. Market volatility
3. Order type (market orders have slippage; limit orders do not, but may not fill)

**Linear slippage model:**

```
slippage_bps = α + β * (order_size / ADV)

Where:
  α = base slippage (from spread)
  β = price impact coefficient
  ADV = average daily volume
```

**Square-root slippage model (Almgren-Chriss):**

```
slippage = σ * √(order_size / ADV) * k

Where:
  σ = daily volatility
  k = market-specific constant (typically 0.1 - 1.0)
```

**Practical estimation:**

```
For small orders (< 1% of book depth at best price):
  slippage ≈ half_spread = spread / 2

For larger orders:
  Walk the order book:
  effective_price = Σ(price_level_i * quantity_i) / total_quantity
  slippage = |effective_price - mid_price|
```

**Incorporating slippage into strategy backtests:**

```
realistic_fill_price_buy = theoretical_price + slippage
realistic_fill_price_sell = theoretical_price - slippage

total_cost = fees + slippage + funding (for perps)
```

### 6.3 Strategy Suitability by Market Regime

| Strategy | Trending Market | Ranging Market | High Volatility | Low Volatility |
|----------|:-:|:-:|:-:|:-:|
| **Momentum (EMA cross, MACD)** | Excellent | Poor (whipsaw) | Good | Poor |
| **Mean Reversion (RSI, Bollinger)** | Poor (stops out) | Excellent | Moderate | Good |
| **Grid Trading** | Poor (directional loss) | Excellent | Good (if range holds) | Good |
| **Funding Rate Arb** | Good (if funding persists) | Good | Good | Moderate |
| **Market Making** | Risky (inventory risk) | Excellent | Risky (adverse selection) | Good |
| **Long Straddle/Strangle** | Good (if large move) | Poor (theta decay) | Excellent | Poor |
| **Iron Condor** | Poor (breached wings) | Excellent | Poor | Excellent |
| **Delta-Neutral (gamma scalp)** | Good (large moves) | Poor (not enough movement) | Excellent | Poor |
| **Basis/Carry Trade** | Good | Good | Good (higher basis) | Moderate |
| **Breakout** | Excellent | Poor (false breakouts) | Good | Moderate |

**Regime Detection:**

```
Use ADX to classify regime:
  ADX > 25 and rising → trending → use momentum strategies
  ADX < 20 and flat   → ranging → use mean reversion / grid / market making

Use Bollinger Band Width for volatility regime:
  BBW > historical_75th_percentile → high vol
  BBW < historical_25th_percentile → low vol (squeeze → expect breakout)

Combine:
  regime = f(ADX, BBW, trend_direction)
  Then select strategy appropriate for detected regime
```

### 6.4 Complete PnL Model for a Leveraged Perp Trade

Putting it all together:

```
Gross PnL = position_size * (P_exit - P_entry) * direction
  Where direction = +1 for long, -1 for short

Costs:
  entry_fee       = position_size * P_entry * fee_rate_entry
  exit_fee        = position_size * P_exit * fee_rate_exit
  funding_total   = Σ_{t=0}^{T} (position_size * P_mark_t * funding_rate_t * direction)
  slippage_entry  = position_size * slippage_entry_bps * P_entry
  slippage_exit   = position_size * slippage_exit_bps * P_exit

Net PnL = Gross PnL - entry_fee - exit_fee - funding_total - slippage_entry - slippage_exit

Capital deployed:
  If isolated: margin = position_size * P_entry / leverage
  If cross: margin = account_balance (shared)

Return on equity: ROE = Net PnL / margin
Annualized return: annual_ROE = ROE * (365 * 24 * 3600) / holding_seconds
```

### 6.5 Strategy Evaluation Checklist

Before deploying any strategy, compute:

```
1. Expected Value per trade:
   EV = (win_rate * avg_win) - (loss_rate * avg_loss) - avg_fees - avg_slippage - avg_funding

2. Must have EV > 0 (positive expectancy)

3. Risk-adjusted metrics:
   - Sharpe ratio > 1.0 (ideally > 2.0)
   - Sortino ratio > 1.5
   - Max drawdown < 20-30% of capital
   - Calmar ratio > 1.0

4. Practical constraints:
   - Sufficient liquidity for position sizes
   - Fees don't consume edge (fees < 30% of gross profit)
   - Strategy capacity (does it scale?)
   - Execution speed requirements (can you execute on Hyperliquid's latency?)

5. Robustness checks:
   - Backtest over multiple regimes (bull, bear, sideways)
   - Out-of-sample testing
   - Monte Carlo simulation of parameter sensitivity
   - Walk-forward optimization (not just in-sample curve fitting)
```

---

## Appendix A: Quick Reference Formulas

### Perpetual Futures

```
Funding Payment      = position_notional * funding_rate
Liquidation (Long)   = entry * (1 - 1/L + MMR)
Liquidation (Short)  = entry * (1 + 1/L - MMR)
Leveraged Return     = L * (ΔP / P₀)
Margin Required      = notional / L
```

### Options (Black-Scholes)

```
C = S*N(d₁) - K*e^(-rT)*N(d₂)
P = K*e^(-rT)*N(-d₂) - S*N(-d₁)
d₁ = [ln(S/K) + (r + σ²/2)*T] / (σ√T)
d₂ = d₁ - σ√T
Put-Call Parity: C - P = S - K*e^(-rT)
```

### Greeks

```
Δ_call = N(d₁)           Δ_put = N(d₁) - 1
Γ = n(d₁) / (S*σ*√T)
Θ_call = -S*n(d₁)*σ/(2√T) - r*K*e^(-rT)*N(d₂)
ν = S*√T*n(d₁)
ρ_call = K*T*e^(-rT)*N(d₂)
```

### Risk Management

```
Kelly: f* = p - q/b  or  f* = μ/σ²
VaR(α): V * z_α * σ * √T
Sharpe: (R_p - R_f) / σ_p
Sortino: (R_p - R_f) / σ_downside
MDD: max over t of (1 - V(t)/peak(t))
```

### Technical Indicators

```
RSI = 100 - 100/(1 + RS),  RS = avg_gain/avg_loss
MACD = EMA(12) - EMA(26),  Signal = EMA(9, MACD)
EMA: EMA_t = P*α + EMA_{t-1}*(1-α),  α = 2/(N+1)
Bollinger: SMA(20) ± 2*σ₂₀
ATR = SMA(14, TR),  TR = max(H-L, |H-C_{prev}|, |L-C_{prev}|)
```

---

## Appendix B: Python Implementation Snippets

### Black-Scholes Calculator

```python
import numpy as np
from scipy.stats import norm

def black_scholes(S, K, T, r, sigma, option_type='call', q=0):
    """
    S: spot price
    K: strike price
    T: time to expiry in years
    r: risk-free rate (annualized)
    sigma: volatility (annualized)
    q: continuous dividend/staking yield
    """
    d1 = (np.log(S/K) + (r - q + sigma**2/2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    if option_type == 'call':
        price = S * np.exp(-q*T) * norm.cdf(d1) - K * np.exp(-r*T) * norm.cdf(d2)
    else:
        price = K * np.exp(-r*T) * norm.cdf(-d2) - S * np.exp(-q*T) * norm.cdf(-d1)

    # Greeks
    delta = np.exp(-q*T) * norm.cdf(d1) if option_type == 'call' else np.exp(-q*T) * (norm.cdf(d1) - 1)
    gamma = np.exp(-q*T) * norm.pdf(d1) / (S * sigma * np.sqrt(T))
    theta = (-(S * norm.pdf(d1) * sigma * np.exp(-q*T)) / (2 * np.sqrt(T))
             - r * K * np.exp(-r*T) * norm.cdf(d2 if option_type == 'call' else -d2)
             * (1 if option_type == 'call' else -1)
             + q * S * np.exp(-q*T) * norm.cdf(d1 if option_type == 'call' else -d1)
             * (1 if option_type == 'call' else -1))
    vega = S * np.exp(-q*T) * np.sqrt(T) * norm.pdf(d1)

    return {'price': price, 'delta': delta, 'gamma': gamma, 'theta': theta/365, 'vega': vega/100}
```

### Implied Volatility Solver

```python
def implied_volatility(market_price, S, K, T, r, option_type='call', q=0, tol=1e-6, max_iter=100):
    """Newton-Raphson IV solver."""
    # Brenner-Subrahmanyam initial guess
    sigma = np.sqrt(2 * np.pi / T) * market_price / S
    sigma = max(sigma, 0.01)  # floor

    for i in range(max_iter):
        bs = black_scholes(S, K, T, r, sigma, option_type, q)
        diff = bs['price'] - market_price
        if abs(diff) < tol:
            return sigma
        vega = bs['vega'] * 100  # undo the /100 in black_scholes
        if vega < 1e-12:
            break
        sigma -= diff / vega
        sigma = max(sigma, 1e-6)  # prevent negative

    return sigma  # best estimate after max_iter
```

### Liquidation Price Calculator

```python
def liquidation_price(entry_price, leverage, side='long', mmr=0.005):
    """
    entry_price: position entry price
    leverage: leverage multiplier
    side: 'long' or 'short'
    mmr: maintenance margin ratio (default 0.5%)
    """
    if side == 'long':
        return entry_price * (1 - 1/leverage + mmr)
    else:
        return entry_price * (1 + 1/leverage - mmr)
```

### Funding Rate Arbitrage Calculator

```python
def funding_arb_pnl(position_size, entry_price, funding_rates,
                     spot_fee_rate=0.001, perp_fee_rate=0.00035, leverage=5):
    """
    funding_rates: list of hourly funding rates over holding period
    Returns net PnL and annualized return.
    """
    notional = position_size * entry_price

    # Revenue from funding
    funding_revenue = sum(notional * fr for fr in funding_rates)

    # Costs
    spot_fees = 2 * notional * spot_fee_rate       # buy + sell spot
    perp_fees = 2 * notional * perp_fee_rate       # open + close perp
    total_fees = spot_fees + perp_fees

    net_pnl = funding_revenue - total_fees

    # Capital required
    spot_capital = notional                          # 1x for spot
    perp_margin = notional / leverage                # margin for short perp
    total_capital = spot_capital + perp_margin

    # Annualized return
    hours = len(funding_rates)
    annual_return = (net_pnl / total_capital) * (365 * 24 / hours)

    return {
        'net_pnl': net_pnl,
        'total_capital': total_capital,
        'roi': net_pnl / total_capital,
        'annualized_return': annual_return,
        'funding_revenue': funding_revenue,
        'total_fees': total_fees
    }
```

### Kelly Criterion Calculator

```python
def kelly_fraction(win_rate, avg_win, avg_loss):
    """
    Binary Kelly criterion.
    win_rate: probability of winning (0-1)
    avg_win: average win amount (positive)
    avg_loss: average loss amount (positive)
    """
    b = avg_win / avg_loss  # win/loss ratio
    p = win_rate
    q = 1 - p
    f = (p * b - q) / b
    return max(f, 0)  # don't bet if negative edge

def kelly_continuous(expected_return, return_std):
    """
    Continuous Kelly for normally distributed returns.
    Returns optimal leverage.
    """
    return expected_return / (return_std ** 2)
```

### Risk Metrics Calculator

```python
def risk_metrics(returns, risk_free_rate=0.04, periods_per_year=365):
    """
    Compute Sharpe, Sortino, MDD, VaR, CVaR from array of periodic returns.
    """
    returns = np.array(returns)

    # Annualized return and vol
    mean_return = np.mean(returns) * periods_per_year
    annual_vol = np.std(returns) * np.sqrt(periods_per_year)

    # Sharpe
    sharpe = (mean_return - risk_free_rate) / annual_vol if annual_vol > 0 else 0

    # Sortino
    downside = returns[returns < 0]
    downside_vol = np.std(downside) * np.sqrt(periods_per_year) if len(downside) > 0 else 1e-10
    sortino = (mean_return - risk_free_rate) / downside_vol

    # Max Drawdown
    cum_returns = np.cumprod(1 + returns)
    peak = np.maximum.accumulate(cum_returns)
    drawdowns = (peak - cum_returns) / peak
    max_dd = np.max(drawdowns)

    # Calmar
    calmar = mean_return / max_dd if max_dd > 0 else float('inf')

    # VaR (95%)
    var_95 = -np.percentile(returns, 5)

    # CVaR (95%)
    cvar_95 = -np.mean(returns[returns <= -var_95]) if np.any(returns <= -var_95) else var_95

    return {
        'annualized_return': mean_return,
        'annualized_vol': annual_vol,
        'sharpe': sharpe,
        'sortino': sortino,
        'max_drawdown': max_dd,
        'calmar': calmar,
        'var_95': var_95,
        'cvar_95': cvar_95,
    }
```

---

## Appendix C: Hyperliquid Platform Reference

### API Access

- **REST API:** `https://api.hyperliquid.xyz` — public data (order books, trades, candles, funding, OI) and authenticated trading (orders, cancels, transfers)
- **WebSocket:** Real-time streaming for order book (L2), trades, candles, user fills/orders
- **Python SDK:** `pip install hyperliquid-python-sdk` ([GitHub](https://github.com/hyperliquid-dex/hyperliquid-python-sdk))
- **Auth model:** No API keys — sign requests with Ethereum private key (EIP-712). Use **agent wallets** (sub-keys authorized to trade but not withdraw) for bots.
- **Rate limits:** ~1,200 req/min REST, ~100 orders/sec per account
- **Asset metadata:** `POST /info` with `{"type": "meta"}` returns current specs for every asset (maxLeverage, szDecimals, etc.)

### HLP Vault (Hyperliquid Liquidity Provider)

- Protocol flagship vault — democratized market-making
- Runs MM strategies across all perp markets; serves as **liquidation backstop**
- Depositors earn pro-rata share of vault PnL (can be negative during drawdowns)
- No lock-up; deposit/withdraw USDC anytime
- Revenue sources: bid-ask spread capture, liquidation takeover profits, platform fee share

### HyperBFT Consensus

- Custom BFT derived from HotStuff (same family as Diem/Libra)
- Sub-second finality (~200ms block time)
- Deterministic transaction ordering (leader-proposed blocks) — no mempool front-running
- No gas fees for trading; users pay only trading fees

### HyperEVM

- EVM-compatible execution environment alongside the trading L1
- Enables DeFi composability (lending, aggregators) with native order book access
- Shared state between EVM and trading L1 — atomic composability

### Builder Codes

- Front-end developers register an on-chain builder code
- Orders routed through their UI include the code, collecting an additional fee (e.g., 0.01-0.1%)
- Enables marketplace of specialized trading interfaces

### Simulation Parameters Quick Reference

| Parameter | Value |
|---|---|
| Contract type | Linear perpetuals (USDC-margined) |
| Collateral | USDC (bridged from Arbitrum) |
| Order book | On-chain CLOB, price-time priority |
| Block time | ~200ms |
| Throughput | ~100k orders/sec |
| Max leverage (BTC/ETH) | 50x |
| Initial margin (50x) | 2% |
| Maintenance margin (base) | ~0.5-1% (tiered by size) |
| Funding interval | Hourly |
| Taker fee (base) | 0.035% (3.5 bps) |
| Maker fee (base) | 0.010% (1.0 bps) |
| Liquidation backstop | HLP vault → insurance fund → ADL |
| Spot trading | Yes, on-chain order book |
| Options | No |

---

## 7. Trade Reasoning Framework

The agent should be able to reason about WHY it takes (or doesn't take) each trade. This framework guides decision-making and post-trade analysis.

### 7.1 Signal Hierarchy (Priority Order)

1. **R4-trend short** — Highest priority. Best backtest win rate (63%), widest trailing stop allows profits to run. Full size (1.0x).
2. **R3-trend long** — Medium priority. ~50% win rate, reduced size (0.7x) and tighter stoploss (-1.5%) to limit drawdowns.
3. **R1/R2 mean-reversion** — Rare triggers (RSI rarely hits 30/70). When they fire, they're high-conviction.
4. **R6 sentiment-confirmed** — Speculative. Requires extreme LunarCrush data + directional DI lean. Small size (0.3x).
5. **Contrarian (C-R*)** — Fade the crowd during euphoria/panic. 40% size, tighter exits.
6. **R5 breakout** — Disabled. Consistent loser in backtests.

### 7.2 When to Trade vs. When to Wait

**Trade when:**
- Technical signal fires with confidence >= 0.5
- Regime matches the signal type (trend rules in trending, mean-rev in quiet/ranging)
- Available balance > $20 and position slots open
- DI spread confirms direction (> 8 for R4 at lower ADX, > 5 for strong conviction)

**Wait when:**
- ADX is transitional (20-25) with no clear DI spread — signals are unreliable
- RSI is mid-range (40-60) with no extreme — lack of momentum
- Multiple consecutive losses suggest regime mismatch — let filters recalibrate
- Sentiment is neutral (no extreme bullish/bearish) — R6 won't add value

### 7.3 Risk/Reward Analysis per Rule

| Rule | Avg Win | Avg Loss | Required Win Rate | Actual | Edge |
|------|---------|----------|-------------------|--------|------|
| R4-short | +1.0-1.5% | -2.0% | 57-67% | 63% | Positive |
| R3-long | +0.5-1.0% | -1.5% | 60-75% | ~50% | Marginal (reduced size) |
| R6-sentiment | +0.3-0.5% | -1.5% | 75-83% | ~61% | Negative alone, value as diversifier |
| Contrarian | +0.5-1.0% | -1.5% | 60-75% | TBD | Theoretical edge in extremes |

### 7.4 Trailing Stop Philosophy

**Problem (pre-Feb 17):** Arms at +0.8%, triggers at +0.3%. Average win was only +$0.27 while stoploss hit -$2.00. Need 7-8 wins per loss to break even.

**Solution:** Widen trailing stops to let winners breathe:
- Volatile coins: arm +2.0%, trigger +0.8%, cap +5%
- Big caps: arm +1.2%, trigger +0.5%, cap +3%

**Principle:** A 3x leverage position needs at least +0.67% just to cover fees (entry + exit taker at 0.035% × 2 × 3 leverage = 0.42%). The trailing trigger must be above this break-even line.

### 7.5 Post-Trade Analysis Questions

After every closed trade, the agent should ask:
1. **Did the regime match the signal?** If trend rule fired in ranging, that's a filter failure.
2. **Was the exit optimal?** Did trailing stop capture most of the move, or close too early?
3. **What was sentiment doing?** Did social data confirm or contradict the technical signal?
4. **Was sizing appropriate?** For the risk profile of this specific setup.
5. **Would a different rule have worked better?** Check if R6 or contrarian would have caught this move.

---

_End of reference. This document should be loaded before any trading strategy design or implementation work._
