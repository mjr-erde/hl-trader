import { useState } from "react";
import { Button } from "./Button";
import { strategies } from "../lib/strategies/registry";
import { strategyMeta } from "../lib/strategies/meta";

interface StrategyPanelProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

const riskColors = { low: "#22c55e", medium: "#eab308", high: "#ef4444" };
const categoryLabels = {
  discretionary: "Discretionary",
  systematic: "Systematic",
  arbitrage: "Arbitrage",
};

function StrategyVisual({ visual }: { visual: string }) {
  const w = 100;
  const h = 36;
  const stroke = "#64748b";
  const fill = "#334155";

  const svgProps = {
    width: "100%",
    height: "100%",
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: "xMidYMid meet" as const,
  };

  if (visual === "trend-up") {
    return (
      <svg {...svgProps}>
        <path
          d={`M 4 ${h - 4} L 35 ${h - 18} L 65 ${h - 26} L ${w - 4} 4`}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (visual === "trend-down") {
    return (
      <svg {...svgProps}>
        <path
          d={`M 4 4 L 35 18 L 65 26 L ${w - 4} ${h - 4}`}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (visual === "grid") {
    return (
      <svg {...svgProps}>
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={4}
            y1={4 + i * 9}
            x2={w - 4}
            y2={4 + i * 9}
            stroke={stroke}
            strokeWidth="1"
            strokeDasharray="3 2"
          />
        ))}
      </svg>
    );
  }
  if (visual === "oscillate") {
    return (
      <svg {...svgProps}>
        <path
          d={`M 4 ${h / 2} Q 25 4, 50 ${h / 2} T ${w - 4} ${h / 2}`}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (visual === "breakout") {
    return (
      <svg {...svgProps}>
        <line x1={4} y1={h - 4} x2={40} y2={h - 4} stroke={stroke} strokeWidth="1" />
        <line x1={40} y1={h - 4} x2={40} y2={4} stroke="#3b82f6" strokeWidth="1.5" />
        <line x1={40} y1={4} x2={w - 4} y2={4} stroke={stroke} strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg {...svgProps}>
      <circle cx={w / 2} cy={h / 2} r={10} fill={fill} stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

export function StrategyPanel({ selectedId, onSelect }: StrategyPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1rem", color: "#e2e8f0" }}>
        Strategies
      </h2>
      <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "#94a3b8" }}>
        Click a strategy to select it for new trades. Expand for details.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {strategies.map((s) => {
          const meta = strategyMeta[s.id];
          const isSelected = selectedId === s.id;
          const isExpanded = expandedId === s.id;

          return (
            <div
              key={s.id}
              style={{
                background: isSelected ? "#1e3a5f" : "#1e293b",
                borderRadius: "10px",
                border: `1px solid ${isSelected ? "#3b82f6" : "#334155"}`,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                  <div
                    style={{
                      flexShrink: 0,
                      width: 56,
                      height: 36,
                      background: "#0f172a",
                      borderRadius: "6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <StrategyVisual visual={meta?.visual ?? "neutral"} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: "0.25rem" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                      {s.description}
                    </div>
                    {meta && (
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          marginTop: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            background: "#334155",
                            color: "#94a3b8",
                          }}
                        >
                          {categoryLabels[meta.category]}
                        </span>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            background: "#334155",
                            color: riskColors[meta.risk],
                          }}
                        >
                          {meta.risk} risk
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
                style={{ width: "100%", borderRadius: 0, borderTop: "1px solid #334155" }}
              >
                {isExpanded ? "▲ Less" : "▼ More"}
              </Button>

              {isExpanded && (
                <div
                  style={{
                    padding: "0 1rem 1rem",
                    borderTop: "1px solid #334155",
                  }}
                >
                  {meta && (
                    <>
                  <div style={{ marginTop: "0.75rem" }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#64748b",
                        marginBottom: "0.25rem",
                        textTransform: "uppercase",
                      }}
                    >
                      When to use
                    </div>
                    <div style={{ fontSize: "0.9rem", color: "#cbd5e1" }}>
                      {meta.whenToUse}
                    </div>
                  </div>
                  {meta.indicators.length > 0 && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#64748b",
                          marginBottom: "0.25rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Indicators
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.35rem",
                        }}
                      >
                        {meta.indicators.map((ind) => (
                          <span
                            key={ind}
                            style={{
                              fontSize: "0.8rem",
                              padding: "0.2rem 0.5rem",
                              borderRadius: "4px",
                              background: "#0f172a",
                              color: "#94a3b8",
                            }}
                          >
                            {ind}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                    </>
                  )}
                  {!meta && (
                    <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "#94a3b8" }}>
                      {s.description}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
