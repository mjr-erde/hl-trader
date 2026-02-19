/**
 * Load private key from env or file.
 * Never log or expose the key.
 */

import * as fs from "fs";
import * as path from "path";

const DEFAULT_KEY_ENV = "HYPERLIQUID_PRIVATE_KEY";

export interface KeyLoaderOptions {
  keyFile?: string;
  keyEnv?: string;
}

export function loadPrivateKey(opts: KeyLoaderOptions = {}): `0x${string}` {
  const keyEnv = opts.keyEnv ?? DEFAULT_KEY_ENV;

  if (opts.keyFile) {
    const resolved = path.resolve(opts.keyFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Key file not found: ${resolved}`);
    }
    let raw = fs.readFileSync(resolved, "utf-8").trim();
    // If .age or .sops, user must decrypt externally and pass via env or pipe
    if (resolved.endsWith(".age") || resolved.endsWith(".sops")) {
      throw new Error(
        `Encrypted key files require manual decryption. Use: age -d ${resolved} > /tmp/key.env && source /tmp/key.env`
      );
    }
    raw = raw.replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error("Invalid key format: expected 64 hex chars (with or without 0x)");
    }
    return `0x${raw}` as `0x${string}`;
  }

  const fromEnv = process.env[keyEnv];
  if (!fromEnv) {
    throw new Error(
      `No private key found. Set ${keyEnv} in .env or use --key-file <path>. ` +
        `Use an agent wallet (trade-only) from app.hyperliquid.xyz/API`
    );
  }
  const raw = fromEnv.replace(/^0x/i, "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("Invalid key format in env: expected 64 hex chars");
  }
  return `0x${raw}` as `0x${string}`;
}
