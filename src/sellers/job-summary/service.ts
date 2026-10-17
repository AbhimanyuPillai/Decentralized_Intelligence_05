import type { JobSummaryInput, JobSummaryOutput } from "./schema.js";

const TIMEOUT_MS = 35_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jobSummaryReady(): boolean {
  const endpoint = process.env.JOB_SUMMARY_API_URL?.trim();
  const key = process.env.JOB_SUMMARY_API_KEY?.trim();
  const model = process.env.JOB_SUMMARY_MODEL?.trim();
  if (!endpoint || !key || !model) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

export async function summarizeJobs(input: JobSummaryInput): Promise<JobSummaryOutput> {
  const apiUrl = process.env.JOB_SUMMARY_API_URL;
  const apiKey = process.env.JOB_SUMMARY_API_KEY;
  const model = process.env.JOB_SUMMARY_MODEL;
  if (!apiUrl || !apiKey || !model) throw new Error("Job summary inference provider is not configured.");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Summarize each supplied job description in 1-3 clear sentences. Use only the supplied facts; do not invent salary, benefits, or requirements. Return only JSON in this exact shape: {\"summaries\":[{\"id\":\"input id\",\"summary\":\"summary text\"}]}"
        },
        { role: "user", content: JSON.stringify(input) }
      ]
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Job summary provider returned HTTP ${response.status}.`);

  const body: unknown = await response.json();
  if (!isObject(body) || !Array.isArray(body.choices) || !isObject(body.choices[0])) {
    throw new Error("Job summary provider returned an unexpected response.");
  }
  const message = body.choices[0].message;
  if (!isObject(message) || typeof message.content !== "string") {
    throw new Error("Job summary provider returned no summary text.");
  }

  let decoded: unknown;
  try {
    const cleanJson = message.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    decoded = JSON.parse(cleanJson) as unknown;
  } catch {
    throw new Error("Job summary provider returned malformed JSON.");
  }
  if (!isObject(decoded) || !Array.isArray(decoded.summaries)) {
    throw new Error("Job summary provider returned malformed summaries.");
  }

  const requestedIds = new Set(input.items.map((item) => item.id));
  const returnedIds = new Set<string>();
  for (const item of decoded.summaries) {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.summary !== "string" || !requestedIds.has(item.id) || returnedIds.has(item.id)) {
      throw new Error("Job summary provider returned an invalid or duplicate summary.");
    }
    if (!item.summary.trim()) throw new Error("Job summary provider returned an empty summary.");
    returnedIds.add(item.id);
  }
  if (returnedIds.size !== requestedIds.size) throw new Error("Job summary provider omitted a requested job.");

  return {
    summaries: decoded.summaries.map((item) => ({
      id: (item as { id: string }).id,
      summary: (item as { summary: string }).summary.trim().slice(0, 700)
    }))
  };
}
