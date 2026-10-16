import Database from "better-sqlite3";
import type { LedgerRecord, Reputation, SellerListing } from "../types.js";

const database = new Database("marketplace.sqlite");

database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");

database.exec(`
  CREATE TABLE IF NOT EXISTS sellers (
    id TEXT PRIMARY KEY,
    listing_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_listed INTEGER NOT NULL DEFAULT 1,
    registration_source TEXT NOT NULL DEFAULT 'website'
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY,
    seller_id TEXT NOT NULL REFERENCES sellers(id),
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ledger_seller_id_idx ON ledger(seller_id);
`);

const sellerColumns = database.pragma("table_info(sellers)") as Array<{ name: string }>;
if (!sellerColumns.some((column) => column.name === "is_listed")) {
  database.exec("ALTER TABLE sellers ADD COLUMN is_listed INTEGER NOT NULL DEFAULT 1");
}
if (!sellerColumns.some((column) => column.name === "registration_source")) {
  database.exec("ALTER TABLE sellers ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'website'");
  database.exec(`
    UPDATE sellers
    SET registration_source = 'legacy_seed'
    WHERE id IN ('movie-scraper', 'movie-facts', 'movie-summary')
      AND json_extract(listing_json, '$.priceUnits') = '0'
      AND json_extract(listing_json, '$.paymentRequired') = 0
      AND lower(json_extract(listing_json, '$.payTo')) = '0x0000000000000000000000000000000000000001'
  `);
}

const findSeller = database.prepare(
  "SELECT listing_json FROM sellers WHERE id = ? AND is_listed = 1"
);

const insertSeller = database.prepare(`
  INSERT INTO sellers (id, listing_json, created_at, updated_at, is_listed, registration_source)
  VALUES (@id, @listingJson, @now, @now, 1, 'website')
  ON CONFLICT(id) DO UPDATE SET
    listing_json = excluded.listing_json,
    updated_at = excluded.updated_at,
    is_listed = 1,
    registration_source = 'website'
`);

const insertLedger = database.prepare(`
  INSERT INTO ledger (id, seller_id, status, latency_ms, record_json, created_at)
  VALUES (@id, @sellerId, @status, @latencyMs, @recordJson, @now)
`);

const readLedger = database.prepare(`
  SELECT record_json
  FROM ledger
  ORDER BY created_at DESC
  LIMIT ?
`);

export function saveSeller(listing: SellerListing): void {
  insertSeller.run({
    id: listing.id,
    listingJson: JSON.stringify(listing),
    now: new Date().toISOString()
  });
}

export function getSeller(id: string): SellerListing | undefined {
  const row = findSeller.get(id) as { listing_json: string } | undefined;
  return row ? (JSON.parse(row.listing_json) as SellerListing) : undefined;
}

export function listSellers(): SellerListing[] {
  const rows = database
    .prepare("SELECT listing_json FROM sellers WHERE is_listed = 1")
    .all() as Array<{ listing_json: string }>;

  return rows
    .map((row) => JSON.parse(row.listing_json) as SellerListing)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function hideAutoSeededFreeListings(): number {
  const seededIds = new Set(["movie-scraper", "movie-facts", "movie-summary"]);
  const rows = database.prepare("SELECT id, listing_json, is_listed, registration_source FROM sellers").all() as Array<{
    id: string;
    listing_json: string;
    is_listed: number;
    registration_source: string;
  }>;
  const removeIds = rows.flatMap((row) => {
    if (!row.is_listed || row.registration_source !== "legacy_seed" || !seededIds.has(row.id)) return [];
    try {
      const listing = JSON.parse(row.listing_json) as Partial<SellerListing>;
      return listing.priceUnits === "0" &&
        listing.paymentRequired === false &&
        listing.payTo?.toLowerCase() === "0x0000000000000000000000000000000000000001"
        ? [row.id]
        : [];
    } catch {
      return [];
    }
  });
  const hideTransaction = database.transaction((ids: string[]) => {
    for (const id of ids) database.prepare("UPDATE sellers SET is_listed = 0 WHERE id = ?").run(id);
  });
  hideTransaction(removeIds);
  return removeIds.length;
}

export function calculateReputation(sellerId: string): Reputation {
  const calls = database
    .prepare("SELECT status, latency_ms FROM ledger WHERE seller_id = ?")
    .all(sellerId) as Array<{ status: string; latency_ms: number }>;

  const successfulCalls = calls.filter((call) => call.status === "paid").length;
  const latencies = calls
    .map((call) => call.latency_ms)
    .sort((left, right) => left - right);
  const middle = Math.floor(latencies.length / 2);
  const medianLatencyMs =
    latencies.length === 0
      ? null
      : latencies.length % 2 === 0
        ? (latencies[middle - 1] + latencies[middle]) / 2
        : latencies[middle];

  return {
    totalCalls: calls.length,
    successfulCalls,
    successRatePercent:
      calls.length === 0 ? null : (successfulCalls / calls.length) * 100,
    medianLatencyMs
  };
}

export function saveLedgerRecord(record: LedgerRecord): void {
  insertLedger.run({
    id: record.id,
    sellerId: record.sellerId,
    status: record.status,
    latencyMs: record.latencyMs,
    recordJson: JSON.stringify(record),
    now: new Date().toISOString()
  });
}

export function listLedgerRecords(limit = 100): LedgerRecord[] {
  const rows = readLedger.all(limit) as Array<{ record_json: string }>;
  return rows.map((row) => JSON.parse(row.record_json) as LedgerRecord);
}
