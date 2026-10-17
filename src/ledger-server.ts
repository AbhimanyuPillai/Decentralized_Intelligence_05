import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listLedgerRecords, saveLedgerRecord } from "./marketplace/database.js";
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
  response.json({ marketplaceBaseUrl });
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
    response.status(201).json(verifiedRecord);
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
  response.json(listLedgerRecords(limit, typeof taskId === "string" ? taskId : undefined));
});

const server = useLocalHttp ? createHttpServer(app) : createHttpsServer(readLocalTlsFiles(), app);
server.listen(port, host, () => {
  console.log(`Marketplace ledger ${protocol.toUpperCase()} listening on ${host}:${port}`);
});
