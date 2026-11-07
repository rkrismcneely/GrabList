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

1. Apply the committed schema and starter products using a local authenticated
   checkout of this PR branch:
   `npx wrangler@latest d1 migrations apply grablist-catalogue --remote`
   (Cloudflare will prompt for authentication if necessary.) The migration
   `migrations/0001_catalogue.sql` creates the tables and seeds unpriced
   common groceries and two sample product URLs.
2. Configure the Worker secret `CATALOGUE_WRITE_KEY` through Cloudflare's
   Worker Settings → Variables and Secrets (type **Secret**), or using
   `npx wrangler@latest secret put CATALOGUE_WRITE_KEY`. Use a randomly
   generated long key and never commit it to GitHub.
3. Merge PR #4 only after validating the migration and database binding,
   then confirm the Worker deployment and check
   `https://grablist.rkrismcneely.workers.dev/api/catalogue/status`
   reports `ready:true` and `refreshReady:true`.

No connection with Cloudflare's mutating management APIs is currently
available from this Chat session, so these account changes remain
manual or can be done through a browser-control session in Work mode.

For local development, use `--local` instead. The
`/api/catalogue/status` endpoint reports diagnostic status without
retrieving external retailer prices.

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
