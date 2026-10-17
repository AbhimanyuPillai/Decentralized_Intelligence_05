# Book and Fake Jobs sellers

All six services run inside the Marketplace server. Each publishes a manifest at `/sellers/{sellerId}/manifest`, and the Marketplace registers the built-in listings on startup. They share the seller JSON validation, free-test rate limit, x402 payment handling, and replay protection.

## Books

| Seller | Route | Request | Work |
| --- | --- | --- | --- |
| Shelf Scraper Agent | `POST /sellers/shelf-scraper/scrape` | `{"page":1}` | Reads one Books to Scrape page and its book detail pages; returns title, GBP price, star rating, and description. |
| FX Rates Agent | `POST /sellers/fx-rates/rate` | `{"from":"GBP","to":"INR"}` | Fetches a sourced GBP-to-INR rate from Frankfurter. |
| Hindi Summary Agent | `POST /sellers/hindi-summary/summarise` | `{"items":[{"id":"book-1","text":"Book description"}]}` | Produces a concise Hindi summary for each supplied description. |

The book service IDs, schemas, categories, and paid prices match the book examples in `marketplace-contract.json`. The two summary sellers need their own OpenAI-compatible API URL, key, and model in `.env`. Until configured, their manifests report `ready: false` and calls return 503 without charging.

## Fake Jobs

| Seller | Route | Request | Work |
| --- | --- | --- | --- |
| Fake Jobs Search Agent | `POST /sellers/fakejobs-scraper/search` | `{"keywords":"python","location":"Stewartbury","limit":10}` | Searches the Fake Python training site and returns matching listing IDs and links. |
| Fake Job Details Agent | `POST /sellers/job-facts/lookup` | `{"jobIds":["senior-python-developer-0"]}` | Fetches source-grounded job details for up to five IDs returned by the search seller. |
| Fake Job Summary Agent | `POST /sellers/job-summary/summarise` | `{"items":[{"id":"job-1","title":"Python developer","text":"Job description"}]}` | Produces a short summary for each supplied description. |

Job summary also needs its own provider settings. Search and details work without API keys. IDs are constrained to the Fake Jobs site; callers cannot pass arbitrary URLs.

## Configuration and prices

Paid prices are 5,000 units for each scraper, 1,000 units for each data seller, and 10,000 units for each summary seller. Free local mode publishes them at zero and needs no wallet. Set the seller-specific `*_PAY_TO` variables before enabling payments. For summary services, set `BOOK_SUMMARY_API_URL`, `BOOK_SUMMARY_API_KEY`, `BOOK_SUMMARY_MODEL`, `JOB_SUMMARY_API_URL`, `JOB_SUMMARY_API_KEY`, and `JOB_SUMMARY_MODEL` as needed.

The buyer can discover the exact live request and response schemas from `GET /api/registry`; no client should duplicate these schemas by hand. In this project, Scout currently reads the registry but does not yet call sellers or submit the resulting buyer ledger record.
