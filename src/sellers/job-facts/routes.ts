import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { getJobFacts } from "./service.js";
import { jobFactsInputSchema, jobFactsOutputSchema, type JobFactsInput } from "./schema.js";

export const jobFactsDefinition: SellerListingDefinition = {
  id: "job-facts",
  name: "Fake Job Details Agent",
  category: "data",
  description: "Returns company, location, posting date, and full description for up to five job IDs from the Fake Jobs site.",
  route: "/sellers/job-facts/lookup",
  priceUnits: "1000",
  payToEnv: "FAKEJOBS_FACTS_PAY_TO",
  inputSchema: jobFactsInputSchema,
  outputSchema: jobFactsOutputSchema,
  handle: (input) => getJobFacts(input as JobFactsInput)
};

export function mountJobFacts(app: Express): void {
  mountPaidJsonEndpoint(app, jobFactsDefinition);
}
