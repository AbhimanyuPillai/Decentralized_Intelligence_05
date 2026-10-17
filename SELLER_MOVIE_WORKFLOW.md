# Movie seller workflow

The movie example has three built-in seller agents, one per marketplace category. The Marketplace registers them at startup from their seller manifests. Use the website's **Register seller** form only for additional services. Sellers run free by default for integration testing; set `SELLER_PAYMENTS_ENABLED=true` to require x402.

| Agent | Category | Endpoint | Paid price |
| --- | --- | --- | ---: |
| Oscar Film Scraper Agent | scraping | `POST /sellers/movie-scraper/scrape` | 2,000 units |
| Movie Facts Agent | data | `POST /sellers/movie-facts/lookup` | 1,000 units |
| Hindi Movie Summary Agent | inference | `POST /sellers/movie-summary/summarise` | 10,000 units |

One end-to-end example scrapes 2010–2013 (four scraper calls), selects three films by award count, fetches Wikipedia facts for the selected titles (one data call), then sends those facts to inference in batches of two (two inference calls). When payments are enabled, the estimated total is 29,000 atomic USDC units (0.029 USDC), below the 50,000-unit example budget. Pass each film's `title`, `awards`, and Wikipedia `extract` to inference so the summary can include the award count; keep `sourceUrl` in the buyer report for attribution.

## Configure

The scraper source (Scrap This Site) and movie-facts source (English Wikipedia) are already configured in code; they need no API keys. For now, leave `MOVIE_SUMMARY_API_URL`, `MOVIE_SUMMARY_API_KEY`, and `MOVIE_SUMMARY_MODEL` unset. The Hindi summary listing reports `ready: false`, and its endpoint returns 503 until you choose and configure an OpenAI-compatible provider. When you choose one, set its chat-completions URL and model in `.env`; put the API key in `.env` only, never in the website form or browser.

For this same-computer test, leave `PUBLIC_BASE_URL` blank. The seller routes run in the Marketplace server on port 3000 and their manifests provide the local URLs automatically. For another computer later, expose port 3000 through an HTTPS tunnel, set `PUBLIC_BASE_URL` to its origin, and restart the server. Free test routes are limited to 30 requests per minute per seller and client IP.

In free test mode, the website sets the price to zero and does not ask for a wallet. To enable paid registration later, set `SELLER_PAYMENTS_ENABLED=true`; the form will then require a positive price, HTTPS endpoint, and Base Sepolia receiving wallet.

## Built-in seller listings

1. Start the Marketplace and open `http://localhost:3000`; the three movie sellers appear under **Browse services** automatically.
2. Read each service's live configuration and JSON schemas from `http://localhost:3000/sellers/{service-id}/manifest`.
3. The scraper and facts services need no external credentials. The summary seller is listed as unready and returns 503 until an inference provider is configured.
4. Use **Register seller** only to add another service with its own ID; existing IDs cannot be overwritten.

After registration, the buyer can discover listings with `GET /api/registry`. In free mode, listings have `paymentRequired: false`, `priceUnits: "0"`, and a `ready` flag; skip x402 and call the listing's `endpointUrl` directly. For inference, send items in this shape:

```json
{"items":[{"id":"film-1","title":"Film title","awards":4,"text":"Wikipedia extract goes here"}]}
```

Before switching on payments, set `SELLER_PAYMENTS_ENABLED=true` and configure a valid Base Sepolia receiving address for each seller. The published paid price is listed in the table above. Validate the paid flow with the buyer and testnet wallets after configuration.

## Agent contracts

- `movie-scraper` accepts one Oscar award year from 2010 to 2015 and returns award rows from Scrap This Site.
- `movie-facts` accepts one to three film titles and returns English Wikipedia extracts with source URLs and retrieval timestamps. It requests pages sequentially with a short pause and rejects Wikipedia disambiguation pages.
- `movie-summary` accepts one or two `{ id, title?, awards?, text }` fact items and returns one concise Devanagari Hindi summary per ID. When an award count is supplied, it asks the model to include it. It checks the provider response structure and refuses incomplete, duplicate, or non-Devanagari results before sending a successful response.

All three routes share the seller x402 v2 verification and settlement middleware, JSON Schema validation, and SQLite replay protection. Invalid inputs are rejected before payment; service errors and invalid outputs return errors before a successful settlement response.
