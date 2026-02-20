#!/usr/bin/env node
/**
 * Trader backend — Express + SQLite.
 * Serves API (users, positions), proxies Hyperliquid, serves static frontend.
 * DB: .trader/trader.db
 */

import app from "./app.ts";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Trader backend: http://localhost:${PORT}`);
  console.log(`  API: /api/users, /api/positions, /api/admin, /api/info (Hyperliquid proxy)`);
  console.log(`  DB: .trader/trader.db`);
  console.log(`  LAN/Tailscale: use your machine IP (e.g. tailscale ip -4) to access from other devices`);
});
