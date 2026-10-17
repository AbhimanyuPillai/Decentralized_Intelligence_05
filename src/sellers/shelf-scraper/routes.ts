import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { scrapeBooks } from "./service.js";
import { shelfScraperInputSchema, shelfScraperOutputSchema, type ShelfScraperInput } from "./schema.js";

export const shelfScraperDefinition: SellerListingDefinition = {
  id: "shelf-scraper",
  name: "Shelf Scraper Agent",
  category: "scraping",
  description: "Scrapes one Books to Scrape catalogue page and returns book titles, GBP prices, star ratings, and descriptions.",
  route: "/sellers/shelf-scraper/scrape",
  priceUnits: "5000",
  payToEnv: "SHELF_SCRAPER_PAY_TO",
  inputSchema: shelfScraperInputSchema,
  outputSchema: shelfScraperOutputSchema,
  handle: (input) => scrapeBooks(input as ShelfScraperInput)
};

export function mountShelfScraper(app: Express): void {
  mountPaidJsonEndpoint(app, shelfScraperDefinition);
}
