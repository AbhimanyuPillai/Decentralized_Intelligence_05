import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { mountMovieScraper } from "./sellers/movie-scraper/routes.js";
import { mountMovieFacts } from "./sellers/movie-facts/routes.js";
import { mountMovieSummary } from "./sellers/movie-summary/routes.js";
import { movieScraperDefinition } from "./sellers/movie-scraper/routes.js";
import { movieFactsDefinition } from "./sellers/movie-facts/routes.js";
import { movieSummaryDefinition } from "./sellers/movie-summary/routes.js";
import { mountShelfScraper, shelfScraperDefinition } from "./sellers/shelf-scraper/routes.js";
import { mountFxRates, fxRatesDefinition } from "./sellers/fx-rates/routes.js";
import { mountHindiSummary, hindiSummaryDefinition } from "./sellers/hindi-summary/routes.js";
import { mountFakeJobsScraper, fakeJobsScraperDefinition } from "./sellers/fakejobs-scraper/routes.js";
import { mountJobFacts, jobFactsDefinition } from "./sellers/job-facts/routes.js";
import { mountJobSummary, jobSummaryDefinition } from "./sellers/job-summary/routes.js";
import { createSellerManifest } from "./sellers/shared/paidJsonEndpoint.js";
import { getSellerRegistrationSource, hideAutoSeededFreeListings, listLedgerRecords, saveLedgerRecord } from "./marketplace/database.js";
import { parseLedgerRecord } from "./marketplace/ledger.js";
import {
  findSeller,
  registerSeller,
  searchSellers
} from "./marketplace/registry.js";
import type { SellerRegistration } from "./types.js";
import { loadLocalEnvironment, readLocalTlsFiles } from "./config.js";

loadLocalEnvironment();

const app = express();
const configuredPort = process.env.MARKETPLACE_PORT ?? process.env.PORT;
const port = configuredPort ? Number(configuredPort) : 3000;
const buyerPort = process.env.BUYER_PORT ?? "3001";
const useLocalHttp = process.env.NODE_ENV !== "production" && process.env.SELLER_PAYMENTS_ENABLED !== "true";
const protocol = useLocalHttp ? "http" : "https";
const host = process.env.HOST ?? (useLocalHttp ? "::1" : "0.0.0.0");
const buyerOrigin = useLocalHttp
  ? `http://localhost:${buyerPort}`
  : process.env.BUYER_ORIGIN ?? `${protocol}://localhost:${buyerPort}`;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MARKETPLACE_PORT must be a whole number between 1 and 65535.");
}

function isRegistryApiPath(pathname: string): boolean {
  return pathname === "/api/registry" || pathname.startsWith("/api/registry/");
}

app.use(express.json({ limit: "256kb" }));
app.use((request, response, next) => {
  const isRegistryRequest = isRegistryApiPath(request.path);
  const isSellerRequest = request.path === "/sellers" || request.path.startsWith("/sellers/");
  const isMarketplaceRequest = isRegistryRequest || isSellerRequest;
  if (request.headers.origin === buyerOrigin && isMarketplaceRequest) {
    response.setHeader("Access-Control-Allow-Origin", buyerOrigin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", isSellerRequest ? "GET, POST, OPTIONS" : "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", isSellerRequest
      ? "Accept, Content-Type, PAYMENT-SIGNATURE"
      : "Accept");
    if (isSellerRequest) {
      response.setHeader("Access-Control-Expose-Headers", "PAYMENT-RESPONSE, PAYMENT-REQUIRED, RETRY-AFTER");
    }
  }
  if (request.method === "OPTIONS" && isMarketplaceRequest) {
    if (request.headers.origin !== buyerOrigin) {
      response.sendStatus(403);
      return;
    }
    response.sendStatus(204);
    return;
  }
  next();
});
mountMovieScraper(app);
mountMovieFacts(app);
mountMovieSummary(app);
mountShelfScraper(app);
mountFxRates(app);
mountHindiSummary(app);
mountFakeJobsScraper(app);
mountJobFacts(app);
mountJobSummary(app);
const hiddenAutoSeededListings = hideAutoSeededFreeListings();
if (hiddenAutoSeededListings > 0) {
  console.info(`Unlisted ${hiddenAutoSeededListings} automatic free-test seller listing(s).`);
}

// Publish the built-in sellers from the same definitions their endpoints use.
const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
const sellerBaseUrl = publicBaseUrl || `${protocol}://localhost:${port}`;
const builtInSellerDefinitions = [
  movieScraperDefinition,
  movieFactsDefinition,
  movieSummaryDefinition,
  shelfScraperDefinition,
  fxRatesDefinition,
  hindiSummaryDefinition,
  fakeJobsScraperDefinition,
  jobFactsDefinition,
  jobSummaryDefinition
];
if (process.env.NODE_ENV !== "production" || publicBaseUrl) {
  for (const definition of builtInSellerDefinitions) {
    if (getSellerRegistrationSource(definition.id) === "website") continue;
    const manifest = createSellerManifest(definition, `${sellerBaseUrl}${definition.route}`);
    if (process.env.SELLER_PAYMENTS_ENABLED === "true" && !manifest.ready) {
      console.warn(`${definition.id} is not listed because its paid seller configuration is incomplete.`);
      continue;
    }
    try {
      registerSeller(manifest, "built_in");
      console.info(`Registered built-in seller: ${definition.id}.`);
    } catch (error) {
      console.error(`Could not register built-in seller ${definition.id}.`, error instanceof Error ? error.message : "unknown error");
    }
  }
}

app.get("/api/config", (_request, response) => {
  response.json({ paymentsEnabled: process.env.SELLER_PAYMENTS_ENABLED === "true" });
});
app.use(express.static(path.join(process.cwd(), "public")));

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
  let record: ReturnType<typeof parseLedgerRecord>;
  try {
    record = parseLedgerRecord(request.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid call record.";
    response.status(400).json({ error: message });
    return;
  }

  try {
    saveLedgerRecord(record);
    response.status(201).json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save call record.";
    if (message.includes("UNIQUE constraint failed: ledger.id")) {
      response.status(409).json({ error: "A call record with this id already exists." });
      return;
    }
    console.error("Could not save call record.", message);
    response.status(500).json({ error: "Could not save call record." });
  }
});

app.get("/api/ledger", (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 100);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 500)
    : 100;

  response.json(listLedgerRecords(limit));
});

const server = useLocalHttp
  ? createHttpServer(app)
  : createHttpsServer(readLocalTlsFiles(), app);

server.listen(port, host, () => {
  console.log(`Marketplace ${protocol.toUpperCase()} listening on ${host}:${port}`);
});
