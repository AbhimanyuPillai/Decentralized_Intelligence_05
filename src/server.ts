import express from "express";
import path from "node:path";
import { listLedgerRecords, saveLedgerRecord } from "./marketplace/database.js";
import { parseLedgerRecord } from "./marketplace/ledger.js";
import {
  findSeller,
  registerSeller,
  searchSellers,
  seedListingsFromContract
} from "./marketplace/registry.js";
import type { SellerRegistration } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(process.cwd(), "public")));
seedListingsFromContract();

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "marketplace" });
});

// Search listings by category and maximum price in atomic USDC units.
app.get("/api/registry", (request, response) => {
  const category = request.query.category;
  const maxPriceUnits = request.query.maxPriceUnits;

  if (category && !["scraping", "data", "inference"].includes(String(category))) {
    response.status(400).json({ error: "Unsupported category." });
    return;
  }

  if (
    maxPriceUnits !== undefined &&
    !/^(0|[1-9][0-9]*)$/.test(String(maxPriceUnits))
  ) {
    response.status(400).json({ error: "maxPriceUnits must be an integer string." });
    return;
  }

  response.json(
    searchSellers({
      category: category ? String(category) : undefined,
      maxPriceUnits: maxPriceUnits ? String(maxPriceUnits) : undefined
    })
  );
});

app.get("/api/registry/:sellerId", (request, response) => {
  const seller = findSeller(request.params.sellerId);
  if (!seller) {
    response.status(404).json({ error: "Seller not found." });
    return;
  }
  response.json(seller);
});

// Seller registration never accepts reputation values from the caller.
app.post("/api/registry", (request, response) => {
  try {
    const seller = registerSeller(request.body as SellerRegistration);
    response.status(201).json(seller);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid seller listing."
    });
  }
});

// Store one complete buyer-reported call outcome.
app.post("/api/ledger", (request, response) => {
  try {
    const record = parseLedgerRecord(request.body);
    saveLedgerRecord(record);
    response.status(201).json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid call record.";
    const isDuplicate = message.includes("UNIQUE constraint failed: ledger.id");
    response.status(isDuplicate ? 409 : 400).json({ error: message });
  }
});

app.get("/api/ledger", (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 100);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : 100;

  response.json(listLedgerRecords(limit));
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Marketplace API listening on http://localhost:${port}`);
});
