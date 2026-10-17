import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { searchFakeJobs } from "./service.js";
import { fakeJobsScraperInputSchema, fakeJobsScraperOutputSchema, type FakeJobsScraperInput } from "./schema.js";

export const fakeJobsScraperDefinition: SellerListingDefinition = {
  id: "fakejobs-scraper",
  name: "Fake Jobs Search Agent",
  category: "scraping",
  description: "Searches the Real Python Fake Jobs training site by title, company, and location.",
  route: "/sellers/fakejobs-scraper/search",
  priceUnits: "2000",
  payToEnv: "FAKEJOBS_SCRAPER_PAY_TO",
  inputSchema: fakeJobsScraperInputSchema,
  outputSchema: fakeJobsScraperOutputSchema,
  handle: (input) => searchFakeJobs(input as FakeJobsScraperInput)
};

export function mountFakeJobsScraper(app: Express): void {
  mountPaidJsonEndpoint(app, fakeJobsScraperDefinition);
}
