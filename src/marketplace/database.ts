import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LedgerRecord, Reputation, SellerListing, SellerTrustStatus } from "../types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configuredDatabasePath = process.env.MARKETPLACE_DATABASE_PATH?.trim();
const databasePath = path.resolve(projectRoot, configuredDatabasePath || "marketplace.sqlite");
const database = new Database(databasePath);

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
    created_at TEXT NOT NULL,
    scout_trusted INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS ledger_seller_id_idx ON ledger(seller_id);
  CREATE UNIQUE INDEX IF NOT EXISTS ledger_tx_hash_unique_idx
    ON ledger (json_extract(record_json, '$.txHash'))
    WHERE json_extract(record_json, '$.txHash') IS NOT NULL
      AND json_extract(record_json, '$.chainVerified') = 1;
  CREATE INDEX IF NOT EXISTS ledger_task_id_idx ON ledger (json_extract(record_json, '$.taskId'));
`);

const ledgerColumns = database.pragma("table_info(ledger)") as Array<{ name: string }>;
if (!ledgerColumns.some((column) => column.name === "scout_trusted")) {
  database.exec("ALTER TABLE ledger ADD COLUMN scout_trusted INTEGER NOT NULL DEFAULT 0");
}

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
if (!sellerColumns.some((column) => column.name === "reviewed_mismatch_count")) {
  database.exec("ALTER TABLE sellers ADD COLUMN reviewed_mismatch_count INTEGER NOT NULL DEFAULT 0");
}

const findSeller = database.prepare(
  "SELECT listing_json FROM sellers WHERE id = ? AND is_listed = 1"
);

const insertSeller = database.prepare(`
  INSERT INTO sellers (id, listing_json, created_at, updated_at, is_listed, registration_source)
  VALUES (@id, @listingJson, @now, @now, 1, @registrationSource)
  ON CONFLICT(id) DO UPDATE SET
    listing_json = excluded.listing_json,
    updated_at = excluded.updated_at,
    is_listed = 1,
    registration_source = excluded.registration_source
`);

const insertWebsiteSeller = database.prepare(`
  INSERT INTO sellers (id, listing_json, created_at, updated_at, is_listed, registration_source)
  VALUES (@id, @listingJson, @now, @now, 1, 'website')
`);

const insertLedger = database.prepare(`
  INSERT INTO ledger (id, seller_id, status, latency_ms, record_json, created_at, scout_trusted)
  VALUES (@id, @sellerId, @status, @latencyMs, @recordJson, @now, @scoutTrusted)
`);

const readLedger = database.prepare(`
  SELECT record_json
  FROM ledger
  ORDER BY created_at DESC
  LIMIT ?
`);
const readTaskLedger = database.prepare(`
  SELECT record_json
  FROM ledger
  WHERE json_extract(record_json, '$.taskId') = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

export function saveSeller(listing: SellerListing, registrationSource: "website" | "built_in" = "website"): void {
  const statement = registrationSource === "built_in" ? insertSeller : insertWebsiteSeller;
  statement.run({
    id: listing.id,
    listingJson: JSON.stringify(listing),
    ...(registrationSource === "built_in" ? { registrationSource } : {}),
    now: new Date().toISOString()
  });
}

export function getSellerRegistrationSource(id: string): string | undefined {
  const row = database.prepare("SELECT registration_source FROM sellers WHERE id = ?").get(id) as
    | { registration_source: string }
    | undefined;
  return row?.registration_source;
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

// A listing created in one payment mode must not silently remain usable in another.
export function hideWebsiteListingsFromOtherPaymentMode(paymentsEnabled: boolean): number {
  const expectedPaymentRequired = paymentsEnabled ? 1 : 0;
  const result = database.prepare(`
    UPDATE sellers
    SET is_listed = 0
    WHERE is_listed = 1
      AND registration_source = 'website'
      AND COALESCE(json_extract(listing_json, '$.paymentRequired'), -1) != ?
  `).run(expectedPaymentRequired);
  return Number(result.changes);
}

export function calculateReputation(sellerId: string): Reputation {
  const rows = database.prepare(`
    SELECT status, latency_ms, record_json, scout_trusted
    FROM ledger
    WHERE seller_id = ?
  `).all(sellerId) as Array<{ status: string; latency_ms: number; record_json: string; scout_trusted: number }>;
  // Only authenticated Scout reports include its output-schema validation result.
  const calls = rows.filter((row) => row.scout_trusted === 1);
  const successfulCalls = calls.filter((call) =>
    (call.status === "paid" && JSON.parse(call.record_json).chainVerified === true) ||
    (call.status === "completed free" && call.scout_trusted === 1)
  ).length;
  const availableCalls = calls.filter((call) => {
    const record = JSON.parse(call.record_json) as LedgerRecord;
    return record.sellerResponded === true || record.status === "paid" || record.status === "paid, output rejected";
  }).length;
  const latencies = calls
    .filter((call) => {
      const record = JSON.parse(call.record_json) as LedgerRecord;
      return record.sellerResponded === true || record.status === "paid" || record.status === "paid, output rejected";
    })
    .map((call) => call.latency_ms)
    .sort((left, right) => left - right);
  const middle = Math.floor(latencies.length / 2);
  const medianLatencyMs =
    latencies.length === 0
      ? null
      : latencies.length % 2 === 0
        ? (latencies[middle - 1] + latencies[middle]) / 2
        : latencies[middle];

  const mismatchRows = database.prepare(`
    SELECT id
    FROM ledger
    WHERE seller_id = ? AND scout_trusted = 1
      AND json_extract(record_json, '$.scamMismatch') IN ('price_mismatch', 'recipient_mismatch')
  `).all(sellerId) as Array<{ task_id: string }>;

  return {
    totalCalls: calls.length,
    successfulCalls,
    successRatePercent:
      calls.length === 0 ? null : (successfulCalls / calls.length) * 100,
    availabilityPercent: calls.length === 0 ? null : (availableCalls / calls.length) * 100,
    mismatchCount: mismatchRows.length,
    medianLatencyMs
  };
}

export function saveLedgerRecord(record: LedgerRecord, scoutTrusted = false): void {
  insertLedger.run({
    id: record.id,
    sellerId: record.sellerId,
    status: record.status,
    latencyMs: record.latencyMs,
    recordJson: JSON.stringify(record),
    now: new Date().toISOString(),
    scoutTrusted: scoutTrusted ? 1 : 0
  });
}

export function getSellerTrustStatus(sellerId: string): SellerTrustStatus {
  const mismatchCount = calculateReputation(sellerId).mismatchCount;
  const row = database.prepare("SELECT reviewed_mismatch_count FROM sellers WHERE id = ?").get(sellerId) as
    | { reviewed_mismatch_count: number }
    | undefined;
  const unreviewedMismatchCount = Math.max(0, mismatchCount - (row?.reviewed_mismatch_count ?? 0));
  if (unreviewedMismatchCount >= 2) return "blacklisted";
  if (unreviewedMismatchCount === 1) return "quarantined";
  return calculateReputation(sellerId).successfulCalls > 0 ? "active" : "unproven";
}

export function reinstateSellerAfterReview(sellerId: string): boolean {
  const mismatchCount = calculateReputation(sellerId).mismatchCount;
  const result = database.prepare(`
    UPDATE sellers SET reviewed_mismatch_count = ? WHERE id = ? AND is_listed = 1
  `).run(mismatchCount, sellerId);
  return result.changes > 0;
}

export function listLedgerRecords(limit = 100, taskId?: string): LedgerRecord[] {
  const rows = (taskId ? readTaskLedger.all(taskId, limit) : readLedger.all(limit)) as Array<{ record_json: string }>;
  return rows.map((row) => JSON.parse(row.record_json) as LedgerRecord);
}
