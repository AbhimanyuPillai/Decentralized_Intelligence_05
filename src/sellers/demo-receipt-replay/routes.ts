import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { shelfScraperInputSchema, shelfScraperOutputSchema, type ShelfScraperInput, type ShelfScraperOutput } from "../shelf-scraper/schema.js";
import { hasFirstReplayDemoClaimed, markFirstReplayDemoClaimed, markReplayDemoBlocked, waitForReplayDemoBlock } from "./state.js";

function makeDemoResult(input: ShelfScraperInput): ShelfScraperOutput {
  return {
    page: input.page,
    books: [{
      id: "receipt-demo-book",
      title: "Receipt Replay Demo Book",
      priceGbp: 12.5,
      stars: 5,
      description: "A fixed result used to demonstrate one-time payment receipts."
    }]
  };
}

export const demoReceiptFirstDefinition: SellerListingDefinition = {
  id: "demo-receipt-first",
  name: "Demo Receipt Service A",
  category: "data",
  description: "DEMO ONLY: First service in Scout's receipt replay demo. It returns fixed data and costs 0.002 USDC.",
  route: "/sellers/demo-receipt-first/run",
  priceUnits: "2000",
  demoReplayRole: "first",
  payToEnv: "SHELF_SCRAPER_PAY_TO",
  isReady: () => process.env.SELLER_PAYMENTS_ENABLED === "true",
  onAuthorizationClaimed: (request) => markFirstReplayDemoClaimed(request.get("x-scout-replay-demo-id")),
  inputSchema: shelfScraperInputSchema,
  outputSchema: shelfScraperOutputSchema,
  handle: async (input, request) => {
    // Keep the first request pending until the second service reports the replay was blocked.
    await waitForReplayDemoBlock(request?.get("x-scout-replay-demo-id"));
    return makeDemoResult(input as ShelfScraperInput);
  }
};

export const demoReceiptSecondDefinition: SellerListingDefinition = {
  id: "demo-receipt-second",
  name: "Demo Receipt Service B",
  category: "data",
  description: "DEMO ONLY: Second service in Scout's receipt replay demo. It has matching payment terms; Scout replays Service A's receipt here, and this call must be blocked.",
  route: "/sellers/demo-receipt-second/run",
  priceUnits: "2000",
  demoReplayRole: "second",
  payToEnv: "SHELF_SCRAPER_PAY_TO",
  isReady: () => process.env.SELLER_PAYMENTS_ENABLED === "true",
  onPaymentReplayRejected: (request) => markReplayDemoBlocked(request.get("x-scout-replay-demo-id")),
  inputSchema: shelfScraperInputSchema,
  outputSchema: shelfScraperOutputSchema,
  handle: async (input) => makeDemoResult(input as ShelfScraperInput)
};

export function mountDemoReceiptReplay(app: Express): void {
  app.get("/api/demo/receipt-replay/status/:runId", (request, response) => {
    response.json({ firstClaimed: hasFirstReplayDemoClaimed(request.params.runId) });
  });
  app.post("/api/demo/receipt-replay/finish/:runId", (request, response) => {
    markReplayDemoBlocked(request.params.runId);
    response.sendStatus(204);
  });
  mountPaidJsonEndpoint(app, demoReceiptFirstDefinition);
  mountPaidJsonEndpoint(app, demoReceiptSecondDefinition);
}
