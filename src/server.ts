import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
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
import { mountDemoPriceInflator, demoPriceInflatorDefinition } from "./sellers/demo-price-inflator/routes.js";
import { mountDemoRecipientSwitch, demoRecipientSwitchDefinition } from "./sellers/demo-recipient-switch/routes.js";
import { mountDemoReceiptReplay, demoReceiptFirstDefinition, demoReceiptSecondDefinition } from "./sellers/demo-receipt-replay/routes.js";
import { mountDemoComputeFailure, demoComputeFailureDefinition } from "./sellers/demo-compute-failure/routes.js";
import { createSellerManifest } from "./sellers/shared/paidJsonEndpoint.js";
import { hideAutoSeededFreeListings, hideWebsiteListingsFromOtherPaymentMode } from "./marketplace/database.js";
import { escrowAddress, escrowEnabled, escrowHoldSeconds } from "./marketplace/escrowConfig.js";
import {
  findSeller,
  registerSeller,
  searchSellers,
  reinstateSeller
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

function matchesSecret(configured: string | undefined, supplied: string | undefined): boolean {
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
mountDemoPriceInflator(app);
mountDemoRecipientSwitch(app);
mountDemoReceiptReplay(app);
mountDemoComputeFailure(app);
const hiddenAutoSeededListings = hideAutoSeededFreeListings();
if (hiddenAutoSeededListings > 0) {
  console.info(`Unlisted ${hiddenAutoSeededListings} automatic free-test seller listing(s).`);
}
const hiddenModeMismatchedListings = hideWebsiteListingsFromOtherPaymentMode(process.env.SELLER_PAYMENTS_ENABLED === "true");
if (hiddenModeMismatchedListings > 0) {
  console.warn(`Unlisted ${hiddenModeMismatchedListings} manually registered listing(s) from a different payment mode.`);
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
  jobSummaryDefinition,
  demoPriceInflatorDefinition,
  demoRecipientSwitchDefinition,
  demoReceiptFirstDefinition,
  demoReceiptSecondDefinition,
  demoComputeFailureDefinition
];
if (process.env.NODE_ENV !== "production" || publicBaseUrl) {
  for (const definition of builtInSellerDefinitions) {
    const manifest = createSellerManifest(definition, `${sellerBaseUrl}${definition.route}`);
    try {
      registerSeller(manifest, "built_in");
      console.info(`Registered built-in seller: ${definition.id}${manifest.ready ? " (ready)" : " (needs setup)"}.`);
    } catch (error) {
      console.error(`Could not register built-in seller ${definition.id}.`, error instanceof Error ? error.message : "unknown error");
    }
  }
}

app.get("/api/config", (_request, response) => {
  response.json({
    paymentsEnabled: process.env.SELLER_PAYMENTS_ENABLED === "true",
    escrow: escrowEnabled() ? { address: escrowAddress() ?? null, holdSeconds: escrowHoldSeconds() } : null
  });
});
app.use((request, response, next) => {
  if (request.path === "/ledger.html" || request.path === "/ledger.js") {
    response.sendStatus(404);
    return;
  }
  next();
});
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "marketplace" });
});

// Search listings by category and maximum price in atomic USDC units.
app.get("/api/registry", (request, response) => {
  const category = request.query.category;
  const maxPriceUnits = request.query.maxPriceUnits;
  const query = request.query.q;
  const ready = request.query.ready;

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

  if (query !== undefined && (typeof query !== "string" || query.length > 100)) {
    response.status(400).json({ error: "q must be a search string of at most 100 characters." });
    return;
  }

  if (ready !== undefined && ready !== "true" && ready !== "false") {
    response.status(400).json({ error: "ready must be true or false." });
    return;
  }

  response.json(
    searchSellers({
      category: category ? String(category) : undefined,
      maxPriceUnits: maxPriceUnits ? String(maxPriceUnits) : undefined,
      query: query ? String(query) : undefined,
      ready: ready === undefined ? undefined : ready === "true",
      includeBlocked: request.query.includeBlocked === "true"
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
    const message = error instanceof Error ? error.message : "Invalid seller listing.";
    if (message.includes("already registered")) {
      response.status(409).json({ error: message });
      return;
    }
    if (message.includes("UNIQUE constraint failed: sellers.id")) {
      response.status(409).json({ error: "A seller with this ID is already registered. Choose a new ID." });
      return;
    }
    response.status(400).json({
      error: message
    });
  }
});

app.post("/api/registry/:sellerId/reinstate", (request, response) => {
  const configuredToken = process.env.MARKETPLACE_ADMIN_TOKEN?.trim();
  const suppliedToken = request.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!matchesSecret(configuredToken, suppliedToken)) {
    response.status(403).json({ error: "Seller reinstatement requires the Marketplace admin token." });
    return;
  }
  if (!reinstateSeller(request.params.sellerId)) {
    response.status(404).json({ error: "Seller not found." });
    return;
  }
  response.json({ seller: findSeller(request.params.sellerId), reviewed: true });
});

const server = useLocalHttp
  ? createHttpServer(app)
  : createHttpsServer(readLocalTlsFiles(), app);

server.listen(port, host, () => {
  console.log(`Marketplace ${protocol.toUpperCase()} listening on ${host}:${port}`);
  if (escrowEnabled()) {
    console.info(`Escrow is on: buyers pay ${escrowAddress() ?? "an unconfigured escrow wallet"}; holds release after ${escrowHoldSeconds()} s without a dispute.`);
  }
});
