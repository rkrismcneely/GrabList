# GrabList catalogue-only rollout

The **only active price lookup** is the D1-backed catalogue, accessed at
`/api/catalogue/*`. Previously supported Open Prices, Statistics Canada,
GroceryPulse, Épiceries.ca, VynnAI, ReefAPI, Savvi/Apify, and delivery-platform
manual capture are retained in source but **disabled**, including Worker
endpoints (HTTP 410) and PWA script loading. Archived prices and provider
settings remain in each device's existing local backup; they do not enter
catalogue comparisons or shopping totals.

## Configure Cloudflare (owner action required)

The assistant's GitHub integration can commit code, but cannot create or bind
Cloudflare D1 databases or install Worker secrets in your account. Do **not**
put a fake database ID or refresh secret in GitHub.

From an authenticated project checkout:

1. `npx wrangler@latest d1 create grablist-catalogue --binding CATALOGUE_DB --update-config`
   and commit the resulting `wrangler.jsonc` binding, including Cloudflare's
   **real** database ID. Alternatively, create D1 in the Cloudflare dashboard
   and bind it to the Worker as `CATALOGUE_DB`.
2. `npx wrangler@latest d1 migrations apply grablist-catalogue --remote`
   applies `migrations/0001_catalogue.sql`, creating the tables and an
   unpriced starter product catalogue. Migrate **before** enabling price refresh.
3. `npx wrangler@latest secret put CATALOGUE_WRITE_KEY`
   with a long random value. Never place the secret in code, repo, URLs, or
   screenshots. It is requested only when refreshing prices and held in
   browser sessionStorage until the tab closes.
4. Deploy or rebuild the Worker. Check
   `https://grablist.rkrismcneely.workers.dev/api/catalogue/status`
   reports `ready:true` and `refreshReady:true`.

For local development apply migrations with `--local` and a local secret in
your development environment. The `/api/catalogue/status` endpoint returns
clear diagnostics without performing third-party price lookups.

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
