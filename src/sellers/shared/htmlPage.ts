import robotsParserModule from "robots-parser";

const REQUEST_TIMEOUT_MS = 12_000;
const robotsPolicies = new Map<string, Promise<{ isAllowed(url: string, userAgent?: string): boolean | undefined }>>();
const robotsParser = robotsParserModule as unknown as (
  url: string,
  content: string
) => { isAllowed(url: string, userAgent?: string): boolean | undefined };

async function getRobotsPolicy(origin: string, userAgent: string) {
  let policy = robotsPolicies.get(origin);
  if (!policy) {
    policy = (async () => {
      const robotsUrl = new URL("/robots.txt", origin);
      const response = await fetch(robotsUrl, {
        headers: { "user-agent": userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (response.status === 404 || response.status === 410) {
        return robotsParser(robotsUrl.toString(), "");
      }
      if (!response.ok) throw new Error(`Could not read robots.txt (HTTP ${response.status}).`);
      return robotsParser(robotsUrl.toString(), await response.text());
    })().catch((error: unknown) => {
      robotsPolicies.delete(origin);
      throw error;
    });
    robotsPolicies.set(origin, policy);
  }
  return policy;
}

export async function fetchHtmlPage(url: string, userAgent: string): Promise<string> {
  const pageUrl = new URL(url);
  const robots = await getRobotsPolicy(pageUrl.origin, userAgent);
  if (robots.isAllowed(pageUrl.toString(), userAgent) === false) {
    throw new Error("The source robots.txt policy disallows this page.");
  }

  const response = await fetch(pageUrl, {
    headers: { accept: "text/html", "user-agent": userAgent },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    throw new Error("Source returned a non-HTML response.");
  }
  return response.text();
}

export async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
