#!/usr/bin/env bash
# install.sh — First-run setup for hl-trader.
# Checks prerequisites, installs dependencies, sets up ML, and walks through secrets.
#
# Usage: bash install.sh

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

bold()   { echo -e "${BOLD}$1${RESET}"; }
ok()     { echo -e "  ${GREEN}✓${RESET} $1"; }
info()   { echo -e "  ${CYAN}→${RESET} $1"; }
warn()   { echo -e "  ${YELLOW}!${RESET} $1"; }
fail()   { echo -e "  ${RED}✗${RESET} $1"; exit 1; }
ask()    { echo -e "\n${BOLD}$1${RESET}"; }

cat <<'BANNER'

  ███████╗██████╗ ██████╗ ███████╗
  ██╔════╝██╔══██╗██╔══██╗██╔════╝
  █████╗  ██████╔╝██║  ██║█████╗
  ██╔══╝  ██╔══██╗██║  ██║██╔══╝
  ███████╗██║  ██║██████╔╝███████╗
  ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝

  automated trading agent · hyperliquid perps
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BANNER

# ── Prerequisites ──────────────────────────────────────────────────────────────

bold "Checking prerequisites"

# Node.js >= 20
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install from https://nodejs.org (v20+)"
fi
node_ver=$(node -e "process.stdout.write(process.versions.node)")
node_major=$(echo "$node_ver" | cut -d. -f1)
if [ "$node_major" -lt 20 ]; then
  fail "Node.js v${node_ver} found, v20+ required. Update at https://nodejs.org"
fi
ok "Node.js v${node_ver}"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm not found (should come with Node.js)"
fi
ok "npm $(npm --version)"

# Python 3 (for ML scorer — optional but recommended)
PYTHON=""
if command -v python3 &>/dev/null; then
  PYTHON="python3"
  ok "Python $(python3 --version 2>&1 | awk '{print $2}')"
else
  warn "Python 3 not found — ML scorer will be disabled. Install from https://python.org"
fi

echo ""

# ── Install dependencies ──────────────────────────────────────────────────────

bold "Installing dependencies"
npm install --silent
ok "npm packages installed"

bold "Building frontend"
if npm run build --silent 2>/dev/null; then
  ok "frontend built (dist/)"
else
  warn "frontend build failed — dashboard will not load until you run: npm run build"
fi

echo ""

# ── ML setup (optional) ──────────────────────────────────────────────────────

if [ -n "$PYTHON" ]; then
  bold "Setting up ML scorer"
  if bash hyperliquid-trader/ml/setup.sh &>/dev/null; then
    ok "ML venv created (hyperliquid-trader/ml/.venv)"
    info "Run the following to generate training data and train the model:"
    info "  npx tsx hyperliquid-trader/src/backtest-export.ts"
    info "  hyperliquid-trader/ml/.venv/bin/python3 hyperliquid-trader/ml/scorer.py --mode train --data hyperliquid-trader/ml/data/backtest_export.jsonl"
  else
    warn "ML setup failed — agent will use rule-based confidence only"
  fi
  echo ""
fi

# ── Secrets wizard ────────────────────────────────────────────────────────────

ENV_FILE="hyperliquid-trader/.env"

bold "Secrets setup"

if [ -f "$ENV_FILE" ]; then
  warn ".env already exists at $ENV_FILE"
  read -rp "  Overwrite? [y/N]: " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    info "Skipping secrets wizard — using existing .env"
    echo ""
  else
    rm "$ENV_FILE"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "You'll need credentials from Hyperliquid. Press Enter to skip any optional field."
  echo ""
  cp hyperliquid-trader/.env.example "$ENV_FILE"

  # Step 1: Private key
  ask "Step 1/5 — Hyperliquid agent wallet private key"
  info "Create one at app.hyperliquid.xyz/API (trade-only, no withdrawals)"
  info "This is a 64-char hex string starting with 0x"
  read -rp "  HYPERLIQUID_PRIVATE_KEY: " pk
  if [ -n "$pk" ]; then
    sed -i '' "s|^HYPERLIQUID_PRIVATE_KEY=.*|HYPERLIQUID_PRIVATE_KEY=${pk}|" "$ENV_FILE"
    ok "private key saved"
  else
    warn "skipped — agent can't trade without a private key"
  fi

  # Step 2: Account address
  ask "Step 2/5 — Main wallet address (optional, needed for unified accounts)"
  info "Your main Hyperliquid wallet address (0x...)"
  read -rp "  HYPERLIQUID_ACCOUNT_ADDRESS (optional): " addr
  if [ -n "$addr" ]; then
    sed -i '' "s|^# HYPERLIQUID_ACCOUNT_ADDRESS=.*|HYPERLIQUID_ACCOUNT_ADDRESS=${addr}|" "$ENV_FILE"
    ok "account address saved"
  else
    info "skipped — only needed if using a separate agent wallet"
  fi

  # Step 3: ntfy channel
  ask "Step 3/5 — ntfy.sh channel for push notifications (optional)"
  info "Create a channel at ntfy.sh — get trade alerts on your phone"
  read -rp "  NTFY_CHANNEL (optional): " ntfy_channel
  if [ -n "$ntfy_channel" ]; then
    sed -i '' "s|^# NTFY_CHANNEL=.*|NTFY_CHANNEL=${ntfy_channel}|" "$ENV_FILE"
    ok "ntfy channel saved"
  else
    info "skipped — notifications disabled"
  fi

  # Step 4: ntfy token
  ask "Step 4/5 — ntfy.sh access token (optional, recommended if channel is private)"
  read -rp "  NTFY_TOKEN (optional): " ntfy_token
  if [ -n "$ntfy_token" ]; then
    sed -i '' "s|^# NTFY_TOKEN=.*|NTFY_TOKEN=${ntfy_token}|" "$ENV_FILE"
    ok "ntfy token saved"
  else
    info "skipped"
  fi

  # Step 5: LunarCrush
  ask "Step 5/5 — LunarCrush API key for sentiment data (optional)"
  info "Get a free key at lunarcrush.com/developers"
  read -rp "  LUNARCRUSH_API_KEY (optional): " lc_key
  if [ -n "$lc_key" ]; then
    sed -i '' "s|^# LUNARCRUSH_API_KEY=.*|LUNARCRUSH_API_KEY=${lc_key}|" "$ENV_FILE"
    ok "LunarCrush key saved"
  else
    info "skipped — agent runs without sentiment (advisory only)"
  fi

  echo ""
  ok ".env written to $ENV_FILE"
fi

# ── Trading profile wizard ─────────────────────────────────────────────────────

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
bold "Trading profile setup"
echo ""
echo "  Quick questions to configure your risk appetite, strategy, and coin list."
echo "  Press Enter to accept defaults. All settings can be changed later."
echo ""

# Run the wizard directly in this TTY — readline works here, won't work inside Claude.
# --no-vol-detect suppresses the separate volatility prompt so wizard runs cleanly.
if npx tsx hyperliquid-trader/src/agent.ts --wizard-only --no-vol-detect 2>/dev/null; then
  ok "Trading profile saved to hyperliquid-trader/.trading-profile.json"
else
  warn "Profile wizard skipped or cancelled — defaults will be used"
  info "Re-run any time: npx tsx hyperliquid-trader/src/agent.ts --help-me"
fi

echo ""

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
bold "Setup complete!"
echo ""
echo "  Start erde:"
echo "    erde                  — launch agent (after adding to PATH below)"
echo "    erde --dry-run        — paper trade, no real orders"
echo "    erde --help-me        — interactive setup wizard"
echo ""
echo "  Or without PATH setup:"
echo "    npm run server && npx tsx hyperliquid-trader/src/agent.ts"
echo ""
echo "  Add erde to your PATH — paste into ~/.zshrc or ~/.bashrc:"
echo "    export PATH=\"\$PATH:$(pwd)/bin\""
echo ""
echo "  Then just: erde"
echo ""
echo "  See CLAUDE.md for full documentation."
echo ""

# ── Launch Claude ─────────────────────────────────────────────────────────────

if command -v claude &>/dev/null; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  bold "Launching Claude..."
  echo ""
  sleep 1
  exec claude "erde setup is complete and the trading profile has been saved. Use your Bash tool to do these two things right now: (1) Start the web dashboard in the background: run 'npm run server'. (2) Start erde in dry-run mode: run 'npx tsx hyperliquid-trader/src/agent.ts --dry-run --no-vol-detect'. Launch both now, show me the startup output, and confirm when they are running."
else
  warn "Claude CLI not found — install it with: npm install -g @anthropic-ai/claude-code"
  echo ""
  echo "  Once installed, run: claude ."
  echo ""
fi
