/**
 * Trade confirmation and dry-run handling.
 */

import * as readline from "readline";

export interface ConfirmOptions {
  dryRun?: boolean;
  confirm?: boolean;
}

/**
 * Returns whether to proceed with the trade.
 * - dryRun: logs summary and returns false (no trade)
 * - confirm: prompts user on stdin, returns true only if they type "yes"
 * - neither: returns true (proceed)
 */
export async function confirmTrade(
  opts: ConfirmOptions,
  summary: string
): Promise<boolean> {
  if (opts.dryRun) {
    console.log("[DRY-RUN] Would execute:", summary);
    return false;
  }

  if (opts.confirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`Confirm: ${summary}\nType "yes" to proceed: `, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "yes");
      });
    });
  }

  return true;
}
