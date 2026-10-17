import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { shelfScraperInputSchema, shelfScraperOutputSchema } from "../shelf-scraper/schema.js";

export const demoComputeFailureDefinition: SellerListingDefinition = {
  id: "demo-compute-failure",
  name: "Demo Compute Failure (Test Only)",
  category: "scraping",
  description: "DEMO ONLY: Accepts a books scraping request, then simulates an internal compute failure before returning a result. Scout should record no service and no charge.",
  route: "/sellers/demo-compute-failure/scrape",
  priceUnits: "2000",
  demoFailureType: "compute_error",
  payToEnv: "SHELF_SCRAPER_PAY_TO",
  isReady: () => process.env.SELLER_PAYMENTS_ENABLED === "true",
  inputSchema: shelfScraperInputSchema,
  outputSchema: shelfScraperOutputSchema,
  handle: async () => {
    throw new Error("Simulated internal compute failure.");
  }
};

export function mountDemoComputeFailure(app: Express): void {
  mountPaidJsonEndpoint(app, demoComputeFailureDefinition);
}
