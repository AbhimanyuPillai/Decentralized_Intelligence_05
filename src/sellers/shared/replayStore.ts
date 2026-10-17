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
    service_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('processing', 'settled', 'failed', 'unknown')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    response_status INTEGER,
    tx_hash TEXT
  );

`);

const authorizationColumns = database.pragma("table_info(seller_payment_authorizations)") as Array<{ name: string }>;
if (!authorizationColumns.some((column) => column.name === "service_id")) {
  // Older receipts have no recorded service. Keep them blocked rather than risk reuse.
  database.exec("ALTER TABLE seller_payment_authorizations ADD COLUMN service_id TEXT NOT NULL DEFAULT ''");
}

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

export type PaymentClaimResult =
  | { claimed: true }
  | { claimed: false; reason: "wrong_service" | "in_progress" | "already_used" | "settlement_unknown" };

const claimTransaction = database.transaction((fingerprint: string, serviceId: string): PaymentClaimResult => {
  const now = new Date().toISOString();
  const previous = database.prepare(`
    SELECT service_id, state FROM seller_payment_authorizations WHERE fingerprint = ?
  `).get(fingerprint) as { service_id: string; state: "processing" | "settled" | "failed" | "unknown" } | undefined;
  if (!previous) {
    database.prepare(`
      INSERT INTO seller_payment_authorizations (fingerprint, service_id, state, created_at, updated_at)
      VALUES (?, ?, 'processing', ?, ?)
    `).run(fingerprint, serviceId, now, now);
    return { claimed: true };
  }

  if (previous.service_id !== serviceId) return { claimed: false, reason: "wrong_service" };
  if (previous.state === "processing") return { claimed: false, reason: "in_progress" };
  if (previous.state === "settled") return { claimed: false, reason: "already_used" };
  if (previous.state === "unknown") return { claimed: false, reason: "settlement_unknown" };

  const inserted = database.prepare(`
    UPDATE seller_payment_authorizations
    SET state = 'processing', updated_at = ?, response_status = NULL, tx_hash = NULL
    WHERE fingerprint = ? AND service_id = ? AND state = 'failed'
  `).run(now, fingerprint, serviceId);
  return inserted.changes === 1
    ? { claimed: true }
    : { claimed: false, reason: "in_progress" };
});

export function claimPayment(fingerprint: string, serviceId: string): PaymentClaimResult {
  return claimTransaction(fingerprint, serviceId);
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
