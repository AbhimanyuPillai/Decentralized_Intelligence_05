import type { Express } from "express";
import { mountPaidJsonEndpoint } from "../shared/paidJsonEndpoint.js";
import { summarizeMoviesInHindi, movieSummaryReady } from "./service.js";
import { movieSummaryInputSchema, movieSummaryOutputSchema, type MovieSummaryInput } from "./schema.js";

export function mountMovieSummary(app: Express): void {
  mountPaidJsonEndpoint(app, {
    id: "movie-summary",
    name: "Hindi Movie Summary Agent",
    category: "inference",
    description: "Produces concise Hindi summaries in Devanagari from supplied, sourced movie facts.",
    route: "/sellers/movie-summary/summarise",
    priceUnits: "10000",
    payToEnv: "MOVIE_SUMMARY_PAY_TO",
    isReady: movieSummaryReady,
    inputSchema: movieSummaryInputSchema,
    outputSchema: movieSummaryOutputSchema,
    handle: (input) => summarizeMoviesInHindi(input as MovieSummaryInput)
  });
}
