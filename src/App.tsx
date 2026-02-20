/**
 * erde — crypto trading analytics dashboard.
 * Two pages: Trades (main) and P&L.
 */

import { useState } from "react";
import { TradesPage } from "./components/pages/TradesPage";
import { PnLPageV2 } from "./components/pages/PnLPageV2";
import { NearMissPage } from "./components/pages/NearMissPage";

type Page = "trades" | "pnl" | "nearmiss";

// ── Logo ─────────────────────────────────────────────────────────────────────

function ErdeLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      {/* Live indicator dot */}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="5" fill="#22c55e" opacity="0.9" />
        <circle cx="5" cy="5" r="3" fill="#4ade80" />
      </svg>
      <span style={{ fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.02em", color: "#f1f5f9" }}>
        erde
      </span>
    </div>
  );
}

// ── Nav link ──────────────────────────────────────────────────────────────────

function NavLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        color: active ? "#f1f5f9" : "#64748b",
        fontSize: "0.9rem",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        padding: "0.4rem 0.75rem",
        borderRadius: "6px",
        background: active ? "#1e293b" : "transparent",
        transition: "all 0.15s",
      } as React.CSSProperties}
    >
      {label}
    </button>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<Page>("trades");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020817",
        color: "#e2e8f0",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid #1e293b",
          position: "sticky",
          top: 0,
          background: "#020817",
          zIndex: 50,
        }}
      >
        <ErdeLogo />

        <nav style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <NavLink label="Trades" active={page === "trades"} onClick={() => setPage("trades")} />
          <NavLink label="P&L" active={page === "pnl"} onClick={() => setPage("pnl")} />
          <NavLink label="Near Miss" active={page === "nearmiss"} onClick={() => setPage("nearmiss")} />
        </nav>

        {/* Spacer to balance logo */}
        <div style={{ width: "80px" }} />
      </header>

      {/* Page content */}
      <main style={{ padding: "1.25rem 1.5rem", maxWidth: "1400px", margin: "0 auto" }}>
        {page === "trades" && <TradesPage />}
        {page === "pnl" && <PnLPageV2 />}
        {page === "nearmiss" && <NearMissPage />}
      </main>
    </div>
  );
}

export default App;
