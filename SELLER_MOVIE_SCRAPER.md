# Movie Scraper Seller

The first seller service is `movie-scraper`, built on Scrap This Site's Oscar movie AJAX exercise. It supports one year per paid request, from 2010 through 2015, at **5,000 atomic USDC units (0.005 USDC)**.

## HTTP contract

`POST /sellers/movie-scraper/scrape`

Request body:

```json
{"year": 2015}
```

Successful response:

```json
{
  "year": 2015,
  "movies": [
    {
      "title": "Spotlight",
      "year": 2015,
      "nominations": 6,
      "awards": 2,
      "bestPicture": true
    }
  ]
}
```

The seller retrieves the page's AJAX JSON directly, checks `robots.txt`, normalizes titles and the optional `best_picture` value, then validates the complete output against its JSON Schema. Invalid input returns 400 before payment. Source/network/output failures return 500 before settlement.

## Payment behavior

The route uses the official x402 v2 Express, Core, and EVM SDK packages. It advertises the `exact` scheme on `eip155:84532`, the Base Sepolia USDC asset from the shared contract, and the configured `MOVIE_SCRAPER_PAY_TO` receiver. The EVM exact scheme defaults to EIP-3009 authorization for this network.

The x402 middleware verifies the authorization before the route runs and settles only after a successful 2xx response. The route validates its output before sending that response. SQLite stores a SHA-256 fingerprint of the SDK-decoded payment authorization and atomically prevents concurrent or repeated use. Successful settlements are marked settled using the SDK-decoded `PAYMENT-RESPONSE`; confirmed pre-settlement failures release their replay claim. Uncertain settlement outcomes remain locked to prevent accidental double charge.

## Setup

1. Copy `.env.example` to `.env` and put a **fresh Base Sepolia receiving address** in `MOVIE_SCRAPER_PAY_TO`.
2. Set `PUBLIC_BASE_URL` to the public HTTPS tunnel URL when the service is exposed.
3. Run `npm install`, then `npm start`.
4. Check `GET /sellers/movie-scraper/manifest`; it returns the listing and the public endpoint URL based on `PUBLIC_BASE_URL`.
5. Register that listing with the marketplace API (`POST /api/registry`) once the tunnel URL and receiving address are configured.

No buyer private key is required by this seller. Do not put private keys in the repository or browser bundle. `GET /health` reports marketplace health; the seller route returns 503 until a receiving address is configured.
