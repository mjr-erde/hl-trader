#!/usr/bin/env python3
"""
ML confidence scorer for the trading agent.

Modes:
  --mode train --data path.jsonl [--live path.jsonl]  → train and save model
  --mode score                                         → read JSON from stdin, write JSON to stdout

The model learns from historical backtest + live trade outcomes to produce
an empirical probability-of-win for any indicator snapshot.
"""

import sys
import json
import argparse
import os
import pathlib
import warnings

warnings.filterwarnings("ignore")

SCRIPT_DIR = pathlib.Path(__file__).parent
MODEL_DIR = SCRIPT_DIR / "model"
DATA_DIR = SCRIPT_DIR / "data"

REGIME_MAP = {"quiet": 0, "ranging": 1, "trending": 2, "volatile_trend": 3}
SIDE_MAP = {"long": 0, "short": 1}
RULE_MAP = {
    "R1-mean-reversion": 0,
    "R2-mean-reversion": 1,
    "R3-trend": 2,
    "R4-trend": 3,
    "R6-sentiment": 4,
}


def encode_rule(rule: str) -> int:
    if rule.startswith("C-"):
        return 5  # contrarian
    return RULE_MAP.get(rule, 3)  # default to R4


def build_features(row: dict, coin_encoder: dict) -> list:
    """Build 15-element feature vector from a training or scoring row."""
    adx = float(row.get("adx", 25))
    plus_di = float(row.get("plus_di", 20))
    minus_di = float(row.get("minus_di", 20))
    side_str = str(row.get("side", "long"))
    # Signed DI spread: positive = DI pointing in the right direction for the trade
    di_spread = (plus_di - minus_di) if side_str == "long" else (minus_di - plus_di)

    rsi = float(row.get("rsi", 50))
    macd_hist = float(row.get("macd_histogram", 0))
    bb_width = float(row.get("bb_width", 0.03))
    atr_pct = float(row.get("atr_pct", 0.01))
    regime = REGIME_MAP.get(str(row.get("regime", "ranging")), 1)
    side = SIDE_MAP.get(side_str, 0)
    rule = encode_rule(str(row.get("rule", "R4-trend")))

    coin = str(row.get("coin", "BTC"))
    coin_enc = coin_encoder.get(coin, coin_encoder.get("_unknown", 0))

    galaxy = float(row.get("galaxy_score", 0))
    sentiment = float(row.get("sentiment_pct", 50))
    alt_rank = float(row.get("alt_rank", 500))
    alt_rank_norm = 1.0 - min(alt_rank, 1000) / 1000.0

    return [
        adx,
        plus_di,
        minus_di,
        di_spread,
        rsi,
        macd_hist,
        bb_width,
        atr_pct,
        regime,
        side,
        rule,
        coin_enc,
        galaxy,
        sentiment,
        alt_rank_norm,
    ]


def load_jsonl(path: str) -> list:
    rows = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def train(data_path: str, live_path=None):
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import cross_val_score
        import numpy as np
        import joblib
        import datetime
    except ImportError as e:
        print(json.dumps({"error": f"Missing dependency: {e}. Run ml/setup.sh first."}))
        sys.exit(1)

    rows = load_jsonl(data_path)
    if live_path and os.path.exists(live_path):
        live_rows = load_jsonl(live_path)
        rows.extend(live_rows)

    if len(rows) < 10:
        print(json.dumps({"error": f"Too few samples: {len(rows)} (need >= 10)"}))
        sys.exit(1)

    # Build coin encoder from training data
    coins = sorted(set(str(r.get("coin", "BTC")) for r in rows))
    coin_encoder = {c: i for i, c in enumerate(coins)}
    coin_encoder["_unknown"] = len(coin_encoder)

    X = []
    y = []
    skipped = 0
    for row in rows:
        try:
            features = build_features(row, coin_encoder)
            # Support both "won" (binary 0/1) and raw pnl
            if "won" in row:
                label = int(row["won"])
            elif "pnl" in row:
                label = 1 if float(row["pnl"]) >= 0 else 0
            else:
                skipped += 1
                continue
            X.append(features)
            y.append(label)
        except Exception:
            skipped += 1

    X = np.array(X)
    y = np.array(y)

    if len(X) < 10:
        print(json.dumps({"error": f"Too few valid samples after processing: {len(X)} (skipped {skipped})"}))
        sys.exit(1)

    clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=6,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
    )

    # Cross-validate (ensure at least 2 folds)
    n_folds = min(5, max(2, len(X) // 10))
    cv_scores = cross_val_score(clf, X, y, cv=n_folds, scoring="accuracy")
    accuracy = float(cv_scores.mean())

    # Fit on all data
    clf.fit(X, y)

    # Save model + encoders + metadata
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, MODEL_DIR / "confidence_model.pkl")
    joblib.dump({"coin_encoder": coin_encoder}, MODEL_DIR / "label_encoders.pkl")

    meta = {
        "sampleCount": len(X),
        "accuracy": round(accuracy, 4),
        "lastTrainedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "cvScores": [round(float(s), 4) for s in cv_scores],
        "skipped": skipped,
    }
    with open(MODEL_DIR / "training_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(json.dumps({
        "ok": True,
        "sampleCount": len(X),
        "accuracy": round(accuracy, 4),
        "cvScores": meta["cvScores"],
    }))


def score():
    """Read JSON from stdin, write prediction to stdout. Never crashes — always outputs valid JSON."""
    try:
        import joblib
        import numpy as np
    except ImportError as e:
        print(json.dumps({"score": None, "error": f"Missing dependency: {e}"}))
        return

    model_path = MODEL_DIR / "confidence_model.pkl"
    encoders_path = MODEL_DIR / "label_encoders.pkl"
    meta_path = MODEL_DIR / "training_meta.json"

    if not model_path.exists():
        print(json.dumps({"score": None, "error": "Model not trained yet"}))
        return

    try:
        clf = joblib.load(model_path)
        encoders = joblib.load(encoders_path)
        coin_encoder = encoders["coin_encoder"]

        meta = {}
        if meta_path.exists():
            with open(meta_path) as f:
                meta = json.load(f)

        input_str = sys.stdin.read().strip()
        if not input_str:
            print(json.dumps({"score": None, "error": "Empty stdin"}))
            return

        row = json.loads(input_str)
        features = build_features(row, coin_encoder)
        X = np.array([features])

        proba = clf.predict_proba(X)[0]
        classes = list(clf.classes_)
        win_idx = classes.index(1) if 1 in classes else -1
        score_val = float(proba[win_idx]) if win_idx >= 0 else 0.5

        print(json.dumps({
            "score": round(score_val, 4),
            "modelSamples": meta.get("sampleCount", 0),
        }))

    except Exception as e:
        print(json.dumps({"score": None, "error": str(e)}))


def main():
    parser = argparse.ArgumentParser(description="ML confidence scorer")
    parser.add_argument("--mode", choices=["train", "score"], required=True)
    parser.add_argument("--data", help="Path to backtest JSONL data (train mode)")
    parser.add_argument("--live", help="Path to live trade JSONL data (optional, train mode)")
    args = parser.parse_args()

    if args.mode == "train":
        if not args.data:
            print(json.dumps({"error": "--data is required for training"}))
            sys.exit(1)
        train(args.data, args.live)
    elif args.mode == "score":
        score()


if __name__ == "__main__":
    main()
