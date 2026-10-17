export interface SellerLlmConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

const DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export function getSellerLlmConfig(prefix: string): SellerLlmConfig | undefined {
  const endpoint = process.env[`${prefix}_API_URL`]?.trim() || DEFAULT_ENDPOINT;
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim() || process.env.LLM_API_KEY?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim() || DEFAULT_MODEL;
  if (!apiKey) return undefined;

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return { endpoint, apiKey, model };
}
