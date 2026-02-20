/**
 * Test setup — use isolated data dir so tests don't touch real DB.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.join(__dirname, "..", ".trader-test");

if (!fs.existsSync(testDataDir)) {
  fs.mkdirSync(testDataDir, { recursive: true });
}

process.env.TRADER_DATA_DIR = testDataDir;
