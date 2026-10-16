import robotsParserModule from "robots-parser";
import type { MovieRecord, MovieScraperInput, MovieScraperOutput } from "./schema.js";

const PAGE_URL = "https://www.scrapethissite.com/pages/ajax-javascript/";
const ROBOTS_URL = "https://www.scrapethissite.com/robots.txt";
const USER_AGENT = "PPC-Agent-Economy/1.0 (+https://www.scrapethissite.com/pages/)";
const REQUEST_TIMEOUT_MS = 12_000;

interface RobotsPolicy {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
}

const robotsParser = robotsParserModule as unknown as (url: string, text: string) => RobotsPolicy;
let robotsPolicyPromise: Promise<RobotsPolicy> | undefined;

async function getRobotsPolicy(): Promise<RobotsPolicy> {
  robotsPolicyPromise ??= (async () => {
    const response = await fetch(ROBOTS_URL, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`Could not read robots.txt (HTTP ${response.status}).`);
    }
    return robotsParser(ROBOTS_URL, await response.text());
  })().catch((error: unknown) => {
    robotsPolicyPromise = undefined;
    throw error;
  });
  return robotsPolicyPromise;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function parseMovie(value: unknown, requestedYear: number): MovieRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The source returned a malformed movie record.");
  }
  const row = value as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (
    title.length === 0 ||
    row.year !== requestedYear ||
    !isNonNegativeInteger(row.nominations) ||
    !isNonNegativeInteger(row.awards) ||
    (row.best_picture !== undefined && typeof row.best_picture !== "boolean")
  ) {
    throw new Error("The source returned a movie record that did not match the expected data.");
  }

  return {
    title,
    year: requestedYear,
    nominations: row.nominations,
    awards: row.awards,
    bestPicture: row.best_picture === true
  };
}

export async function scrapeOscarMovies(input: MovieScraperInput): Promise<MovieScraperOutput> {
  const sourceUrl = new URL(PAGE_URL);
  sourceUrl.searchParams.set("ajax", "true");
  sourceUrl.searchParams.set("year", String(input.year));

  const robots = await getRobotsPolicy();
  if (robots.isAllowed(sourceUrl.toString(), USER_AGENT) === false) {
    throw new Error("The source robots.txt policy disallows this page.");
  }

  const response = await fetch(sourceUrl, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Movie source returned HTTP ${response.status}.`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Movie source returned a non-JSON response.");
  }

  const sourceData: unknown = await response.json();
  if (!Array.isArray(sourceData) || sourceData.length === 0) {
    throw new Error("Movie source returned no movies for the requested year.");
  }

  return {
    year: input.year,
    movies: sourceData.map((movie) => parseMovie(movie, input.year))
  };
}
