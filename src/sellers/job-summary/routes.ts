import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { jobSummaryReady, summarizeJobs } from "./service.js";
import { jobSummaryInputSchema, jobSummaryOutputSchema, type JobSummaryInput } from "./schema.js";

export const jobSummaryDefinition: SellerListingDefinition = {
  id: "job-summary",
  name: "Fake Job Summary Agent",
  category: "inference",
  description: "Creates concise, source-grounded summaries for up to three supplied Fake Jobs descriptions.",
  route: "/sellers/job-summary/summarise",
  priceUnits: "10000",
  payToEnv: "FAKEJOBS_SUMMARY_PAY_TO",
  isReady: jobSummaryReady,
  inputSchema: jobSummaryInputSchema,
  outputSchema: jobSummaryOutputSchema,
  handle: (input) => summarizeJobs(input as JobSummaryInput)
};

export function mountJobSummary(app: Express): void {
  mountPaidJsonEndpoint(app, jobSummaryDefinition);
}
