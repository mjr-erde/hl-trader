import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadPrivateKey } from "../hyperliquid-trader/src/keyloader.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, "fixtures");

describe("loadPrivateKey", () => {
  beforeEach(() => {
    delete process.env.HYPERLIQUID_PRIVATE_KEY;
  });

  afterEach(() => {
    delete process.env.HYPERLIQUID_PRIVATE_KEY;
  });

  it("throws when env var is unset and no key file", () => {
    expect(() => loadPrivateKey({})).toThrow(/No private key found/);
  });

  it("throws when env key has invalid format (too short)", () => {
    process.env.HYPERLIQUID_PRIVATE_KEY = "abc123";
    expect(() => loadPrivateKey({})).toThrow(/Invalid key format/);
  });

  it("throws when env key has invalid format (non-hex)", () => {
    process.env.HYPERLIQUID_PRIVATE_KEY = "g".repeat(64);
    expect(() => loadPrivateKey({})).toThrow(/Invalid key format/);
  });

  it("accepts valid 64-char hex from env", () => {
    process.env.HYPERLIQUID_PRIVATE_KEY = "a".repeat(64);
    const key = loadPrivateKey({});
    expect(key).toMatch(/^0x[a-f0-9]{64}$/);
    expect(key).toBe("0x" + "a".repeat(64));
  });

  it("accepts 0x-prefixed hex from env", () => {
    process.env.HYPERLIQUID_PRIVATE_KEY = "0x" + "b".repeat(64);
    const key = loadPrivateKey({});
    expect(key).toBe("0x" + "b".repeat(64));
  });

  it("throws when key file not found", () => {
    expect(() => loadPrivateKey({ keyFile: "/nonexistent/path/key.txt" })).toThrow(/Key file not found/);
  });

  it("throws when key file has invalid format", async () => {
    const keyPath = path.join(testDir, "invalid-key.txt");
    if (!fs.existsSync(path.dirname(keyPath))) {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    }
    fs.writeFileSync(keyPath, "not-64-hex-chars");
    try {
      expect(() => loadPrivateKey({ keyFile: keyPath })).toThrow(/Invalid key format/);
    } finally {
      if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
    }
  });

  it("loads valid key from file", async () => {
    const keyPath = path.join(testDir, "valid-key.txt");
    if (!fs.existsSync(path.dirname(keyPath))) {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    }
    fs.writeFileSync(keyPath, "c".repeat(64));
    try {
      const key = loadPrivateKey({ keyFile: keyPath });
      expect(key).toBe("0x" + "c".repeat(64));
    } finally {
      if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
    }
  });
});
