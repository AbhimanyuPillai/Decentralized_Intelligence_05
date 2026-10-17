import type { MovieSummaryInput, MovieSummaryOutput } from "./schema.js";
import { getSellerLlmConfig } from "../shared/llmConfig.js";
import { fetchModel } from "../../modelFetch.js";

const MAX_SUMMARY_CHARACTERS = 500;

// The model sometimes overshoots the length limit; cut at the last sentence end that fits.
function fitSummary(text: string): string {
  if (text.length <= MAX_SUMMARY_CHARACTERS) return text;
  const cut = text.slice(0, MAX_SUMMARY_CHARACTERS);
  const sentenceEnd = Math.max(cut.lastIndexOf("।"), cut.lastIndexOf(". "), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return sentenceEnd > 100 ? cut.slice(0, sentenceEnd + 1) : `${cut.slice(0, MAX_SUMMARY_CHARACTERS - 1)}…`;
}

const TIMEOUT_MS = 35_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as unknown;
}

export function movieSummaryReady(): boolean {
  return getSellerLlmConfig("MOVIE_SUMMARY") !== undefined;
}

export async function summarizeMoviesInHindi(input: MovieSummaryInput): Promise<MovieSummaryOutput> {
  const config = getSellerLlmConfig("MOVIE_SUMMARY");
  if (!config) throw new Error("Movie summary inference provider is not configured.");

  const source = input.items.map(({ id, title, awards, text }) => ({ id, title, awards, text }));
  const response = await fetchModel(config.endpoint, () => ({
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Write accurate, concise Hindi summaries in Devanagari using only the supplied movie facts. Do not add plot details or claims that the source text does not support. If an awards count is supplied, mention that count. Keep each summary under 400 characters. Return only JSON with this exact shape: {\"summaries\":[{\"id\":\"input id\",\"summary\":\"Hindi summary\"}]}"
        },
        { role: "user", content: JSON.stringify({ items: source }) }
      ]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }));
  if (!response.ok) {
    throw new Error(`Movie summary provider returned HTTP ${response.status}.`);
  }

  const providerBody: unknown = await response.json();
  if (!isObject(providerBody) || !Array.isArray(providerBody.choices) || !isObject(providerBody.choices[0])) {
    throw new Error("Movie summary provider returned an unexpected response.");
  }
  const message = providerBody.choices[0].message;
  if (!isObject(message) || typeof message.content !== "string") {
    throw new Error("Movie summary provider returned no summary text.");
  }

  const decoded = parseModelJson(message.content);
  if (!isObject(decoded) || !Array.isArray(decoded.summaries)) {
    throw new Error("Movie summary provider returned malformed JSON.");
  }
  const requestedIds = new Set(input.items.map((item) => item.id));
  const returnedIds = new Set<string>();
  for (const summary of decoded.summaries) {
    if (!isObject(summary) || typeof summary.id !== "string" || typeof summary.summary !== "string") {
      throw new Error("Movie summary provider returned an invalid summary item.");
    }
    if (!requestedIds.has(summary.id) || returnedIds.has(summary.id)) {
      throw new Error("Movie summary provider returned missing or duplicate item identifiers.");
    }
    const cleanText = summary.summary.trim();
    if (!cleanText || !/\p{Script=Devanagari}/u.test(cleanText)) {
      throw new Error("Movie summary provider did not return a Hindi summary in Devanagari.");
    }
    returnedIds.add(summary.id);
  }
  if (returnedIds.size !== requestedIds.size) {
    throw new Error("Movie summary provider did not return one summary for every input item.");
  }

  return {
    summaries: decoded.summaries.map((summary) => ({
      id: (summary as { id: string }).id,
      summary: fitSummary((summary as { summary: string }).summary.trim())
    }))
  };
}
