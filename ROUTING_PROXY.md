# Use one public URL for all three pages

This proxy keeps the Marketplace, Scout, and Ledger servers separate. It sends
each request to the existing server based on the page path and browser referrer.
The application servers and their source files do not need changes.

## Start the services

Start the Marketplace, Scout, and Ledger as usual and keep them running. The
proxy reads these local ports from `.env`:

- Marketplace: `MARKETPLACE_PORT` (defaults to `3100`)
- Scout: `BUYER_PORT` (defaults to `3101`)
- Ledger: `LEDGER_PORT` (defaults to `3102`)
- Proxy: `PUBLIC_PROXY_PORT` (defaults to `3103`)

In a second terminal, from the project folder, run:

```powershell
node scripts/public-proxy.mjs
```

Then point ngrok at the proxy, not at one of the three app ports:

```powershell
ngrok http 3103
```

## Pages

- `https://<ngrok-domain>/` opens Marketplace.
- `https://<ngrok-domain>/scout` opens Scout.
- `https://<ngrok-domain>/ledger` opens the Ledger.

The proxy also routes each page's `/api` and asset requests using the page's
referrer. Scout's server-to-server ledger writes are routed by the ledger API
path. A request without a Scout or Ledger page referrer goes to Marketplace.

## Public URL settings

Set these values in the local `.env` to the same ngrok origin (no route path and
no trailing slash), then restart the app servers:

```dotenv
PUBLIC_BASE_URL=https://<ngrok-domain>
MARKETPLACE_BASE_URL=https://<ngrok-domain>
BUYER_ORIGIN=https://<ngrok-domain>
LEDGER_BASE_URL=https://<ngrok-domain>
```

Keep private keys and report tokens only in the local `.env`. Never put them in
this document or share them with the tunnel provider.

## Stop

Stop the proxy terminal and the ngrok terminal with `Ctrl+C`. Stop the app
servers separately if you no longer need them.

This setup is intended for the project demo. It relies on same-origin browser
referrers to distinguish Scout and Ledger API and asset requests. If a browser
extension or privacy setting removes the referrer path, those requests fall
back to Marketplace and will fail; restore the default same-origin referrer
behavior before the demo.
