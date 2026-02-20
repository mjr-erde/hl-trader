/**
 * Standalone trading profile wizard.
 * Runs the wizard, saves the profile, and exits.
 * Used by start-erde during first-time setup.
 *
 *   npx tsx hyperliquid-trader/src/setup-profile.ts
 */

import { runWizard, saveProfile } from "./profile.js";

const profile = await runWizard(process.stdin.isTTY);
saveProfile(profile);
process.exit(0);
