/**
 * Explains strategies and exits on the Live page.
 * Helps users understand chart lines and strategy targets.
 */

import { useState } from "react";
import { strategyMeta } from "../lib/strategies/meta";
import { strategies } from "../lib/strategies/registry";

export function LiveStrategyInfo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      style={{
        marginBottom: "1.5rem",
        background: "#0f172a",
        borderRadius: "8px",
        border: "1px solid #334155",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "0.75rem 1rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#e2e8f0",
          fontSize: "0.95rem",
          fontWeight: 600,
        }}
      >
        Strategies & exits
        <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid #334155" }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#64748b",
                marginBottom: "0.5rem",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Chart lines
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.9rem", color: "#cbd5e1" }}>
              <span>
                <span style={{ color: "#22c55e", fontWeight: 600 }}>Entry</span> — price you opened the position
              </span>
              <span>
                <span style={{ color: "#22c55e", fontWeight: 600 }}>TP</span> — take-profit target (close in profit)
              </span>
              <span>
                <span style={{ color: "#ef4444", fontWeight: 600 }}>SL</span> — stop-loss target (limit loss)
              </span>
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#64748b",
                marginBottom: "0.5rem",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Strategy targets (TP / SL)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "0.5rem",
              }}
            >
              {strategies.map((s) => {
                const meta = strategyMeta[s.id];
                const hasTargets = meta?.takeProfitPct != null && meta?.stopLossPct != null;
                return (
                  <div
                    key={s.id}
                    style={{
                      padding: "0.5rem 0.75rem",
                      background: "#1e293b",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: "0.2rem" }}>
                      {s.name}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                      {meta?.whenToUse ?? s.description}
                    </div>
                    {hasTargets ? (
                      <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                        TP {(meta!.takeProfitPct! * 100).toFixed(1)}% · SL {(meta!.stopLossPct! * 100).toFixed(1)}%
                      </div>
                    ) : (
                      <div style={{ fontSize: "0.8rem", color: "#64748b" }}>No default targets</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
