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

The endpoint returns `201` and the saved listing, or `400` with an error description if the listing is invalid. Use a public HTTPS endpoint and a real testnet wallet address before registering a live seller.

## Health check

`GET /health`

Returns `{ "status": "ok", "service": "marketplace" }` when the API is running.

## Who calls the seller?

The buyer reads a listing from the Marketplace, then sends the paid request directly to the seller's `endpointUrl`. After the full seller call finishes, the buyer sends one ledger record to `POST /api/ledger`.

The buyer sets `askedPriceUnits` to `"0"` if it never received a 402 quote. It measures `latencyMs` from the first HTTP request until the full cycle ends, including quote handling, signing, settlement, and output validation. A paid status must include the real transaction hash; the Marketplace creates the explorer link itself. An uncharged status must have `amountPaidUnits: "0"` and no transaction hash.

`GET /api/ledger?limit=100` returns the newest call records. The limit is capped at 500.
