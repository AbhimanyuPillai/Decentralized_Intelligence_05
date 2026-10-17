import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getEscrowHold, listEscrowHolds, listLedgerRecords, saveLedgerRecord } from "./marketplace/database.js";
import { EscrowError, openEscrowHold, parseVerdict, resolveByHuman, startEscrowSweeper, submitVerdict } from "./marketplace/escrow.js";
import { escrowAddress, escrowEnabled, escrowHoldSeconds } from "./marketplace/escrowConfig.js";
import { LedgerVerificationUnavailableError, parseLedgerRecord, verifyPaidLedgerRecord } from "./marketplace/ledger.js";
import { loadLocalEnvironment, readLocalTlsFiles } from "./config.js";

loadLocalEnvironment();

const app = express();
const port = Number(process.env.LEDGER_PORT ?? 3002);
const buyerPort = process.env.BUYER_PORT ?? "3001";
const useLocalHttp = process.env.NODE_ENV !== "production" && process.env.SELLER_PAYMENTS_ENABLED !== "true";
const protocol = useLocalHttp ? "http" : "https";
const host = process.env.HOST ?? (useLocalHttp ? "::1" : "0.0.0.0");
const buyerOrigin = useLocalHttp
  ? `http://localhost:${buyerPort}`
  : process.env.BUYER_ORIGIN ?? `${protocol}://localhost:${buyerPort}`;
const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("LEDGER_PORT must be a whole number between 1 and 65535.");
}

function matchesSecret(configured: string | undefined, supplied: string | undefined): boolean {
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

app.use(express.json({ limit: "256kb" }));
app.use((request, response, next) => {
  if (request.path !== "/api/ledger") return next();

  if (request.headers.origin === buyerOrigin) {
    response.setHeader("Access-Control-Allow-Origin", buyerOrigin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, X-Scout-Report-Token");
  }
  if (request.method === "OPTIONS") {
    if (request.headers.origin !== buyerOrigin) {
      response.sendStatus(403);
      return;
    }
    response.sendStatus(204);
    return;
  }
  next();
});

app.use(express.static(publicDirectory, { index: false }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "marketplace-ledger" });
});

app.get("/api/config", (_request, response) => {
  const marketplacePort = process.env.MARKETPLACE_PORT ?? "3000";
  const marketplaceBaseUrl = process.env.MARKETPLACE_BASE_URL?.trim() || `${protocol}://localhost:${marketplacePort}`;
  response.json({
    marketplaceBaseUrl,
    escrow: escrowEnabled() ? { address: escrowAddress() ?? null, holdSeconds: escrowHoldSeconds() } : null
  });
});

app.get("/", (_request, response) => response.sendFile(path.join(publicDirectory, "ledger.html")));

app.post("/api/ledger", async (request, response) => {
  let record: ReturnType<typeof parseLedgerRecord>;
  try {
    record = parseLedgerRecord(request.body);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid call record." });
    return;
  }

  try {
    const configuredToken = process.env.SCOUT_MARKETPLACE_REPORT_TOKEN?.trim();
    const suppliedToken = request.get("x-scout-report-token")?.trim();
    const scoutTrusted = matchesSecret(configuredToken, suppliedToken);
    if (record.scamMismatch && !scoutTrusted) {
      response.status(403).json({ error: "Only an authenticated Scout report can record a seller safety finding." });
      return;
    }
    await verifyPaidLedgerRecord(record);
    const verifiedRecord = record.status === "paid" || record.status === "paid, output rejected"
      ? { ...record, chainVerified: true }
      : record;
    saveLedgerRecord(verifiedRecord, scoutTrusted);
    // Calls to escrowed sellers start out held; the buyer's verdict or the hold timer settles them.
    let escrow;
    try {
      escrow = openEscrowHold(verifiedRecord);
    } catch (error) {
      console.error("Could not open escrow hold.", error instanceof Error ? error.message : "unknown error");
    }
    response.status(201).json(escrow ? { ...verifiedRecord, escrow } : verifiedRecord);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save call record.";
    if (error instanceof LedgerVerificationUnavailableError) {
      response.status(503).json({ error: message });
      return;
    }
    if (message.includes("UNIQUE constraint failed: ledger.id")) {
      response.status(409).json({ error: "A call record with this id already exists." });
      return;
    }
    if (message.includes("ledger_tx_hash_unique_idx")) {
      response.status(409).json({ error: "This transaction is already recorded in the ledger." });
      return;
    }
    console.error("Could not save call record.", message);
    response.status(500).json({ error: "Could not save call record." });
  }
});

app.get("/api/ledger", (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 100);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
  const taskId = request.query.taskId;
  if (taskId !== undefined && (typeof taskId !== "string" || taskId.length > 100)) {
    response.status(400).json({ error: "taskId must be at most 100 characters." });
    return;
  }
  const records = listLedgerRecords(limit, typeof taskId === "string" ? taskId : undefined);
  const holds = listEscrowHolds(records.map((record) => record.id));
  response.json(records.map((record) => {
    const escrow = holds.get(record.id);
    return escrow ? { ...record, escrow } : record;
  }));
});

function sendEscrowError(response: express.Response, error: unknown): void {
  if (error instanceof EscrowError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Escrow request failed.", error instanceof Error ? error.message : "unknown error");
  response.status(500).json({ error: "Escrow request failed." });
}

// Without ESCROW_ADMIN_TOKEN, only someone on this computer may act as the human reviewer.
function isEscrowReviewer(request: express.Request): boolean {
  const token = process.env.ESCROW_ADMIN_TOKEN?.trim();
  if (token) return matchesSecret(token, request.get("x-admin-token")?.trim());
  return ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
}

app.get("/api/escrow/:recordId", (request, response) => {
  const hold = getEscrowHold(request.params.recordId);
  if (!hold) {
    response.status(404).json({ error: "No escrow hold exists for this call." });
    return;
  }
  response.json(hold);
});

// The buyer that paid accepts or disputes the result (signed by its wallet in paid mode).
app.post("/api/escrow/:recordId/verdict", async (request, response) => {
  try {
    response.json(await submitVerdict(request.params.recordId, parseVerdict(request.body)));
  } catch (error) {
    sendEscrowError(response, error);
  }
});

// A human reviewer settles a dispute the rules and AI judge could not, or retries a failed transfer.
app.post("/api/escrow/:recordId/resolve", async (request, response) => {
  if (!isEscrowReviewer(request)) {
    response.status(403).json({ error: "Only the marketplace reviewer can resolve disputes." });
    return;
  }
  const outcome = request.body?.outcome;
  const note = request.body?.note;
  if (outcome !== "release" && outcome !== "refund") {
    response.status(400).json({ error: "outcome must be release or refund." });
    return;
  }
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
    response.status(400).json({ error: "note must be a string of at most 500 characters." });
    return;
  }
  try {
    response.json(await resolveByHuman(request.params.recordId, outcome, note));
  } catch (error) {
    sendEscrowError(response, error);
  }
});

const server = useLocalHttp ? createHttpServer(app) : createHttpsServer(readLocalTlsFiles(), app);
server.listen(port, host, () => {
  console.log(`Marketplace ledger ${protocol.toUpperCase()} listening on ${host}:${port}`);
  if (escrowEnabled()) {
    console.info(`Escrow is on: buyers pay ${escrowAddress() ?? "an unconfigured escrow wallet"}; holds release after ${escrowHoldSeconds()} s without a dispute.`);
  }
  startEscrowSweeper();
});
