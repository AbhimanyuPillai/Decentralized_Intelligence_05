import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { hindiBookSummaryReady, summarizeBooksInHindi } from "./service.js";
import { hindiBookSummaryInputSchema, hindiBookSummaryOutputSchema, type HindiBookSummaryInput } from "./schema.js";

export const hindiSummaryDefinition: SellerListingDefinition = {
  id: "hindi-summary",
  name: "Hindi Summary Agent",
  category: "inference",
  description: "Produces concise Hindi summaries for one or two supplied book descriptions per request.",
  route: "/sellers/hindi-summary/summarise",
  priceUnits: "10000",
  payToEnv: "HINDI_SUMMARY_PAY_TO",
  isReady: hindiBookSummaryReady,
  inputSchema: hindiBookSummaryInputSchema,
  outputSchema: hindiBookSummaryOutputSchema,
  handle: (input) => summarizeBooksInHindi(input as HindiBookSummaryInput)
};

export function mountHindiSummary(app: Express): void {
  mountPaidJsonEndpoint(app, hindiSummaryDefinition);
}
