/**
 * Secrets handling — never log or expose.
 * Single source: hyperliquid-trader/.env
 */

const SENSITIVE_KEYS = [
  "HYPERLIQUID_PRIVATE_KEY",
  "HYPERLIQUID_ACCOUNT_ADDRESS",
  "NTFY_TOKEN",
  "TRADER_PRIVATE_KEY",
];

/** Redact sensitive values from strings. Use when logging errors. */
export function redactSecrets(str: string): string {
  let out = str;
  for (const key of SENSITIVE_KEYS) {
    const val = process.env[key];
    if (val && out.includes(val)) {
      out = out.replace(new RegExp(val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), `[${key}]`);
    }
  }
  return out;
}
