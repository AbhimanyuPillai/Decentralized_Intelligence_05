import type { FxRatesInput, FxRatesOutput } from "./schema.js";

const RATE_URL = "https://api.frankfurter.dev/v2/rate/gbp/inr";

export async function getPoundToRupeeRate(_input: FxRatesInput): Promise<FxRatesOutput> {
  const response = await fetch(RATE_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Exchange-rate source returned HTTP ${response.status}.`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Exchange-rate source returned a non-JSON response.");
  }

  const data: unknown = await response.json();
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Exchange-rate source returned malformed data.");
  }
  const row = data as Record<string, unknown>;
  if (row.base !== "GBP" || row.quote !== "INR" || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0) {
    throw new Error("Exchange-rate source did not return a valid GBP to INR rate.");
  }

  return {
    from: "GBP",
    to: "INR",
    rate: row.rate,
    timestamp: new Date().toISOString(),
    source: `Frankfurter API (rate date ${String(row.date ?? "unknown")})`
  };
}
