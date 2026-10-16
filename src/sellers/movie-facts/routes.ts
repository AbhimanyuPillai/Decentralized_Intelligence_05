import type { Express } from "express";
import { mountPaidJsonEndpoint } from "../shared/paidJsonEndpoint.js";
import { getMovieFacts } from "./service.js";
import { movieFactsInputSchema, movieFactsOutputSchema, type MovieFactsInput } from "./schema.js";

export function mountMovieFacts(app: Express): void {
  mountPaidJsonEndpoint(app, {
    id: "movie-facts",
    name: "Movie Facts Agent",
    category: "data",
    description: "Fetches concise, attributed English Wikipedia summaries for up to three movies.",
    route: "/sellers/movie-facts/lookup",
    priceUnits: "1000",
    payToEnv: "MOVIE_FACTS_PAY_TO",
    inputSchema: movieFactsInputSchema,
    outputSchema: movieFactsOutputSchema,
    handle: (input) => getMovieFacts(input as MovieFactsInput)
  });
}
