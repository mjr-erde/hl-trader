import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import request from "supertest";
import app from "../server/app.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

describe("POST /api/logs/process", () => {
  const origCwd = process.cwd();

  afterEach(() => {
    process.chdir(origCwd);
  });

  it("returns 404 when logs directory does not exist", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trader-test-"));
    try {
      process.chdir(tmpDir);
      const res = await request(app)
        .post("/api/logs/process")
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("logs directory not found");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
