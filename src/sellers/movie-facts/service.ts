import type { MovieFactsInput, MovieFactsOutput, MovieFact } from "./schema.js";

const SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const USER_AGENT = "PPC-Agent-Economy/1.0 (https://github.com/AbhimanyuPillai/PPC_agent_economy)";
const TIMEOUT_MS = 10_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchMovieFact(requestedTitle: string): Promise<MovieFact> {
  const pageTitle = requestedTitle.trim().replace(/\s+/g, "_");
  const url = `${SUMMARY_API}${encodeURIComponent(pageTitle)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`Wikipedia could not find a movie page for "${requestedTitle}" (HTTP ${response.status}).`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("Wikipedia returned a non-JSON response.");
  }

  const data: unknown = await response.json();
  if (!isObject(data) || typeof data.title !== "string" || typeof data.extract !== "string" || data.extract.trim().length === 0 || data.type === "disambiguation") {
    throw new Error(`Wikipedia returned no usable summary for "${requestedTitle}".`);
  }
  const contentUrls = isObject(data.content_urls) ? data.content_urls : undefined;
  const desktop = contentUrls && isObject(contentUrls.desktop) ? contentUrls.desktop : undefined;
  const sourceUrl = desktop && typeof desktop.page === "string"
    ? desktop.page
    : `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title.replace(/ /g, "_"))}`;

  return {
    requestedTitle,
    title: data.title,
    description: typeof data.description === "string" ? data.description : "",
    extract: data.extract.trim().slice(0, 5000),
    sourceName: "English Wikipedia",
    sourceUrl,
    retrievedAt: new Date().toISOString()
  };
}

export async function getMovieFacts(input: MovieFactsInput): Promise<MovieFactsOutput> {
  const films: MovieFact[] = [];
  for (const title of input.titles) {
    // Keep a small pause between requests to avoid sending a burst to Wikimedia.
    if (films.length > 0) await new Promise((resolve) => setTimeout(resolve, 250));
    films.push(await fetchMovieFact(title));
  }
  return { films };
}
