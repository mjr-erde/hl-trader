/**
 * Process agent logs via Ollama and return summary for download.
 */

import { Router } from "express";
import * as fs from "fs";
import * as path from "path";

const router = Router();
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2";

/** POST /api/logs/process — read logs, summarize via Ollama, return text for download */
router.post("/process", async (req, res) => {
  const logsDir = path.join(process.cwd(), "logs");
  const model = (req.body?.model as string) || DEFAULT_MODEL;

  if (!fs.existsSync(logsDir)) {
    res.status(404).json({ error: "logs directory not found" });
    return;
  }

  let allContent = "";
  const files = fs.readdirSync(logsDir);
  for (const file of files) {
    const filePath = path.join(logsDir, file);
    if (fs.statSync(filePath).isFile() && file !== "process-logs.sh" && !file.startsWith("processed-")) {
      try {
        const text = fs.readFileSync(filePath, "utf-8");
        allContent += `\n\n--- Source: ${file} ---\n${text}`;
      } catch {
        /* skip unreadable */
      }
    }
  }

  if (!allContent.trim()) {
    res.status(400).json({ error: "No log files to process" });
    return;
  }

  const prompt = `Read through the following text. Summarize key information discovered. Note trends, themes, or repeated information. Note obscure information. Summarize it into a conclusion no longer than 500 words.

Content to process:
${allContent}`;

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text();
      res.status(502).json({
        error: `Ollama error: ${ollamaRes.status}. Ensure Ollama is running (ollama serve) and model ${model} is available (ollama pull ${model}).`,
        detail: errText,
      });
      return;
    }

    const data = (await ollamaRes.json()) as { response?: string };
    const summary = data?.response?.trim() || "(No response from model)";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const output = `# Processed Logs Summary\nGenerated: ${new Date().toISOString()}\nModel: ${model}\n\n${summary}`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="processed-logs-${timestamp}.log"`);
    res.send(output);
  } catch (e) {
    res.status(502).json({
      error: `Failed to reach Ollama: ${(e as Error).message}. Is Ollama running?`,
    });
  }
});

export default router;
