# GrabList catalogue-only rollout

The **only active price lookup** is the D1-backed catalogue, accessed at
`/api/catalogue/*`. Previously supported Open Prices, Statistics Canada,
GroceryPulse, Épiceries.ca, VynnAI, ReefAPI, Savvi/Apify, and delivery-platform
manual capture are retained in source but **disabled**, including Worker
endpoints (HTTP 410) and PWA script loading. Archived prices and provider
settings remain in each device's existing local backup; they do not enter
catalogue comparisons or shopping totals.

## Cloudflare setup status (November 7, 2026)

The Cloudflare D1 database `grablist-catalogue` has **already been created**.
Its verified UUID has been committed to `wrangler.jsonc` under the
`CATALOGUE_DB` binding. **Do not create another database.**

Remaining deployment actions:

1. **Merge PR #4.** The Cloudflare Worker is configured with the verified D1
   binding. On the first `/api/catalogue/status` (or other catalogue API)
   request, `catalogue-bootstrap.mjs` runs the same idempotent SQL as
   `migrations/0001_catalogue.sql`, creates the tables, and seeds unpriced
   staples and sample links. The source migration is retained for future CLI
   deployment and reproducibility. You do **not** need to paste SQL manually.
2. Visit `https://grablist.rkrismcneely.workers.dev/api/catalogue/status`.
   It should report `ready:true`, with nonzero `products` and `listings`.
   If a D1 error occurs, the endpoint returns an explicit 503 instead of
   silently reverting to old pricing services.
3. For owner-triggered price refresh, configure `CATALOGUE_WRITE_KEY` on the
   GrabList Worker under **Settings → Variables and Secrets** as an encrypted
   **Secret**, with a long random value. No token belongs in GitHub or app source.
   Revisit the status API to confirm `refreshReady:true`.
4. Test **Compare store prices → Refresh saved product prices**. Generic
   product pages that do not expose a parseable price remain unavailable, and
   prices fetched without selecting a branch remain `online_unverified`.

Manual CLI migration is still an option:
`npx wrangler@latest d1 migrations apply grablist-catalogue --remote`.
This isn't required for the initial rollout, because first-run bootstrap
uses the exact same SQL. Local `--local` migration is also supported.

### Automatic starter URL import

The first **Compare prices → Refresh saved product prices** action after entering
your owner refresh key also imports existing direct product URLs automatically.
It uses two **small** public URL lists:

- `JP011098/grocery-price-tracker`: FreshCo, Walmart and Costco candidate links.
- `Donny1479/Retail-Price-Scraper`: only confirmed matched No Frills URLs;
  blocked search URLs and not-found results are ignored.

Requests are HTTPS to fixed GitHub-hosted source paths, capped at 256 KB per
source, and imported in D1 batches of 16. Each entry is restricted to an
approved retailer host, tagged **online_unverified**, and imported with **no**
price. A weekly local-browser timestamp avoids repeatedly importing unchanged
lists. Re-imports don't reset saved prices. If the upstream source is down,
previous product listings remain available.

This source reuse is a starter only: the selected sources have limited scope,
and matching, availability, and local Peterborough pricing must still be
verified at the retailer. Review the publishers' licensing and use terms before
redistributing substantial third-party datasets.

### Reusing existing Canadian grocery URL datasets

We found existing product URL datasets, so don't crawl every retailer first:

- **Project Hammer** — https://www.projecthammer.org/get-the-data.html
  Product CSV includes `detail_url`, `vendor`, `sku`, `upc`, `units`, and
  `brand`. Retailers include Walmart Canada and No Frills. Source prices
  reflect a Toronto pickup location; **do not import as Peterborough prices**.
  Public download availability does not automatically confirm bulk-reuse
  licence terms; check with publisher before distributing its dataset.
- **Grocery Price Tracker** —
  https://github.com/JP011098/grocery-price-tracker
  Curated `products.json` currently includes about 20 product groups, 52
  retailer URLs (including 10 FreshCo and 13 Walmart). Its FreshCo price
  scraper still requires store-specific verification. No licence file was
  found in the repository root when reviewed; get permission before copying
  its implementation or republishing the full dataset.
- **Shelfpedia Canada** — https://shelfpedia.com/en-ca/data/
  About 29,000 barcode-linked Canadian products under ODbL. Useful for
  canonical product matching, not store-specific product URLs; respect ODbL
  share-alike/attribution requirements if importing.
- **Kiizon/flippscrape** — https://github.com/Kiizon/flippscrape
  Flyer names and sale prices by postal code, but typically not retailer
  product page URLs. Verify current API behaviour and access terms.
- **Donny1479/Retail-Price-Scraper** —
  https://github.com/Donny1479/Retail-Price-Scraper
  Includes a URL cache, but many Walmart entries are blocked search URLs,
  not confirmed product pages.

`scripts/import_existing_catalogues.py` accepts downloaded Project Hammer
product CSV/ZIP and optionally a curated `products.json`. It produces
small, re-runnable SQL batches of identity and product URL records, **never
imports old prices**, and only accepts allowlisted retailer HTTPS product
links. The script does not automatically download or redistribute any data:

```bash
python3 scripts/import_existing_catalogues.py \
  --hammer /path/to/hammer-5-csv.zip \
  --out /tmp/grablist-url-batches \
  --max 2000
# After reviewing import rights and the output, run each batch:
npx wrangler@latest d1 execute grablist-catalogue --remote --file=/tmp/grablist-url-batches/catalogue-import-0001.sql
```

Imported product records are initially tagged with branch `online` and
NULL last-known prices. They must not be silently promoted to a selected
Peterborough branch. Cross-store lookups use product name, package size, and
explicit brand/UPC restrictions.

## Current functionality

- A persistent `catalogue_products` table and store-/SKU-specific
  `catalogue_listings` table.
- Price, timestamp, source, branch scope, failed-attempt details, and separate
  `catalogue_price_history`.
- Seed data for common staples plus two **unpriced** links for Maxwell House
  864 g at FreshCo and Giant Tiger. No seed price is invented.
- `Compare store prices` reads D1 listings for your current list only.
- `Refresh saved product prices` checks saved URLs in rate-limited batches of
  at most 12; it does not automatically discover missing URLs yet.
- Strict retailer host allowlist, HTTPS-only fetches, manual redirects,
  bounded page size and request timeout. No paywalled access or CAPTCHA bypass.
- Public product-page prices are `online_unverified`: **never** treated as
  confirmed shelf prices for your selected Peterborough store. Only fresh,
  matching `selected_branch` listings for a user-selected branch can be used
  in actual basket savings.
- Failed refreshes preserve last known price, with a stale flag. Generic
  product listings without a parseable structured price remain unavailable.

## Still to build before everyday use

1. Approved weekly-flyer importers with offer dates and deduplication.
2. Cross-store product URL discovery for every flyer/staples product.
3. Verified store-selection / pricing adapters, particularly FreshCo
   Lansdowne & The Parkway; direct HTML alone cannot verify local prices.
4. User-friendly retailer branch selection (no raw branch IDs).
5. Scheduled incremental discovery and refresh jobs with free-tier throttling.

A saved URL does **not** guarantee that a retailer exposes its current price.
If no URL or verified local price exists, show `Unavailable`; never substitute
an unrelated city's price. Before adapting any third-party scraper, inspect
its licence, the retailer's access rules, and current behavior.

## CI

Active suites cover catalogue matching, D1 API parsing, catalogue state,
location/intelligence helpers, and HTML/Worker syntax. Tests for the
temporarily disabled provider APIs remain in `tests/` for possible
reactivation; they are excluded from the active run because their assertions
expect intentionally disabled routes.
