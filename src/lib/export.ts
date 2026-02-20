/**
 * CSV export utility for erde trade data.
 * Generates a properly-named CSV file from the current filtered view.
 */

export interface ExportFilters {
  agent?: string;
  operator?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  coin?: string;
  side?: string;
  mode?: string;
  marketplace?: string;
  rule?: string;
}

/**
 * Trigger a CSV download from the server for the current filter state.
 * Filename: erde-trades-YYYYMMDD-HHMM-{agent}-{operator}.csv
 */
export async function downloadTradesCsv(
  filters: ExportFilters,
  baseUrl = ""
): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }

  // Convert date strings to epoch ms if present
  if (filters.from) {
    params.set("from", String(new Date(filters.from).getTime()));
  }
  if (filters.to) {
    // End of day
    const end = new Date(filters.to);
    end.setHours(23, 59, 59, 999);
    params.set("to", String(end.getTime()));
  }

  const url = `${baseUrl}/api/v2/trades/export?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? generateFilename(filters);

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

function generateFilename(filters: ExportFilters): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const agent = (filters.agent ?? "all").replace(/[^a-z0-9_-]/gi, "-").slice(0, 30);
  const operator = (filters.operator ?? "all").replace(/[^a-z0-9_-]/gi, "-").slice(0, 20);
  return `erde-trades-${date}-${time}-${agent}-${operator}.csv`;
}
