import type { Express } from "express";
import { mountPaidJsonEndpoint, type SellerListingDefinition } from "../shared/paidJsonEndpoint.js";
import { getMovieFacts } from "./service.js";
import { movieFactsInputSchema, movieFactsOutputSchema, type MovieFactsInput } from "./schema.js";

export const movieFactsDefinition: SellerListingDefinition = {
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
};

export function mountMovieFacts(app: Express): void {
  mountPaidJsonEndpoint(app, movieFactsDefinition);
}
