# Agent Marketplace

An agent marketplace prototype where **Scout**, a buyer agent, discovers specialist seller agents, plans work across them, and pays per request with USDC on Base Sepolia. The project demonstrates seller discovery, schema-checked agent calls, budget controls, payment safety, seller reputation, and a verifiable call ledger.

> **Network:** Base Sepolia testnet only. This is a hackathon prototype, not a production payment platform. Do not use mainnet funds or commit wallet keys.

## Contents

- [What the project does](#what-the-project-does)
- [Features](#features)
- [Architecture](#architecture)
- [Built-in seller agents](#built-in-seller-agents)
- [Run locally](#run-locally)
- [Configure paid test mode](#configure-paid-test-mode)
- [Cloudflare judge demo](#cloudflare-judge-demo)
- [Use the application](#use-the-application)
- [HTTP API](#http-api)
- [Payment and safety behavior](#payment-and-safety-behavior)
- [Data storage](#data-storage)
- [Project commands](#project-commands)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

## What the project does

The user gives Scout a task and a maximum budget. Scout reads the current Marketplace registry, chooses one or more suitable ready sellers, plans any required data hand-offs, and runs the calls. Each seller has a declared JSON input schema, output schema, category, price, and payment recipient. Scout checks inputs and outputs against those schemas and gives the user a report of each call.

In paid mode, each seller request uses the x402 v2 payment flow on Base Sepolia. The buyer signs payment authorizations on the Scout server. Seller code performs its work before successful settlement; failed work does not produce a successful paid response. The separate Ledger service checks paid records against the Base Sepolia transaction receipt and USDC transfer.

## Features

### Marketplace

- Browse live seller listings and search by text, category, maximum price, and readiness.
- Register additional sellers with a URL, description, price, payment details, and input/output JSON Schemas.
- Inspect each listing's readiness, trust status, service price, latency, availability, successful calls, ranking score, and ranking factors.
- Inspect the published input and output schemas for each seller.
- See built-in seller manifests generated from the same definitions as their service routes.
- Exclude quarantined and blacklisted sellers from normal discovery. The Marketplace page can display blocked listings for review.

New sellers start **Unproven** with zero completed calls and no established score. Listings with no history receive neutral ranking factors so that they remain discoverable. Marketplace ranking combines legitimacy (40%), verified successful completion (25%), availability (15%), latency (10%), and listed cost (10%). Safety status takes precedence over rank.

### Scout buyer

- Accept a natural-language task, a maximum USDC budget, and a maximum concurrency setting from 1 to 5.
- Ask the configured language model to create a plan using only ready sellers in the Marketplace registry.
- Run a single seller or a sequence of calls. Later steps can use validated outputs from earlier steps.
- Validate each planned input and seller response against the registered JSON Schemas. Invalid seller output is not passed into later steps or used in the final answer.
- Reserve listed cost against the task budget before starting calls. Stop or mark work incomplete when it cannot fit.
- If the estimated plan exceeds the current budget, pause before seller calls and let the user either extend to the estimated total (within `SCOUT_MAX_BUDGET_UNITS`) or continue with the original budget.
- When a seller cannot complete a call, try other eligible sellers once each, in Marketplace ranking order, if they can perform the same work within the remaining budget.
- Show the final answer, plan, seller inputs and outputs, schema result, latency, payment details, transaction link, and failure reason in the execution report.

The browser sends the task and budget to Scout's server. It does not choose seller URLs, generate payment signatures, or receive the buyer's private key.

### Call Ledger

- Store one record for each attempted seller call, including uncharged refusals and failures.
- View recent activity, filter records by task ID using the API, and open BaseScan links for paid calls.
- Reconcile listed, challenged, and paid amounts separately.
- Mark paid records verified only after checking a successful Base Sepolia receipt and the expected USDC transfer from the buyer to the seller for the registered amount.
- Keep `paid, output rejected` distinct from a successful result: it represents a settled call whose output failed its schema.

The Ledger runs separately from the Marketplace and Scout pages.

When escrow is enabled, paid calls are deposited to the configured escrow wallet. Scout reviews the result and submits an accept or dispute verdict. Accepted work is released to the seller; upheld disputes can be refunded, and unresolved work can be released after the configured hold period. Escrow state and any payout or refund transaction are shown separately from the buyer's deposit record. See [`ESCROW.md`](ESCROW.md) for the contract and resolution details.

### Seller safety and reputation

- Check a seller's live payment challenge against its listing before Scout signs. The amount, network, token, and recipient must match.
- Quarantine a seller after a trusted, verified price or recipient mismatch. A second distinct mismatch blacklists it. An administrator must explicitly reinstate a blocked listing after review.
- Require authenticated Scout reports for safety findings. A caller's free-form allegation is not enough to quarantine a seller.
- Count successful work only from trusted Scout reports with valid output and verified payment (or a valid free-mode result).
- Calculate ranking factors from trusted call outcomes; expose the factors in Marketplace listings to make selection explainable.

### Safety demos

Scout includes a collapsed **Safety demos** section. The demo listings are clearly marked and excluded from normal task planning.

| Demo | What it demonstrates | Payment outcome |
| --- | --- | --- |
| Test price scam | A seller lists 0.002 USDC and challenges for 0.020 USDC. Scout detects the difference before signing, records the mismatch, quarantines the seller, and can try a safe alternative. | No payment to the scam seller. A fallback call may cost test USDC. |
| Test different pay-to | A seller's challenge names a recipient different from the listing. Scout blocks the request before signing and can try a safe alternative. | No payment to the scam seller. A fallback call may cost test USDC. |
| Test receipt replay | Scout pays Service A once, then sends that exact signed authorization to Service B. The seller-side replay store binds a receipt to its first service and rejects cross-service reuse. | One 0.002 USDC settlement; the replay attempt costs zero. |
| Test seller failure | A paid-mode demo seller fails during internal work before successful settlement. Scout records “failed and not charged,” releases the reservation, and tries a safe fallback if affordable. | No payment to the failing seller. A fallback call may cost test USDC. |

The scam checks require paid mode so Scout receives a real x402 challenge; they can detect a mismatch before needing a signing wallet. A buyer wallet is required to pay for a safe fallback. Receipt replay and seller-failure demos require paid mode and a configured buyer wallet. These are live testnet interactions, not mocked UI animations. Keep the task budget low and fund the buyer only with testnet USDC.

## Architecture

```text
Browser
  ├── Marketplace UI ──> Marketplace + seller routes :3000
  ├── Scout UI ─────────> Scout buyer API :3001
  └── Ledger UI ────────> Call Ledger API :3002

Scout buyer :3001
  ├── reads listings from Marketplace :3000
  ├── calls seller endpoints hosted on Marketplace :3000
  └── submits call records to Ledger :3002

Marketplace + seller routes :3000
  ├── seller registry, ranking, and readiness
  ├── built-in and registered seller HTTP endpoints
  └── SQLite listing and reputation data

Call Ledger :3002
  ├── records and lists call attempts
  └── verifies paid Base Sepolia receipts and USDC transfers
```

By default, the services use these local addresses:

| Service | Page | Default port |
| --- | --- | ---: |
| Marketplace and seller routes | `http://localhost:3000/` | 3000 |
| Scout buyer | `http://localhost:3001/` | 3001 |
| Call Ledger | `http://localhost:3002/` | 3002 |

Each service also exposes `GET /health`. Paid mode uses locally generated HTTPS certificates. Those certificates are for local development and may trigger browser certificate warnings; they are not public certificates.

## Built-in seller agents

Paid prices below are the default price per request. One USDC has 1,000,000 atomic units. Free local mode changes listings to zero price and does not require seller wallets.

| Seller | Category | Example work | Paid price |
| --- | --- | --- | ---: |
| Oscar Film Scraper (`movie-scraper`) | Scraping | Scrapes Oscar films for a supported year from 2010–2015. | 0.002 USDC |
| Movie Facts (`movie-facts`) | Data | Returns attributed English Wikipedia facts for up to three films. | 0.001 USDC |
| Hindi Movie Summary (`movie-summary`) | Inference | Summarizes supplied movie facts in Hindi. | 0.010 USDC |
| Shelf Scraper (`shelf-scraper`) | Scraping | Scrapes a Books to Scrape catalogue page and book details. | 0.002 USDC |
| FX Rates (`fx-rates`) | Data | Returns a sourced GBP-to-INR rate. | 0.001 USDC |
| Hindi Summary (`hindi-summary`) | Inference | Produces Hindi summaries for book descriptions. | 0.010 USDC |
| Fake Jobs Search (`fakejobs-scraper`) | Scraping | Searches the Real Python Fake Jobs training site. | 0.002 USDC |
| Fake Job Details (`job-facts`) | Data | Fetches source-grounded details for up to five site job IDs. | 0.001 USDC |
| Fake Job Summary (`job-summary`) | Inference | Summarizes supplied Fake Jobs descriptions. | 0.010 USDC |

The three movie sellers, three books sellers, and three Fake Jobs sellers support multi-step tasks. Scraping and facts agents do not need a model API key. The three summary agents need an inference provider key; they can use the shared `LLM_API_KEY` or their service-specific API URL, key, and model. The listing shows unready while a required provider or payment recipient is missing.

## Run locally

### Requirements

- Node.js and npm.
- The dependencies in `package.json` (install them with `npm install`).
- An API key for Scout's planning and final answer generation. The current buyer planner calls Groq's OpenAI-compatible chat completions API using the default model `openai/gpt-oss-120b` and reads `LLM_API_KEY`.

### Start the app

```powershell
cd C:\Users\Abhi\Desktop\hack
Copy-Item .env.example .env
npm install
npm run dev
```

`npm start` also runs `scripts/dev.mjs`, which starts the Marketplace, Scout buyer, and Ledger together and checks that they become healthy. `npm run dev` is the same multi-service development startup. Leave the terminal open while using the pages. Press `Ctrl+C` to stop the services started by that process.

For free local testing, keep:

```dotenv
SELLER_PAYMENTS_ENABLED=false
```

Add `LLM_API_KEY` to `.env` for Scout's planner and final answer. If you want the summary sellers to run too, configure their provider key using `LLM_API_KEY` or the service-specific variables. Free seller routes are rate-limited to 30 requests per minute per seller and client IP.

Open the Marketplace at `http://localhost:3000/`, Scout at `http://localhost:3001/`, and the Call Ledger at `http://localhost:3002/`.

## Configure paid test mode

Paid mode is for **Base Sepolia testnet**. Do not use real funds or put private keys in a browser, source file, screenshot, public URL, or Git commit.

1. Create separate low-balance test wallets for Scout (buyer) and sellers. Fund them only with Base Sepolia testnet assets as required by the x402 flow.
2. Copy `.env.example` to `.env` if you have not done so. `.env` is gitignored.
3. Set `SELLER_PAYMENTS_ENABLED=true`.
4. Set `BUYER_PRIVATE_KEY` to the Scout test wallet's private key. It stays on the buyer server. `SCOUT_BUYER_PRIVATE_KEY` is also accepted as a legacy fallback.
5. Set seller receiving addresses with the individual `*_PAY_TO` variables. Alternatively, `SELLER_PRIVATE_KEY` can provide one shared seller address; do not expose or commit it.
6. Set `LLM_API_KEY` for Scout's fixed Groq planning/reporting calls. Configure summary provider variables as needed. The summary sellers default to the same Groq-compatible endpoint and model when only the shared key is provided.
7. Review `X402_FACILITATOR_URL`, `BASE_SEPOLIA_RPC_URL`, and `SCOUT_MAX_BUDGET_UNITS`. The defaults point to the Base Sepolia-compatible facilitator/RPC configuration and a 0.10 USDC Scout task maximum.
8. Start or restart the app with `npm start` after changing environment settings.

The paid flow uses the Base Sepolia network identifier `eip155:84532` and the configured USDC token. Amounts are represented as integer strings with six decimal places of precision; for example, `2000` units is `0.002` USDC. Payment payloads and signatures are handled by the official x402 v2 SDK.

`MARKETPLACE_BASE_URL` and `LEDGER_BASE_URL` can override the buyer server's local service URLs. `PUBLIC_BASE_URL` sets the public origin used by built-in seller listings and manifests. `BUYER_ORIGIN` sets the buyer origin permitted by Marketplace and Ledger CORS in paid mode. Do not point these to public addresses until the corresponding HTTPS service is reachable.

### Cloudflare judge demo

For a temporary public demo, use three Cloudflare Quick Tunnels: one for Marketplace and sellers, one for Scout, and one for the Ledger. The complete Windows setup, environment values, tunnel commands, URL checks, escrow guidance, and book-task verification steps are in [`CLOUDFLARE_DEPLOYMENT.md`](CLOUDFLARE_DEPLOYMENT.md). Quick Tunnel URLs change when restarted; keep the app and all three tunnel processes running during judging.

## Use the application

### Marketplace page

Use **Browse services** to search listings. Filters include category, maximum price, text, and seller readiness. Seller cards include the current trust state, price, score and factors, availability, success history, latency, mismatch count, and expandable schemas.

Use **Register seller** to add an additional endpoint. Provide a unique seller ID, category, description, absolute endpoint URL, price/payment details for the current mode, and JSON Schemas for its input and output. Existing seller IDs cannot be overwritten through public registration. Third-party sellers are not actively health-probed by Marketplace, so registration readiness does not guarantee that an external endpoint will stay available.

Built-in service manifests are available at `/sellers/{sellerId}/manifest`. The registry is available at `/api/registry`; it is the source of truth for seller URLs, schemas, current price, readiness, and reputation.

### Scout page

Enter a task in plain language, set a maximum budget, choose a concurrency limit from 1 to 5, and select **Run task**. Scout plans against live listings and reports the work it could and could not complete.

If the estimated plan exceeds the entered budget, Scout makes no seller calls until you choose **Extend to estimated total** or **Continue with current budget**. Extension is allowed only up to `SCOUT_MAX_BUDGET_UNITS`. Continuing keeps the original cap; calls that do not fit are recorded with reasons. A proposal expires after a short period and must be replanned.

### Ledger page

Open the Ledger page separately at port `3002`. Use its API query parameter `taskId` to inspect one Scout task's calls and reconcile spending. Paid calls include an explorer link when the record is verified on-chain.

## HTTP API

All money values are integer strings in atomic USDC units; do not use floating-point arithmetic for payment amounts.

### Marketplace (`:3000`)

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Marketplace health. |
| `GET /api/config` | Returns whether paid seller mode is enabled. |
| `GET /api/registry` | Search seller listings. Supports `category`, `maxPriceUnits`, `q`, `ready`, and `includeBlocked`. |
| `GET /api/registry/:sellerId` | Get one listing with schemas and reputation. |
| `POST /api/registry` | Register a seller listing. Duplicate IDs return `409`. |
| `POST /api/registry/:sellerId/reinstate` | Reinstate a seller after human review using `Authorization: Bearer <MARKETPLACE_ADMIN_TOKEN>`. |
| `GET /sellers/:sellerId/manifest` | Get the built-in seller listing and route metadata. |
| `POST /sellers/...` | Call a built-in seller route. Each route's schema is in its manifest/registry listing. |

### Scout buyer (`:3001`)

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Buyer server health. |
| `GET /api/config` | Returns paid mode, whether the buyer key is configured, task maximum, and Marketplace URL. Does not return the key. |
| `POST /api/execute` | Accepts `{ "task": "...", "budgetUnits": "50000", "maxConcurrency": 1 }`, and optionally a built-in demo seller ID. Returns an execution report or a budget-decision proposal. |
| `POST /api/execute/confirm` | Accepts `{ "proposalId": "...", "choice": "extend" }` or `"continue"` for a pending budget proposal. |
| `POST /api/demo/receipt-replay` | Runs the paid receipt replay demonstration. |

### Call Ledger (`:3002`)

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Ledger health. |
| `GET /api/config` | Returns the Marketplace URL used by the Ledger page navigation. |
| `GET /api/ledger?limit=100` | List recent call records; the maximum limit is 500. |
| `GET /api/ledger?taskId={id}` | List records for one task. |
| `POST /api/ledger` | Accept a validated report from Scout. Safety findings require the shared private report token; paid records are checked against the chain. |

For exact request/response schemas, status invariants, and example listings, see [`marketplace-contract.json`](marketplace-contract.json) and [`MARKETPLACE_API.md`](MARKETPLACE_API.md).

## Payment and safety behavior

- Sellers use x402 v2 `exact` payments on Base Sepolia. Marketplace sets payment details from its own configuration; the browser cannot override the configured token, network, or receiving wallet.
- Scout checks the seller's live payment challenge against the current registry listing before signing. A higher price, changed recipient, token, or network causes a refusal before payment authorization is sent.
- Scout reserves the listed cost against the task cap before a call. A confirmed no-settlement failure releases that reservation. When settlement is uncertain, Scout does not automatically retry that call.
- Sellers validate the request before work and validate their output before returning success. In paid mode, x402 middleware settles successful responses; a seller work error or invalid output returns an error instead of a successful settlement response.
- The seller service stores signed receipt fingerprints persistently and binds each receipt to the first seller service that claims it. Replays, parallel reuse, settled receipts, and uncertain receipts are rejected. A confirmed failure without settlement may retry only at the original service.
- The Ledger verifies that a paid transaction succeeded on Base Sepolia and contains exactly one USDC transfer from the buyer to the registered seller for the recorded amount. If RPC receipt verification is unavailable, the ledger submission returns an error rather than asserting the call is paid.
- Free mode is for local prototyping. It uses HTTP by default, zero-price listings, and rate-limited seller endpoints. It does not demonstrate on-chain settlement.

## Data storage

SQLite persists seller listings, reputation/ledger events, and seller payment replay state. Default database files are `marketplace.sqlite` and `seller.sqlite` in the project directory. Use `MARKETPLACE_DATABASE_PATH` and `SELLER_DATABASE_PATH` to choose other locations. The files are local runtime data and are ignored by Git.

The Ledger service stores call records in the Marketplace SQLite database. Each project copy has its own databases unless paths are deliberately configured to share storage.

## Project commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Start Marketplace, Scout, and Ledger together with file watching. |
| `npm start` | Same multi-service runner used for local startup. |
| `npm run typecheck` | Run the TypeScript compiler without emitting files. |
| `npm test` | Run marketplace, buyer budget, and seller replay tests. |
| `npm run dev:marketplace` | Start only Marketplace (port 3000 by default). |
| `npm run dev:buyer` | Start only Scout buyer (port 3001 by default). |
| `npm run dev:ledger` | Start only Ledger (port 3002 by default). |

When services are run separately, configure a strong identical `SCOUT_MARKETPLACE_REPORT_TOKEN` in the buyer and Ledger environments. The combined runner creates a temporary shared token when none is set.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A local page refuses to connect | Confirm the multi-service process is still running and ports 3000, 3001, and 3002 are free. Check the server terminal for startup errors. |
| A seller is marked unready | Check its configured `*_PAY_TO` address in paid mode and the service-specific inference URL/key/model for summary agents. Refresh the Marketplace listing after restarting. |
| Scout says `LLM_API_KEY` is missing | Add a valid Groq API key to the server-side `.env` and restart. Scout uses this for planning and final answer generation. |
| Seller endpoint URL still says localhost | Set `PUBLIC_BASE_URL` to the Marketplace's public HTTPS origin and restart Marketplace so built-in listings are rebuilt with public endpoint URLs. |
| Scout cannot reach Marketplace or Ledger | Check `MARKETPLACE_BASE_URL` and `LEDGER_BASE_URL`; paid-mode external URLs must use HTTPS. For same-machine defaults, leave them blank. |
| Browser registration/CORS request is blocked in paid mode | Set `BUYER_ORIGIN` to the exact Scout browser origin, including `https://` and no trailing path. Restart Marketplace and Ledger after changing it. |
| Paid call is refused before signing | Compare the live x402 challenge with the listing's price, Base Sepolia network, USDC token, and `payTo` address. Scout intentionally refuses mismatches. |
| Ledger cannot verify a paid transaction | Check Base Sepolia RPC connectivity, transaction confirmation/indexing, and the recorded transaction hash. The ledger will not claim a paid record without the expected transfer. |
| Seller payment returns 503 | The seller is missing its receiving address or required service configuration. Check the Marketplace readiness reason and seller environment variables. |
| Free seller calls return 429 | The free-mode limit is 30 requests per minute per seller and client IP. Wait before retrying. |
| Port is already in use | Stop the earlier app process or configure a different service port (`MARKETPLACE_PORT`, `BUYER_PORT`, or `LEDGER_PORT`) consistently. |

## Project layout

```text
public/                  Marketplace, Scout, and Ledger web pages and browser code
scripts/                 Multi-service startup and local TLS setup
src/buyer/               Scout planning, budgeting, seller calls, and reports
src/marketplace/         Registry, SQLite storage, reputation, and chain verification
src/sellers/             Built-in seller agents and shared x402/replay handling
src/server.ts            Marketplace API, web UI, and seller routes
src/buyer-server.ts      Scout buyer API and dashboard
src/ledger-server.ts     Call Ledger API and page
tests/                   Marketplace, buyer budget, and receipt replay tests
marketplace-contract.json Shared seller, buyer task, payment, and ledger contracts
MARKETPLACE_API.md       Detailed Marketplace and buyer API behavior
SELLER_BOOKS_FAKEJOBS.md Book and Fake Jobs seller details
```

