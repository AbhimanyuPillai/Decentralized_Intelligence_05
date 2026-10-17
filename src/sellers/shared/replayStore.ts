import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { PaymentPayload } from "@x402/core/types";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const configuredDatabasePath = process.env.SELLER_DATABASE_PATH?.trim();
const databasePath = path.resolve(projectRoot, configuredDatabasePath ?? "seller.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("busy_timeout = 5000");
database.exec(`
  CREATE TABLE IF NOT EXISTS seller_payment_authorizations (
    fingerprint TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('processing', 'settled', 'failed', 'unknown')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    response_status INTEGER,
    tx_hash TEXT
  );

`);

const oldCallColumns = database.pragma("table_info(seller_call_events)") as Array<{ name: string }>;
if (oldCallColumns.some((column) => column.name === "requested_year")) {
  database.exec("ALTER TABLE seller_call_events RENAME TO seller_call_events_legacy");
}
database.exec(`
  CREATE TABLE IF NOT EXISTS seller_call_events (
    id TEXT PRIMARY KEY,
    authorization_fingerprint TEXT NOT NULL,
    service_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
  );
`);
const legacyCallColumns = database.pragma("table_info(seller_call_events_legacy)") as Array<{ name: string }>;
if (legacyCallColumns.length > 0) {
  database.exec(`
    INSERT OR IGNORE INTO seller_call_events
      (id, authorization_fingerprint, service_id, outcome, latency_ms, created_at)
    SELECT id, authorization_fingerprint, service_id, outcome, latency_ms, created_at
    FROM seller_call_events_legacy
  `);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintPayment(payment: PaymentPayload): string {
  // EIP-3009 replay identity is token + chain + payer + signed nonce. It stays stable
  // even if an attacker changes unsigned x402 metadata around the same authorization.
  const body = payment.payload as {
    authorization?: { from?: unknown; nonce?: unknown };
    permit2Authorization?: { from?: unknown; nonce?: unknown; permitted?: { token?: unknown } };
  };
  const authorization = body.authorization ?? body.permit2Authorization;
  const payer = authorization?.from;
  const nonce = authorization?.nonce;
  const replayIdentity =
    typeof payer === "string" && typeof nonce === "string"
      ? {
          network: payment.accepted.network,
          asset: payment.accepted.asset.toLowerCase(),
          payer: payer.toLowerCase(),
          nonce: nonce.toLowerCase()
        }
      : payment;

  // Only the hash is persisted; the payment signature is never written to SQLite or logs.
  return createHash("sha256").update(stableJson(replayIdentity)).digest("hex");
}

const claimTransaction = database.transaction((fingerprint: string): boolean => {
  const now = new Date().toISOString();
  const inserted = database.prepare(`
    INSERT INTO seller_payment_authorizations (fingerprint, state, created_at, updated_at)
    VALUES (?, 'processing', ?, ?)
    ON CONFLICT(fingerprint) DO NOTHING
  `).run(fingerprint, now, now);
  if (inserted.changes === 1) return true;

  // A confirmed pre-settlement service failure releases the authorization for retry.
  const retry = database.prepare(`
    UPDATE seller_payment_authorizations
    SET state = 'processing', updated_at = ?, response_status = NULL, tx_hash = NULL
    WHERE fingerprint = ? AND state = 'failed'
  `).run(now, fingerprint);
  return retry.changes === 1;
});

export function claimPayment(fingerprint: string): boolean {
  return claimTransaction(fingerprint);
}

export function finishPayment(
  fingerprint: string,
  serviceId: string,
  outcome: "settled" | "failed" | "unknown",
  responseStatus: number,
  txHash: string | null,
  latencyMs: number
): void {
  const now = new Date().toISOString();
  const transaction = database.transaction(() => {
    database.prepare(`
      UPDATE seller_payment_authorizations
      SET state = ?, updated_at = ?, response_status = ?, tx_hash = ?
      WHERE fingerprint = ? AND state = 'processing'
    `).run(outcome, now, responseStatus, txHash, fingerprint);
    database.prepare(`
      INSERT INTO seller_call_events
        (id, authorization_fingerprint, service_id, outcome, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), fingerprint, serviceId, outcome, latencyMs, now);
  });
  transaction();
}
