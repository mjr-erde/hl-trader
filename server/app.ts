/**
 * Express app — exported for testing.
 */

import "dotenv/config";
import dotenv from "dotenv";
import * as path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import usersRouter from "./routes/users.ts";
import positionsRouter from "./routes/positions.ts";
import adminRouter from "./routes/admin.ts";
import hlRouter from "./routes/hl.ts";
import logsRouter from "./routes/logs.ts";
import tradesRouter from "./routes/trades.ts";
import sessionsRouter from "./routes/sessions.ts";
import v2Router from "./routes/v2.ts";
import { redactSecrets } from "./secrets.ts";
import {
  getAllMids,
  getMetaAndAssetCtxs,
  getCandleSnapshot,
} from "../hyperliquid-trader/src/info.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.join(__dirname, "..", "hyperliquid-trader", ".env"),
  override: true,
});

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/users", usersRouter);
app.use("/api/positions", positionsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/hl", hlRouter);
app.use("/api/logs", logsRouter);
app.use("/api/trades", tradesRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/v2", v2Router);

app.use("/api/info", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const body = req.body as { type?: string; req?: { coin: string; interval: string; startTime: number; endTime: number } } | null;
  const type = body?.type;
  try {
    let data: unknown;
    if (type === "metaAndAssetCtxs") {
      data = await getMetaAndAssetCtxs(false);
    } else if (type === "allMids") {
      data = await getAllMids(false);
    } else if (type === "candleSnapshot" && body?.req) {
      data = await getCandleSnapshot(body.req, false);
    } else {
      res.status(400).json({ error: `Unsupported info type: ${type ?? "missing"}` });
      return;
    }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: redactSecrets(String(e)) });
  }
});

const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get("/{*path}", (req, res) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found" });
  } else if (!existsSync(path.join(distPath, "index.html"))) {
    res.status(503).send(
      "<html><body style='font:16px monospace;background:#020817;color:#e2e8f0;padding:2rem'>" +
      "<h2>erde dashboard not built</h2>" +
      "<p>Run <code style='background:#1e293b;padding:2px 6px;border-radius:4px'>npm run build</code> then restart the server.</p>" +
      "</body></html>"
    );
  } else {
    res.sendFile(path.join(distPath, "index.html"));
  }
});

export default app;
