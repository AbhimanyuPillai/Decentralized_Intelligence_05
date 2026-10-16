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
    updated_at TEXT NOT NULL
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

const findSeller = database.prepare(
  "SELECT listing_json FROM sellers WHERE id = ?"
);

const insertSeller = database.prepare(`
  INSERT INTO sellers (id, listing_json, created_at, updated_at)
  VALUES (@id, @listingJson, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    listing_json = excluded.listing_json,
    updated_at = excluded.updated_at
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
    .prepare("SELECT listing_json FROM sellers")
    .all() as Array<{ listing_json: string }>;

  return rows
    .map((row) => JSON.parse(row.listing_json) as SellerListing)
    .sort((left, right) => left.name.localeCompare(right.name));
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
