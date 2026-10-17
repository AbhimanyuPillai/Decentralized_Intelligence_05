# Marketplace API

This API is the shared interface between the Marketplace, Amogh's buyer, and Madhur's sellers. The Marketplace returns seller listings; the buyer calls a seller's endpoint directly.

All prices use integer USDC units. For USDC, divide `priceUnits` by 1,000,000 to display USDC. Never use floating-point values for payment calculations.

## Search for sellers

`GET /api/registry`

Optional filters:

- `category`: `scraping`, `data`, or `inference`
- `maxPriceUnits`: maximum price in atomic USDC units

Example: `/api/registry?category=scraping&maxPriceUnits=10000`

The response is a JSON array of seller listings using the fields in `marketplace-contract.json`. Reputation is calculated from recorded call outcomes. It is `null` until the seller has call history.

## Get one seller

`GET /api/registry/:sellerId`

Returns one full listing, including its input and output schemas. Returns `404` if the seller ID is unknown.

## Register a seller

`POST /api/registry`

Send a JSON seller listing with `id`, `name`, `category`, `description`, `endpointUrl`, `priceUnits`, `network`, `asset`, `payTo`, `inputSchema`, and `outputSchema`. The Marketplace sets reputation itself and ignores any reputation values supplied by the seller.

The website's **Register seller** form submits to this endpoint. Contract examples are not automatically published. The endpoint returns `201` and the saved listing, or `400` with an error description if the listing is invalid.

Built-in sellers publish a manifest at `/sellers/{sellerId}/manifest`. The Marketplace uses those same seller definitions to refresh built-in listings at startup. Their endpoint URL, input schema, output schema, price, payment address, and readiness flag therefore stay connected to the implementation. Manually registered listings with their own IDs are preserved across restarts.

In local free test mode (`NODE_ENV` is not `production` and `SELLER_PAYMENTS_ENABLED=false`), both apps use localhost HTTP to avoid browser warnings from self-signed development certificates. The server sets the listing price to zero, marks it `paymentRequired: false`, and does not need a seller wallet. In paid or production mode, both apps use HTTPS; seller endpoints must be public HTTPS endpoints with a real Base Sepolia receiving address and a positive price. The server sets payment fields from its mode rather than trusting values sent by the browser.

`GET /api/config` returns the active registration mode so the website can show the correct form fields.

Marketplace and seller SQLite files are stored in the project directory by default, even if Node is started from a different working directory. Set `MARKETPLACE_DATABASE_PATH` or `SELLER_DATABASE_PATH` to choose another location. Each separate project copy still has its own database unless both are configured to share a path.

## Health check

`GET /health`

Returns `{ "status": "ok", "service": "marketplace" }` when the API is running.

## Who calls the seller?

Scout's buyer server reads listings from `MARKETPLACE_BASE_URL`, plans a single seller call or a sequential chain, validates every seller input and output against the registered schemas, then calls each seller's `endpointUrl`. The browser only sends the task and budget to the buyer server; it never receives the Scout wallet key. Each attempted call is reported to `POST /api/ledger`.

The buyer sets `askedPriceUnits` to `"0"` if it never received a 402 quote. It measures `latencyMs` from the first HTTP request until the full cycle ends, including quote handling, signing, settlement, and output validation. A paid status must include the real transaction hash; the Marketplace creates the explorer link itself. An uncharged status must have `amountPaidUnits: "0"` and no transaction hash. `completed free` records successful local free-mode calls. `settlement unknown` records a call where Scout signed a payment but could not verify settlement; Scout must not retry it automatically.

The buyer's `POST /api/execute` accepts `{ "task": "...", "budgetUnits": "50000", "maxConcurrency": 1 }`. `maxConcurrency` is 1–5 and defaults to 1. Scout reserves the listed cost before starting each call, keeps dependent steps in order, and rejects a plan whose total listed cost is above the task cap before calling any seller. If a paid call returns invalid output, Scout records the settled rejected call, lowers that seller's success rate, and tries one other seller for that subtask when the remaining budget allows. Configure `MARKETPLACE_BASE_URL` and `SCOUT_MAX_BUDGET_UNITS` for the buyer server. Paid calls require `SELLER_PAYMENTS_ENABLED=true` and a server-only `BUYER_PRIVATE_KEY` for a low-balance Base Sepolia test wallet. `SELLER_PRIVATE_KEY` can supply a shared receiving address if individual `*_PAY_TO` addresses are not configured. Never commit either private key or send it to the browser.

The Movie, Shelf, and Fake Jobs scraper listings each cost `2000` atomic USDC units (`0.002 USDC`) per request in paid mode. Summary sellers use their service-specific API settings when supplied; otherwise they use the shared `LLM_API_KEY` with Scout's default Groq-compatible endpoint and model. The call history table shows the listed, asked, and paid amounts, status tag, refusal/failure detail, latency, and settlement receipt so challenge mismatches can be reconciled against the chain.

`GET /api/ledger?limit=100` returns the newest call records. The limit is capped at 500.
