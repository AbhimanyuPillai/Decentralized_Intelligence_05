import type { Express } from "express";
import { mountPaidJsonEndpoint } from "../shared/paidJsonEndpoint.js";
import { scrapeOscarMovies } from "./service.js";
import {
  movieScraperInputSchema,
  movieScraperOutputSchema,
  type MovieScraperInput
} from "./schema.js";

export function mountMovieScraper(app: Express): void {
  mountPaidJsonEndpoint(app, {
    id: "movie-scraper",
    name: "Oscar Film Scraper Agent",
    category: "scraping",
    description: "Returns Oscar-winning films for one year (2010–2015) from Scrap This Site, including title, nominations, awards, and best-picture status.",
    route: "/sellers/movie-scraper/scrape",
    priceUnits: "5000",
    payToEnv: "MOVIE_SCRAPER_PAY_TO",
    inputSchema: movieScraperInputSchema,
    outputSchema: movieScraperOutputSchema,
    handle: (input) => scrapeOscarMovies(input as MovieScraperInput)
  });
}
