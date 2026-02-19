#!/usr/bin/env bash
# erde — first-run installer + secrets wizard + Claude Code launcher
# Idempotent — safe to re-run on upgrades.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="$SCRIPT_DIR/.erde-installed"
HL_ENV="$SCRIPT_DIR/hyperliquid-trader/.env"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "  ${BLUE}→${RESET}  $*"; }
success() { echo -e "  ${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "  ${RED}✗${RESET}  $*" >&2; }

# ── Prerequisites ────────────────────────────────────────────────────────────

check_node() {
  if ! command -v node &>/dev/null; then
    error "Node.js is required. Install from https://nodejs.org (v20+)"
    exit 1
  fi
  local version
  version=$(node -e "process.exit(+process.version.slice(1).split('.')[0] < 20)" 2>/dev/null && echo "ok" || echo "old")
  if [[ "$version" == "old" ]]; then
    warn "Node.js v20+ recommended. Current: $(node --version)"
  else
    success "Node.js $(node --version)"
  fi
}

check_python() {
  if ! command -v python3 &>/dev/null; then
    warn "Python 3 not found — ML scorer will be unavailable. Install from https://python.org"
    return
  fi
  success "Python $(python3 --version 2>&1 | cut -d' ' -f2)"
}

check_git() {
  if ! command -v git &>/dev/null; then
    error "git is required."
    exit 1
  fi
  success "git $(git --version | cut -d' ' -f3)"
}

# ── Package install ──────────────────────────────────────────────────────────

install_packages() {
  echo ""
  info "Installing npm packages..."
  cd "$SCRIPT_DIR" && npm install --silent
  success "npm packages installed"
}

setup_ml() {
  local setup_sh="$SCRIPT_DIR/hyperliquid-trader/ml/setup.sh"
  if [[ -f "$setup_sh" ]] && command -v python3 &>/dev/null; then
    info "Setting up ML environment..."
    bash "$setup_sh" >/dev/null 2>&1 && success "ML Python venv ready" || warn "ML setup failed — scorer will be unavailable"
  fi
}

# ── Env wizard (first install only) ─────────────────────────────────────────

write_env() {
  local key="$1" value="$2"
  local env_file="$HL_ENV"
  mkdir -p "$(dirname "$env_file")"
  touch "$env_file"
  chmod 600 "$env_file"
  # Remove existing line for this key, then append new value
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    local tmp
    tmp=$(mktemp)
    grep -v "^${key}=" "$env_file" > "$tmp"
    mv "$tmp" "$env_file"
    chmod 600 "$env_file"
  fi
  echo "${key}=${value}" >> "$env_file"
}

read_secret() {
  local prompt="$1"
  local value=""
  printf "  %s" "$prompt"
  read -rs value
  echo ""
  echo "$value"
}

read_value() {
  local prompt="$1"
  local default="${2:-}"
  local value=""
  if [[ -n "$default" ]]; then
    printf "  %s [%s]: " "$prompt" "$default"
  else
    printf "  %s: " "$prompt"
  fi
  read -r value
  echo "${value:-$default}"
}

run_setup_wizard() {
  echo ""
  echo -e "${BOLD}════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  erde — First-Time Setup${RESET}"
  echo -e "${BOLD}════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  This wizard will configure your trading environment."
  echo "  Secrets are stored locally in hyperliquid-trader/.env"
  echo "  and are never committed to git."
  echo ""

  # Step 1: Hyperliquid private key
  echo -e "${BOLD}  Step 1/5: Hyperliquid agent wallet private key${RESET}"
  echo "  Create one at: https://app.hyperliqual.xyz/API"
  echo "  (trade-only wallet — no withdrawal permission needed)"
  local pk
  pk=$(read_secret "Paste private key [0x...] (hidden): ")
  if [[ -n "$pk" ]]; then
    write_env "HYPERLIQUID_PRIVATE_KEY" "$pk"
    success "Private key saved"
  else
    warn "Skipped — set HYPERLIQUID_PRIVATE_KEY in hyperliquid-trader/.env later"
  fi
  echo ""

  # Step 2: Main account address
  echo -e "${BOLD}  Step 2/5: Hyperliquid main account address${RESET}"
  echo "  Your main wallet address (where USDC lives)."
  local addr
  addr=$(read_value "Address [0x...]")
  if [[ -n "$addr" ]]; then
    write_env "HYPERLIQUID_ACCOUNT_ADDRESS" "$addr"
    success "Account address saved"
  else
    warn "Skipped — set HYPERLIQUID_ACCOUNT_ADDRESS later"
  fi
  echo ""

  # Step 3: ntfy.sh
  echo -e "${BOLD}  Step 3/5: ntfy.sh push notifications${RESET}"
  echo "  Create a free channel at https://ntfy.sh"
  local ntfy_channel
  ntfy_channel=$(read_value "Channel name" "my-trader")
  write_env "NTFY_CHANNEL" "$ntfy_channel"
  local ntfy_token
  ntfy_token=$(read_secret "Access token (from ntfy.sh Settings → Access tokens, press Enter to skip): ")
  if [[ -n "$ntfy_token" ]]; then
    write_env "NTFY_TOKEN" "$ntfy_token"
    success "ntfy configured"
  else
    write_env "NTFY_TOKEN" ""
    warn "No token set — ntfy channel will be public"
  fi
  echo ""

  # Step 4: LunarCrush
  echo -e "${BOLD}  Step 4/5: LunarCrush API key (optional)${RESET}"
  echo "  Enables sentiment signals. Free at https://lunarcrush.com/developers"
  local lc_key
  lc_key=$(read_secret "API key (press Enter to skip): ")
  if [[ -n "$lc_key" ]]; then
    write_env "LUNARCRUSH_API_KEY" "$lc_key"
    success "LunarCrush key saved"
  else
    warn "Skipped — sentiment signals disabled (can be added later)"
  fi
  echo ""

  # Step 5: Trading environment
  echo -e "${BOLD}  Step 5/5: Trading database${RESET}"
  echo "  1. local       (.trader/trader-local.db)  — development/testing"
  echo "  2. production  (.trader/trader.db)         — real trading [default]"
  local env_choice
  env_choice=$(read_value "Choice" "2")
  if [[ "$env_choice" == "1" ]]; then
    write_env "TRADER_ENV" "local"
    success "Using local database"
  else
    write_env "TRADER_ENV" "production"
    success "Using production database"
  fi
  echo ""

  echo -e "${GREEN}${BOLD}  Setup complete!${RESET}"
  echo ""
  echo "  Secrets saved to: hyperliquid-trader/.env"
  echo "  To edit later:    open hyperliquid-trader/.env in your editor"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}erde install${RESET}"
echo ""

check_node
check_python
check_git

install_packages
setup_ml

is_first_install() { [[ ! -f "$MARKER" ]]; }

if is_first_install; then
  run_setup_wizard
  touch "$MARKER"
  info "First-time setup marker created: .erde-installed"
else
  success "Already configured (found .erde-installed)"
  echo ""
  echo "  To re-run the setup wizard, delete .erde-installed and run ./install.sh again."
  echo "  Or edit hyperliquid-trader/.env directly."
fi

# ── Launch Claude Code ────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}  Launch Claude Code?${RESET}"
echo ""

if command -v claude &>/dev/null; then
  echo "  Claude Code is installed."
  echo "  It will read CLAUDE.md and be ready to help you run the agent."
  echo ""
  printf "  Launch claude now? [Y/n]: "
  read -r launch_choice
  if [[ "${launch_choice:-y}" =~ ^[Yy]$ ]]; then
    echo ""
    echo "  Starting Claude Code..."
    exec claude .
  fi
else
  echo "  Claude Code is not installed."
  echo ""
  echo "  To install:  npm install -g @anthropic-ai/claude-code"
  echo "  Then run:    claude ."
  echo ""
  echo "  To start the agent directly:"
  echo "    npm run server              # start web UI (port 3000)"
  echo "    npx tsx hyperliquid-trader/src/agent.ts --dry-run --interval 3   # paper trading"
  echo "    npx tsx hyperliquid-trader/src/agent.ts --interval 3             # live trading"
fi

echo ""
