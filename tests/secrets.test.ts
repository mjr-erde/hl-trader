import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { redactSecrets } from "../server/secrets.ts";

describe("redactSecrets", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns unchanged string when no secrets present", () => {
    expect(redactSecrets("some error message")).toBe("some error message");
    expect(redactSecrets("")).toBe("");
  });

  it("redacts HYPERLIQUID_PRIVATE_KEY when present in string", () => {
    const fakeKey = "a".repeat(64);
    process.env.HYPERLIQUID_PRIVATE_KEY = fakeKey;
    const msg = `Error: key ${fakeKey} is invalid`;
    expect(redactSecrets(msg)).toBe("Error: key [HYPERLIQUID_PRIVATE_KEY] is invalid");
  });

  it("redacts HYPERLIQUID_ACCOUNT_ADDRESS when present", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    process.env.HYPERLIQUID_ACCOUNT_ADDRESS = addr;
    const msg = `Account ${addr} not found`;
    expect(redactSecrets(msg)).toBe("Account [HYPERLIQUID_ACCOUNT_ADDRESS] not found");
  });

  it("redacts NTFY_TOKEN when present", () => {
    const token = "ntfy_secret_xyz";
    process.env.NTFY_TOKEN = token;
    const msg = `Failed with token ${token}`;
    expect(redactSecrets(msg)).toBe("Failed with token [NTFY_TOKEN]");
  });

  it("does not redact when env var is unset", () => {
    delete process.env.HYPERLIQUID_PRIVATE_KEY;
    const msg = "some random 64-char hex aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(redactSecrets(msg)).toBe(msg);
  });
});
