# Cloudflare Quick Tunnel deployment

This guide exposes the current three-service app for a temporary judge demo. It does not change the app’s payment or escrow behavior. Quick Tunnels are for development and testing, not a permanent deployment.

## Service layout

| Service | Local HTTPS origin | Public URL setting |
| --- | --- | --- |
| Marketplace and built-in sellers | `https://localhost:3000` | `PUBLIC_BASE_URL` and `MARKETPLACE_BASE_URL` |
| Scout buyer | `https://localhost:3001` | `BUYER_ORIGIN` |
| Call Ledger | `https://localhost:3002` | `LEDGER_BASE_URL` |

The Marketplace and seller endpoints share one service and one tunnel. Scout and the Ledger each need their own tunnel. Keep four terminal windows open during judging: one for the app and one for each tunnel.

## Before you start

1. Use Windows with a recent Node.js LTS release and npm. Install the project dependencies with `npm install` if needed.
2. Install `cloudflared` using [Cloudflare’s Windows installation instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/), then confirm `cloudflared --version` works in PowerShell. If it is not on `PATH`, run the downloaded executable by its full path.
3. Quick Tunnels are temporary. Cloudflare assigns random `https://…trycloudflare.com` URLs, and those URLs change when a tunnel restarts. Cloudflare documents Quick Tunnels as testing/development tunnels, with usage limitations; they are not a production hosting service. See [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
4. Quick Tunnels may not start if a `config.yaml` is present in the local `.cloudflared` configuration directory. Follow Cloudflare’s current documentation if you hit that condition; do not delete a configuration you still need.
5. Create dedicated, low-balance **Base Sepolia test wallets** for the buyer and seller destinations. Never use mainnet funds. The escrow private key must belong to the address already published in `marketplace-contract.json`; the app rejects a different wallet. Do not paste private keys into chat, browser fields, screenshots, commands, source files, or this guide.
6. Fund only the buyer wallet with a small amount of Base Sepolia test USDC for the demo. The x402 facilitator pays gas for supported payment flows. The [Circle testnet faucet](https://faucet.circle.com/) can provide test USDC when Base Sepolia is selected. Confirm the token and network shown by the app before using funds.
7. Have server-side inference credentials ready. `LLM_API_KEY` is used by Scout to plan tasks and create the final response; book-summary sellers also need a configured inference provider. Keep every key in the ignored local `.env` file.

## Configure the local environment

Create the local environment file if it does not exist:

```powershell
Copy-Item .env.example .env
```

Set the paid-demo values in `.env`. Keep the example’s Base Sepolia RPC, facilitator, and published escrow address unless the team has deliberately changed those project settings.

```dotenv
SELLER_PAYMENTS_ENABLED=true
ESCROW_ENABLED=true

BUYER_PRIVATE_KEY=<low-balance Base Sepolia buyer key>
ESCROW_PRIVATE_KEY=<key for the published escrow address>
ESCROW_ADDRESS=0xA360194De2Ff897C0fE441890FdC7DD045DE49b2

LLM_API_KEY=<server-side inference key>
SCOUT_MAX_BUDGET_UNITS=50000
ESCROW_HOLD_SECONDS=600
ESCROW_ADMIN_TOKEN=<long random secret>

X402_FACILITATOR_URL=https://x402.org/facilitator
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

`50000` units is `0.050000` USDC. The Scout budget is a per-task cap, not a cumulative account limit. Use a low-balance test wallet, keep the task cap small, and leave the tunnels running only for the judging window. Each paid call can create a separate deposit transaction; escrow release or refund is a separate transaction and is not extra buyer task spend.

Configure seller payment addresses using the `*_PAY_TO` settings if the project is not using `SELLER_PRIVATE_KEY` for a shared seller address. The receiving addresses must be Base Sepolia addresses. Configure `BOOK_SUMMARY_API_URL`, `BOOK_SUMMARY_API_KEY`, and `BOOK_SUMMARY_MODEL` when the book-summary seller does not use the shared inference configuration.

Set `ESCROW_ADMIN_TOKEN` to a long random value before exposing the Ledger. This is required because the Ledger receives requests from the local `cloudflared` process, so requests can appear local to the app. Keep this secret out of the repository and public demo materials. Keep `MARKETPLACE_ADMIN_TOKEN` and `SCOUT_MARKETPLACE_REPORT_TOKEN` server-side as well. The combined `npm run dev` runner creates a private shared Scout-report token when one is not configured.

The `.env.example` file contains placeholders only. Do not commit `.env`, private keys, API keys, or admin tokens. A Quick Tunnel URL is public and is not an access-control mechanism; anyone who discovers it may be able to open the app and submit tasks.

## Start the app and tunnels

### 1. Start the three app services

In the project folder, start the app and leave that PowerShell window open:

```powershell
npm run dev
```

Wait until the Marketplace, Scout, and Ledger health checks report ready. Paid mode uses the app’s local self-signed HTTPS certificates.

### 2. Start one Quick Tunnel per service

Open three more PowerShell windows. Run one command in each and leave all three windows open:

```powershell
cloudflared tunnel --url https://localhost:3000 --no-tls-verify
```

```powershell
cloudflared tunnel --url https://localhost:3001 --no-tls-verify
```

```powershell
cloudflared tunnel --url https://localhost:3002 --no-tls-verify
```

Copy the `https://…trycloudflare.com` URL printed by each command. The `--no-tls-verify` option is only for the connection from `cloudflared` to the app’s local self-signed HTTPS certificate. It does not turn off HTTPS for visitors connecting to the public Quick Tunnel URL, and it does not disable Scout’s x402 checks for network, token, listed amount, or payment recipient.

### 3. Put the public URLs in `.env`

Stop the app with `Ctrl+C` in its terminal, but leave the three tunnel windows running. Set the URLs from the matching tunnel output:

```dotenv
PUBLIC_BASE_URL=https://<marketplace-tunnel>.trycloudflare.com
MARKETPLACE_BASE_URL=https://<marketplace-tunnel>.trycloudflare.com
BUYER_ORIGIN=https://<scout-tunnel>.trycloudflare.com
LEDGER_BASE_URL=https://<ledger-tunnel>.trycloudflare.com
```

Use only the origin: no route path and no trailing slash. `PUBLIC_BASE_URL` is used to build public seller endpoint and manifest URLs. `MARKETPLACE_BASE_URL` tells Scout and the Ledger where the Marketplace is. `BUYER_ORIGIN` is the browser origin allowed by CORS. `LEDGER_BASE_URL` tells Scout where to save call records and escrow review information.

Restart the app with `npm run dev`. Check that all three services become healthy and that the registry now shows the public Marketplace tunnel in built-in seller URLs. Keep the app terminal and all three tunnel terminals running. If any tunnel restarts and receives a new URL, update `.env` and restart the app again.

## Public URL checklist

Replace each placeholder with the matching live tunnel URL. A successful page load alone is not enough; check the API responses too.

### Marketplace and sellers

- Marketplace page: `https://<marketplace-tunnel>.trycloudflare.com/`
- Marketplace health: `https://<marketplace-tunnel>.trycloudflare.com/health`
- Registry: `https://<marketplace-tunnel>.trycloudflare.com/api/registry`
- Filter example: `https://<marketplace-tunnel>.trycloudflare.com/api/registry?category=scraping`
- Book seller manifests:
  - `/sellers/shelf-scraper/manifest`
  - `/sellers/fx-rates/manifest`
  - `/sellers/hindi-summary/manifest`
- Confirm each relevant seller endpoint in the registry begins with the public Marketplace tunnel URL, not `localhost`.
- Confirm book sellers are marked ready. A summary seller also needs its inference configuration. Payment addresses and escrow settings must be valid for paid mode.

### Scout

- Scout page: `https://<scout-tunnel>.trycloudflare.com/`
- Scout health: `https://<scout-tunnel>.trycloudflare.com/health`
- Scout configuration: `https://<scout-tunnel>.trycloudflare.com/api/config`
- Confirm paid mode is reported and the buyer key is configured. The config response must not expose the key itself.

### Ledger

- Ledger page: `https://<ledger-tunnel>.trycloudflare.com/`
- Ledger health: `https://<ledger-tunnel>.trycloudflare.com/health`
- Ledger config: `https://<ledger-tunnel>.trycloudflare.com/api/config`
- Ledger records: `https://<ledger-tunnel>.trycloudflare.com/api/ledger?limit=100`
- After a paid call, open its escrow details from the Ledger page and confirm the hold/release state and transaction references.

## Book task demo and payment check

Before the judge arrives, use the task below in Scout and set the task budget to **0.050 USDC**. Set maximum simultaneous calls to **1** to make the sequence and receipts easier to explain.

> From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarize each description in Hindi.

The expected example plan is four book-page scrape calls at 0.002 USDC each, one currency-rate call at 0.001 USDC, and two Hindi-summary calls at 0.010 USDC each, for an estimated 0.029 USDC total. The actual plan can differ if seller prices or the task plan change, so check the estimate before confirming. Keep it within the 0.050 USDC budget and the configured `SCOUT_MAX_BUDGET_UNITS` ceiling.

For every paid call:

1. Find its ledger row and confirm the recorded amount, seller, and transaction hash.
2. Open the Base Sepolia transaction link and verify a successful USDC transfer from the buyer wallet to the escrow address for that call’s exact amount.
3. Confirm each paid call has its own deposit transaction; do not reuse a single transaction hash for multiple calls.
4. Check the escrow entry separately. A seller payout or buyer refund is a later transaction and should have its own transaction reference. It is not another buyer payment for the task.
5. Reconcile the sum of verified ledger deposits with the buyer-to-escrow transfers for that Scout task.

Use the Base Sepolia explorer link provided by the app or [BaseScan’s Base Sepolia explorer](https://sepolia.basescan.org/). RPC or facilitator indexing may take time; do not repeat a call just because its settlement is still being checked.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Public URL returns 502 or 1033 | Confirm the matching app service and its tunnel process are both running. Check that the tunnel command points to the correct port, then wait for `cloudflared` to report a connected tunnel. |
| TLS-origin error from `cloudflared` | Paid mode uses a local self-signed certificate. For these local origins, use the documented command with `--no-tls-verify`. This option belongs only on the local origin tunnel command. |
| Registry seller endpoints still show localhost | Set both `PUBLIC_BASE_URL` and `MARKETPLACE_BASE_URL` to the public Marketplace URL, then restart the app. Check the registry again. |
| Scout cannot call Marketplace or save to Ledger | Confirm `MARKETPLACE_BASE_URL` and `LEDGER_BASE_URL` use their currently running public tunnel origins, without paths or trailing slashes; restart after changes. |
| Browser reports a CORS error | Set `BUYER_ORIGIN` to the exact current Scout URL, including `https://` and no trailing slash. Restart the app after editing `.env`. |
| A book seller is not ready | Check the registry readiness reason, seller `*_PAY_TO` address, escrow configuration, and summary inference settings. Restart after correcting `.env`. |
| Scout cannot plan the task or summary seller fails | Check `LLM_API_KEY` and the relevant `BOOK_SUMMARY_*` provider URL, key, and model. Keep inference keys only in `.env`. |
| Paid request fails for insufficient funds | Check the buyer wallet is on Base Sepolia, has test USDC for the task, and that the token/network match the app configuration. A task cap is a limit, not a funding source. |
| Settlement or receipt check is slow | Allow time for the facilitator, RPC, and explorer to observe the transaction. Do not automatically resubmit a call whose settlement is uncertain. |
| Escrow setup is rejected | Confirm `ESCROW_ENABLED=true`, that `ESCROW_PRIVATE_KEY` derives to the published `ESCROW_ADDRESS`, and that `ESCROW_ADMIN_TOKEN` is set before public exposure. |
| Quick Tunnel will not start | Check Cloudflare’s current Quick Tunnel prerequisites, including whether a `.cloudflared/config.yaml` is affecting Quick Tunnel mode. |
| A tunnel URL changed or stopped working | A restarted Quick Tunnel gets a new URL. Update the corresponding environment values, restart the app, and verify registry seller URLs and browser CORS again. |

## Judge handoff checklist

- [ ] Marketplace, Scout, Ledger, and all three tunnel windows remain running.
- [ ] Share the three public page URLs and the task prompt; do not share `.env` or any secret.
- [ ] Registry shows the book sellers ready and their endpoints use the public Marketplace URL.
- [ ] Scout is in paid mode with a low task cap and a low-balance test wallet.
- [ ] The book task estimate is within the task budget and configured maximum.
- [ ] Each paid ledger row links to a distinct successful Base Sepolia transaction with the expected amount and escrow recipient.
- [ ] The Ledger shows escrow status and any separate payout/refund transaction.
- [ ] Stop the app and all three tunnel processes after judging with `Ctrl+C` in their respective terminals.

## References

- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [Cloudflare Tunnel downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
- [Cloudflare Tunnel troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/)
- [Circle testnet faucet](https://faucet.circle.com/)
