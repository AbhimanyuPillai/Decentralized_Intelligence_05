import type { HindiBookSummaryInput, HindiBookSummaryOutput } from "./schema.js";
import { getSellerLlmConfig } from "../shared/llmConfig.js";

const TIMEOUT_MS = 35_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hindiBookSummaryReady(): boolean {
  return getSellerLlmConfig("BOOK_SUMMARY") !== undefined;
}

export async function summarizeBooksInHindi(input: HindiBookSummaryInput): Promise<HindiBookSummaryOutput> {
  const config = getSellerLlmConfig("BOOK_SUMMARY");
  if (!config) throw new Error("Book summary inference provider is not configured.");

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Write concise, accurate Hindi summaries in Devanagari using only the supplied book description. Do not invent plot details. Return JSON with this exact shape: {\"summaries\":[{\"id\":\"input id\",\"summary\":\"Hindi summary\"}]}"
        },
        { role: "user", content: JSON.stringify(input) }
      ]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Book summary provider returned HTTP ${response.status}.`);

  const body: unknown = await response.json();
  if (!isObject(body) || !Array.isArray(body.choices) || !isObject(body.choices[0])) {
    throw new Error("Book summary provider returned an unexpected response.");
  }
  const message = body.choices[0].message;
  if (!isObject(message) || typeof message.content !== "string") {
    throw new Error("Book summary provider returned no summary text.");
  }

  let decoded: unknown;
  try {
    const cleanJson = message.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    decoded = JSON.parse(cleanJson) as unknown;
  } catch {
    throw new Error("Book summary provider returned malformed JSON.");
  }
  if (!isObject(decoded) || !Array.isArray(decoded.summaries)) {
    throw new Error("Book summary provider returned malformed summaries.");
  }

  const requestedIds = new Set(input.items.map((item) => item.id));
  const returnedIds = new Set<string>();
  for (const item of decoded.summaries) {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.summary !== "string" || !requestedIds.has(item.id) || returnedIds.has(item.id)) {
      throw new Error("Book summary provider returned an invalid or duplicate item.");
    }
    if (!item.summary.trim() || !/\p{Script=Devanagari}/u.test(item.summary)) {
      throw new Error("Book summary provider did not return Hindi text in Devanagari.");
    }
    returnedIds.add(item.id);
  }
  if (returnedIds.size !== requestedIds.size) throw new Error("Book summary provider omitted a requested book.");

  return {
    summaries: decoded.summaries.map((item) => ({
      id: (item as { id: string }).id,
      summary: (item as { summary: string }).summary.trim()
    }))
  };
}
