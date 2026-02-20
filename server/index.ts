#!/usr/bin/env node
/**
 * Trader backend — Express + SQLite.
 * Serves API (users, positions), proxies Hyperliquid, serves static frontend.
 *
 * On start: kills any existing server on this port (one instance per machine).
 * On SIGINT/SIGTERM: clean shutdown with PID file cleanup.
 */

import { execSync } from "child_process";
import fs from "fs";
import app from "./app.ts";

const PORT = Number(process.env.PORT) || 3000;
const PID_FILE = "/tmp/erde-server.pid";

// ── Kill any existing server on this port ─────────────────────────────────────

function killExisting(): void {
  // Try PID file first (fastest path — handles our own previous instances)
  try {
    const oldPid = fs.readFileSync(PID_FILE, "utf8").trim();
    if (oldPid) {
      try {
        process.kill(Number(oldPid), "SIGTERM");
        console.log(`[server] Killed previous instance (PID ${oldPid})`);
      } catch {
        // Already gone — fine
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // No PID file — nothing to do
  }

  // Also scan by port in case the old server wasn't started by us
  try {
    const result = execSync(`lsof -ti :${PORT}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    const pids = result.split("\n").filter(Boolean).map(Number).filter((p) => p !== process.pid);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`[server] Killed existing process on :${PORT} (PID ${pid})`);
      } catch {
        // Already gone
      }
    }
    if (pids.length > 0) {
      // Brief pause to let port free up
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  } catch {
    // lsof not available or nothing running — ignore
  }
}

killExisting();

// ── Write PID file ────────────────────────────────────────────────────────────

fs.writeFileSync(PID_FILE, String(process.pid));

// ── Clean shutdown ────────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n[server] ${signal} received — shutting down`);
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Trader backend: http://localhost:${PORT}`);
  console.log(`  API: /api/v2/trades, /api/sessions, /api/hl/*`);
  console.log(`  PID: ${process.pid} (${PID_FILE})`);
});
