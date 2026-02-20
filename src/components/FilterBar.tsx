/**
 * FilterBar — progressive disclosure filter bar for the erde Trades page.
 *
 * Always visible: Agent, Operator, Date range
 * Expandable (max 3 extra): Coin, Side, Mode, Strategy rule, Vol mode, Contrarian mode
 */

import { useState, useEffect } from "react";
import type { V2FilterParams, V2Filters } from "../lib/api";
import { apiV2Filters } from "../lib/api";

interface FilterBarProps {
  filters: V2FilterParams;
  onChange: (f: V2FilterParams) => void;
}

// Extra filter options beyond the always-visible 3
type ExtraFilterKey = "coin" | "side" | "mode" | "rule" | "volMode" | "contrarian";

const EXTRA_OPTIONS: { key: ExtraFilterKey; label: string }[] = [
  { key: "coin", label: "Coin" },
  { key: "side", label: "Side" },
  { key: "mode", label: "Mode" },
  { key: "rule", label: "Strategy Rule" },
  { key: "volMode", label: "Volatility Mode" },
  { key: "contrarian", label: "Contrarian Mode" },
];

const MAX_EXTRA = 3;

const selectStyle: React.CSSProperties = {
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: "6px",
  padding: "0.35rem 0.5rem",
  fontSize: "0.85rem",
  minWidth: "140px",
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  minWidth: "120px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#64748b",
  marginBottom: "2px",
  display: "block",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  background: "#1e40af22",
  border: "1px solid #1e40af55",
  color: "#93c5fd",
  borderRadius: "12px",
  padding: "2px 8px",
  fontSize: "0.75rem",
};

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const [meta, setMeta] = useState<V2Filters>({ agents: [], operators: [], coins: [], modes: [], rules: [] });
  const [expanded, setExpanded] = useState(false);
  const [activeExtras, setActiveExtras] = useState<ExtraFilterKey[]>([]);

  useEffect(() => {
    apiV2Filters().then(setMeta).catch(() => {});
  }, []);

  function set(patch: Partial<V2FilterParams>) {
    onChange({ ...filters, ...patch, page: 1 });
  }

  function clearFilter(key: keyof V2FilterParams) {
    const next = { ...filters };
    delete next[key];
    next.page = 1;
    onChange(next);
  }

  function addExtra(key: ExtraFilterKey) {
    if (activeExtras.length < MAX_EXTRA && !activeExtras.includes(key)) {
      setActiveExtras([...activeExtras, key]);
    }
    if (activeExtras.length + 1 >= MAX_EXTRA) setExpanded(false);
  }

  function removeExtra(key: ExtraFilterKey) {
    setActiveExtras(activeExtras.filter((k) => k !== key));
    // Also clear the filter value
    if (key === "coin") clearFilter("coin");
    if (key === "side") clearFilter("side");
    if (key === "mode") clearFilter("mode");
    if (key === "rule") clearFilter("rule");
    if (key === "volMode") {
      const next = { ...filters };
      delete next.marketplace; // vol mode is inferred from profile_json — for now just clear
      next.page = 1;
      onChange(next);
    }
    if (key === "contrarian") {
      // Contrarian was filtering by rule prefix C- — clear rule filter
      clearFilter("rule");
    }
  }

  // Build active chip labels
  const chips: { label: string; onRemove: () => void }[] = [];
  if (filters.agent) chips.push({ label: `Agent: ${filters.agent.slice(-20)}`, onRemove: () => clearFilter("agent") });
  if (filters.operator) chips.push({ label: `Operator: ${filters.operator}`, onRemove: () => clearFilter("operator") });
  if (filters.from) chips.push({ label: `From: ${filters.from}`, onRemove: () => clearFilter("from") });
  if (filters.to) chips.push({ label: `To: ${filters.to}`, onRemove: () => clearFilter("to") });
  if (filters.coin) chips.push({ label: `Coin: ${filters.coin}`, onRemove: () => clearFilter("coin") });
  if (filters.side) chips.push({ label: `Side: ${filters.side}`, onRemove: () => clearFilter("side") });
  if (filters.mode) chips.push({ label: `Mode: ${filters.mode}`, onRemove: () => clearFilter("mode") });
  if (filters.rule) chips.push({ label: `Rule: ${filters.rule}`, onRemove: () => clearFilter("rule") });

  const availableExtras = EXTRA_OPTIONS.filter((o) => !activeExtras.includes(o.key));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {/* Always-visible row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
        {/* Agent */}
        <div>
          <label style={labelStyle}>Agent</label>
          <select
            style={selectStyle}
            value={filters.agent ?? ""}
            onChange={(e) => set({ agent: e.target.value || undefined })}
          >
            <option value="">All agents</option>
            {meta.agents.map((a) => (
              <option key={a} value={a}>{a.length > 35 ? `…${a.slice(-30)}` : a}</option>
            ))}
          </select>
        </div>

        {/* Operator */}
        <div>
          <label style={labelStyle}>Operator</label>
          <select
            style={selectStyle}
            value={filters.operator ?? ""}
            onChange={(e) => set({ operator: e.target.value || undefined })}
          >
            <option value="">All operators</option>
            {meta.operators.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div>
          <label style={labelStyle}>From</label>
          <input
            type="date"
            style={inputStyle}
            value={filters.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined })}
          />
        </div>
        <div>
          <label style={labelStyle}>To</label>
          <input
            type="date"
            style={inputStyle}
            value={filters.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined })}
          />
        </div>

        {/* Extra filter selectors */}
        {activeExtras.includes("coin") && (
          <div>
            <label style={labelStyle}>Coin</label>
            <select
              style={selectStyle}
              value={filters.coin ?? ""}
              onChange={(e) => set({ coin: e.target.value || undefined })}
            >
              <option value="">All coins</option>
              {meta.coins.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {activeExtras.includes("side") && (
          <div>
            <label style={labelStyle}>Side</label>
            <select
              style={selectStyle}
              value={filters.side ?? ""}
              onChange={(e) => set({ side: e.target.value || undefined })}
            >
              <option value="">Both</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
        )}
        {activeExtras.includes("mode") && (
          <div>
            <label style={labelStyle}>Mode</label>
            <select
              style={selectStyle}
              value={filters.mode ?? ""}
              onChange={(e) => set({ mode: e.target.value || undefined })}
            >
              <option value="">All modes</option>
              <option value="live">Live</option>
              <option value="simulated">Simulated</option>
            </select>
          </div>
        )}
        {activeExtras.includes("rule") && (
          <div>
            <label style={labelStyle}>Strategy Rule</label>
            <select
              style={selectStyle}
              value={filters.rule ?? ""}
              onChange={(e) => set({ rule: e.target.value || undefined })}
            >
              <option value="">All rules</option>
              {meta.rules.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {activeExtras.includes("volMode") && (
          <div>
            <label style={labelStyle}>Volatility Mode</label>
            <select
              style={selectStyle}
              value=""
              onChange={(e) => {
                // Volatility mode sessions have vol_detect in profile_json
                // Filter by marker in agent name or marketplace — best we can do without profile query
                set({ marketplace: e.target.value || undefined });
              }}
            >
              <option value="">Any</option>
              <option value="hyperliquid">Hyperliquid only</option>
            </select>
          </div>
        )}
        {activeExtras.includes("contrarian") && (
          <div>
            <label style={labelStyle}>Contrarian</label>
            <select
              style={selectStyle}
              value={filters.rule?.startsWith("C-") ? "C-" : ""}
              onChange={(e) => set({ rule: e.target.value || undefined })}
            >
              <option value="">Any</option>
              <option value="C-">Contrarian only (C-)</option>
            </select>
          </div>
        )}

        {/* + More filters button */}
        {activeExtras.length < MAX_EXTRA && availableExtras.length > 0 && (
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>&nbsp;</label>
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                ...selectStyle,
                cursor: "pointer",
                minWidth: "auto",
                padding: "0.35rem 0.75rem",
                color: "#60a5fa",
                borderColor: "#1e40af55",
              }}
            >
              + Filters {activeExtras.length > 0 ? `(${activeExtras.length})` : ""}
            </button>

            {expanded && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  padding: "0.5rem",
                  zIndex: 100,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  minWidth: "180px",
                }}
              >
                {availableExtras.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => addExtra(opt.key)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#cbd5e1",
                      padding: "0.4rem 0.75rem",
                      textAlign: "left",
                      cursor: "pointer",
                      borderRadius: "4px",
                      fontSize: "0.85rem",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#334155")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Remove extra filter buttons */}
        {activeExtras.map((key) => {
          const opt = EXTRA_OPTIONS.find((o) => o.key === key)!;
          return (
            <div key={key} style={{ position: "relative" }}>
              <label style={labelStyle}>&nbsp;</label>
              <button
                onClick={() => removeExtra(key)}
                style={{
                  ...selectStyle,
                  cursor: "pointer",
                  minWidth: "auto",
                  padding: "0.35rem 0.5rem",
                  color: "#94a3b8",
                  fontSize: "0.75rem",
                }}
                title={`Remove ${opt.label} filter`}
              >
                ✕ {opt.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {chips.map((chip, i) => (
            <span key={i} style={chipStyle}>
              {chip.label}
              <button
                onClick={chip.onRemove}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => onChange({ page: 1, limit: filters.limit })}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: "0.75rem",
              padding: "2px 4px",
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
