import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../server/app.ts";

describe("GET /api/hl/positions", () => {
  const origAccount = process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
  const origKey = process.env.HYPERLIQUID_PRIVATE_KEY;

  beforeEach(() => {
    delete process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
    delete process.env.HYPERLIQUID_PRIVATE_KEY;
  });

  afterEach(() => {
    if (origAccount) process.env.HYPERLIQUID_ACCOUNT_ADDRESS = origAccount;
    else delete process.env.HYPERLIQUID_ACCOUNT_ADDRESS;
    if (origKey) process.env.HYPERLIQUID_PRIVATE_KEY = origKey;
    else delete process.env.HYPERLIQUID_PRIVATE_KEY;
  });

  it("returns 503 when neither account nor key configured", async () => {
    const res = await request(app).get("/api/hl/positions");
    expect(res.status).toBe(503);
    // Error uses a generic code (not env var names) to avoid leaking config details
    expect(res.body.error).toBe("no_wallet");
  });
});

describe("POST /api/hl/trades", () => {
  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/hl/trades")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("username");
  });

  it("returns 400 when side is invalid", async () => {
    const res = await request(app)
      .post("/api/hl/trades")
      .send({
        username: "test",
        coin: "BTC",
        side: "invalid",
        entryPrice: 50000,
        size: 0.1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("side");
  });

  it("creates trade with valid payload", async () => {
    const res = await request(app)
      .post("/api/hl/trades")
      .send({
        username: "test-user",
        coin: "BTC",
        side: "long",
        entryPrice: 50000,
        size: 0.1,
        leverage: 5,
        strategyReason: "test signal",
      });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe("test-user");
    expect(res.body.coin).toBe("BTC");
    expect(res.body.side).toBe("long");
    expect(res.body.entry_price).toBe(50000);
    expect(res.body.size).toBe(0.1);
    expect(res.body.strategy_reason).toBe("test signal");
    expect(res.body.id).toMatch(/^hl-/);
  });
});

describe("POST /api/hl/trades/close", () => {
  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/hl/trades/close")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("coin");
  });

  it("returns 404 when no open trade to close", async () => {
    const res = await request(app)
      .post("/api/hl/trades/close")
      .send({
        username: "nonexistent-user-xyz",
        coin: "ETH",
        side: "short",
        exitPrice: 3000,
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No open trade");
  });

  it("closes trade when open trade exists", async () => {
    await request(app)
      .post("/api/hl/trades")
      .send({
        username: "close-test",
        coin: "SOL",
        side: "short",
        entryPrice: 100,
        size: 1,
      });
    const res = await request(app)
      .post("/api/hl/trades/close")
      .send({
        username: "close-test",
        coin: "SOL",
        side: "short",
        exitPrice: 95,
        realizedPnl: 5,
      });
    expect(res.status).toBe(200);
    expect(res.body.closed_at).toBeDefined();
    expect(res.body.exit_price).toBe(95);
    expect(res.body.realized_pnl).toBe(5);
  });
});

describe("GET /api/hl/trades", () => {
  it("returns 400 when username missing", async () => {
    const res = await request(app).get("/api/hl/trades");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("username");
  });

  it("returns array for valid username", async () => {
    const res = await request(app).get("/api/hl/trades?username=test-user");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /api/hl/trades/usernames", () => {
  it("returns array of usernames", async () => {
    const res = await request(app).get("/api/hl/trades/usernames");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
