// Free model API tiers (such as Groq's) rate-limit tokens per minute and answer HTTP 429
// with "try again in N s". Escrow adds AI checks, so wait and retry instead of failing.
const MAX_ATTEMPTS = 10;
const MAX_SINGLE_WAIT_MS = 15_000;

async function retryDelayMs(response: Response): Promise<number> {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const text = await response.clone().text().catch(() => "");
  const match = /try again in ([0-9.]+)\s*(ms|s)/i.exec(text);
  if (!match) return 5_000;
  return match[2].toLowerCase() === "ms" ? Number(match[1]) : Number(match[1]) * 1000;
}

/** fetch() for model APIs that retries rate-limited calls. `init` is rebuilt per attempt so timeouts restart. */
export async function fetchModel(url: string, init: () => RequestInit, maxTotalWaitMs = 60_000): Promise<Response> {
  let waitedMs = 0;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, init());
    if (response.status !== 429 || attempt >= MAX_ATTEMPTS) return response;
    const delayMs = Math.min((await retryDelayMs(response)) + 250, MAX_SINGLE_WAIT_MS);
    if (waitedMs + delayMs > maxTotalWaitMs) return response;
    waitedMs += delayMs;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/** Keeps large JSON evidence within a model's token budget. */
export function compactForModel(value: unknown, maxCharacters = 6_000): unknown {
  const text = JSON.stringify(value) ?? "null";
  return text.length > maxCharacters ? `${text.slice(0, maxCharacters)}… (truncated)` : value;
}
