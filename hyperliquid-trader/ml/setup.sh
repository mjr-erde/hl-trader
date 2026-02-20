#!/bin/bash
# Sets up a Python virtual environment for the ML scorer.
# Run once: bash hyperliquid-trader/ml/setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
REQ="$SCRIPT_DIR/requirements.txt"

# Prefer Homebrew Python 3.11 if available (faster than macOS system 3.9)
PYTHON=""
for candidate in python3.11 python3 python; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "ERROR: No Python found. Install Python 3.9+ first."
  echo "  brew install python@3.11"
  exit 1
fi

PY_VER=$("$PYTHON" --version 2>&1)
echo "Using $PYTHON ($PY_VER)"

# Create venv
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment at $VENV_DIR..."
  "$PYTHON" -m venv "$VENV_DIR"
else
  echo "Virtual environment already exists at $VENV_DIR"
fi

# Install/upgrade dependencies
echo "Installing dependencies..."
"$VENV_DIR/bin/pip" install --upgrade pip --quiet
"$VENV_DIR/bin/pip" install -r "$REQ" --quiet

echo ""
echo "✓ Setup complete. Python: $("$VENV_DIR/bin/python3" --version)"
echo ""
echo "Next steps:"
echo "  1. Export training data:  npx tsx hyperliquid-trader/src/backtest-export.ts"
echo "  2. Initial training:      $VENV_DIR/bin/python3 $SCRIPT_DIR/scorer.py --mode train --data $SCRIPT_DIR/data/backtest_export.jsonl"
echo "  3. Smoke test:            echo '{\"coin\":\"BTC\",\"side\":\"short\",\"rule\":\"R4-trend\",\"adx\":28,\"plus_di\":18,\"minus_di\":31,\"rsi\":44,\"macd_histogram\":-0.002,\"bb_width\":0.045,\"atr_pct\":0.008,\"regime\":\"trending\",\"galaxy_score\":55,\"sentiment_pct\":48,\"alt_rank\":120}' | $VENV_DIR/bin/python3 $SCRIPT_DIR/scorer.py --mode score"
