# Marketplace API

The Marketplace on port `3000` provides seller discovery and registration. Scout on port `3001` calls seller endpoints directly and records every attempt with the separate Call Ledger service on port `3002`.

All prices use integer USDC units. For USDC, divide `priceUnits` by 1,000,000 to display USDC. Never use floating-point values for payment calculations.

## Search for sellers

`GET /api/registry`

Optional filters:

- `category`: `scraping`, `data`, or `inference`
- `maxPriceUnits`: maximum price in atomic USDC units
- `ready`: `true` or `false`
- `q`: text to find in the seller's ID, name, or description

Example: `/api/registry?category=scraping&maxPriceUnits=10000`

The response is a JSON array of seller listings using the fields in `marketplace-contract.json`. By default, quarantined and blacklisted sellers are excluded. The Marketplace UI can request `includeBlocked=true` to show them with their safety status. Listings are ranked using legitimacy (40%), verified success (25%), availability (15%), latency (10%), and listed cost (10%). New sellers are `unproven`, have zero completed calls, and receive neutral ranking factors until there is history. Each listing returns the score and its factors. Reputation uses authenticated Scout reports because those include schema-validation outcomes; an on-chain payment by itself does not prove valid work was returned.

## Get one seller

`GET /api/registry/:sellerId`

Returns one full listing, including its input and output schemas. Returns `404` if the seller ID is unknown.

## Register a seller

`POST /api/registry`

Send a JSON seller listing with `id`, `name`, `category`, `description`, `endpointUrl`, `priceUnits`, `network`, `asset`, `payTo`, `inputSchema`, and `outputSchema`. The Marketplace sets reputation itself and ignores any reputation values supplied by the seller.

The website's **Register seller** form submits to this endpoint. Contract examples are not automatically published. Existing seller IDs cannot be replaced through public registration; a duplicate returns `409`. The endpoint returns `201` and the saved listing, or `400` with an error description if the listing is invalid.

Built-in sellers publish a manifest at `/sellers/{sellerId}/manifest`. The Marketplace uses those same seller definitions to refresh built-in listings at startup. Their endpoint URL, input schema, output schema, price, payment address, and readiness flag therefore stay connected to the implementation. Manually registered listings with their own IDs are preserved across restarts; their endpoint configuration is validated at registration, but the Marketplace does not actively probe third-party seller health.

In local free test mode (`NODE_ENV` is not `production` and `SELLER_PAYMENTS_ENABLED=false`), both apps use localhost HTTP to avoid browser warnings from self-signed development certificates. The server sets the listing price to zero, marks it `paymentRequired: false`, and does not need a seller wallet. In paid or production mode, both apps use HTTPS; seller endpoints must be public HTTPS endpoints with a real Base Sepolia receiving address and a positive price. The server sets payment fields from its mode rather than trusting values sent by the browser.

`GET /api/config` returns the active registration mode so the website can show the correct form fields.

Marketplace and seller SQLite files are stored in the project directory by default, even if Node is started from a different working directory. Set `MARKETPLACE_DATABASE_PATH` or `SELLER_DATABASE_PATH` to choose another location. Each separate project copy still has its own database unless both are configured to share a path.

## Health check

`GET /health`

Returns `{ "status": "ok", "service": "marketplace" }` when the API is running.

## Who calls the seller?

Scout's buyer server reads listings from `MARKETPLACE_BASE_URL`, plans a single seller call or a sequential chain, validates every seller input and output against the registered schemas, then calls each seller's `endpointUrl`. The browser only sends the task and budget to the buyer server; it never receives the Scout wallet key. Each attempted call is reported to `POST /api/ledger` with a generated task ID.

The buyer sets `askedPriceUnits` to `"0"` if it never received a 402 quote. It measures `latencyMs` from the first HTTP request until the full cycle ends, including quote handling, signing, settlement, and output validation. A paid status must include the real transaction hash; the Marketplace verifies its Base Sepolia receipt and exactly one USDC transfer from the buyer to the registered seller for the exact listed price, then sets `chainVerified: true` and creates the explorer link. An uncharged status must have `amountPaidUnits: "0"` and no transaction hash. `completed free` records successful local free-mode calls. `settlement unknown` records a call where Scout signed a payment but could not verify settlement; Scout must not retry it automatically.

The buyer's `POST /api/execute` accepts `{ "task": "...", "budgetUnits": "50000", "maxConcurrency": 1 }`. `maxConcurrency` is 1–5 and defaults to 1. Scout reserves the listed cost before starting each call and checks each live listing before dispatch. If a seller's x402 challenge changes the listed price or recipient, Scout refuses before signing, records the observed challenge, quarantines that seller, and tries other eligible sellers in rank order once each when the remaining budget allows. A second distinct verified mismatch blacklists the seller. Paid calls require `SELLER_PAYMENTS_ENABLED=true` and a server-only `BUYER_PRIVATE_KEY` for a low-balance Base Sepolia test wallet. `SELLER_PRIVATE_KEY` can supply a shared receiving address if individual `*_PAY_TO` addresses are not configured. Never commit either private key or send it to the browser.

The two built-in demo listings, `demo-price-inflator` and `demo-recipient-switch`, intentionally advertise a lower price or a different recipient from their payment challenge. They are labeled unsafe in the UI and reject signed payments before the facilitator is called. Scout displays “Payment blocked—no funds sent”; no refund is needed because funds never move.

Scout reports are authenticated using `SCOUT_MARKETPLACE_REPORT_TOKEN`. `npm run dev` generates a private shared token for Scout and the ledger service. If the services are run separately, configure the same strong token in both environments. The ledger does not accept safety findings based only on a caller-supplied reason. To reinstate a seller after human review, configure `MARKETPLACE_ADMIN_TOKEN` and send `POST /api/registry/:sellerId/reinstate` with `Authorization: Bearer <token>` to the Marketplace on port `3000`.

The Movie, Shelf, and Fake Jobs scraper listings each cost `2000` atomic USDC units (`0.002 USDC`) per request in paid mode. Summary sellers use their service-specific API settings when supplied; otherwise they use the shared `LLM_API_KEY` with Scout's default Groq-compatible endpoint and model. The call history table shows the listed, asked, and paid amounts, status tag, refusal/failure detail, latency, and settlement receipt so challenge mismatches can be reconciled against the chain.

The Call Ledger service on port `3002` owns `POST /api/ledger` and `GET /api/ledger`. `GET /api/ledger?limit=100` returns the newest call records; `GET /api/ledger?taskId={id}` filters to one Scout task for reconciliation. The limit is capped at 500. Open `http://localhost:3002/` for the ledger page. Scout uses `LEDGER_BASE_URL` for record submission (default `http://localhost:3002` in free local mode and `https://localhost:3002` in paid mode). The Marketplace no longer serves or displays the ledger.
