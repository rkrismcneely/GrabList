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

## FreshCo and Your Independent Grocer direct-link candidates (November 7)

The remaining two supported retailer banners now have source-specific URL-only
imports. **Neither source guarantees stock at your Peterborough location.**

### Your Independent Grocer — shared Loblaw product IDs

Loblaw's website uses common product IDs across its No Frills and Your
Independent Grocer banners. For example, a publicly indexed Independent
product page for large eggs shows the same `20812144001_EA` product number as
our No Frills catalogue:
`https://www.yourindependentgrocer.ca/en/large-size-eggs-12-pack/p/20812144001_EA`.

`scripts/discover_remaining_urls.py` reuses published No Frills product
SKUs and product name/path segments to construct **Independent candidate
routes** only when the path exactly matches the known Loblaw `/en/.../p/SKU`
convention. The initial dataset contains **2,412 candidate routes** covering
**260 of 368 catalogue descriptions**. We cannot prove that Independent sells
each shared SKU or that every route renders a product instead of an app-shell
fallback. Do **not** describe the 2,412 as live verified Independent links.

The records carry `discoveryStatus=shared_loblaw_sku_candidate_unverified`,
are stored as `online_unverified`, and are explicitly labelled as candidates
in the comparison UI. They never count as verified Independent shelf prices.

### FreshCo — publisher-issued, search-indexed product pages

FreshCo's actual website has `/products/<product-slug>` item pages, but its
robots.txt disallows automatic crawling of the product paths from our GitHub
Actions runner. We respect that restriction and do not circumvent a 403.

A curated source file, `data/freshco-indexed-product-pages.json`, contains
**55 actual official FreshCo product URLs** returned by independent
search-engine indexes, with their indexed product titles. No product-page
slugs were fabricated and the importer does not crawl the FreshCo site.
The strict matching step retained **45 entries**, covering **25 existing
GrabList product descriptions**, including bread, eggs, milk, butter,
marshmallows and several flyer-advertised staples. These are not guaranteed
to apply to either local FreshCo store or to be current.

### Integration / safe import behaviour

- `data/independent-parts/` (31 small shards) and `data/freshco-parts/`
  (1 small shard) are reproducible from the checked-in metadata.
- `/api/catalogue/import-independent` and `/api/catalogue/import-freshco`
  use the existing `CATALOGUE_WRITE_KEY` Worker secret. Neither imports
  prices or asserts branch-specific availability.
- **Compare prices → Refresh saved product prices** now loads both sources,
  showing batch progress and saving the next shard index to resume if Safari
  closes or the request fails. Previous prices/history remain untouched.
- Each imported listing is `online_unverified`. The UI distinguishes
  cross-banner SKU candidates from search-indexed FreshCo product pages.
- Future full FreshCo coverage requires a permitted product-data feed or an
  explicit data-sharing arrangement; Independent requires banner-specific
  live SKU and branch validation before its candidates become verified listings.

## Costco public product sitemap coverage

Costco publicly declares `https://www.costco.ca/sitemap_lw_index.xml` in
its `robots.txt`. Two linked product sitemaps contained **26,382 publicly
listed item pages**. We match URL-derived product descriptions and their
published item numbers to our canonical grocery catalogue, excluding obvious
non-food/non-consumable keyword collisions such as bread knives, bread makers,
coffee tables and novelty prints.

The November 7 first pass retained **809 candidate Costco
direct product URLs** matching **191** GrabList descriptions, sharded in
`data/costco-parts`; scripts and tests enumerate the exact count in a given
source revision. The published pages may be online-only, absent at a nearby
warehouse, or outdated; **no Costco shelf price or stock is inferred**.

- `scripts/discover_costco_urls.py` reads only the explicitly published
  product sitemap files, with a bounded 8 MB size check and a conservative
  product matcher. It selects real publisher URLs, never guessed paths.
- The `/api/catalogue/import-costco` endpoint imports URL-only D1
  records in 80-link batches. Authorization uses the same owner's refresh
  secret already configured in Cloudflare.
- **Compare prices → Refresh saved product prices** imports Costco batches
  along with the existing Walmart, No Frills and Giant Tiger sources. Its
  progress and resume cursor survive a phone tab closing.
- A sitemap slug is not a full product specification. A size is accepted
  as a hint only where unambiguous and plausible, or where explicitly
  matched against an existing canonical product size. Ambiguous or
  decimal-stripped quantities are left unknown.
- Some retailer sitemap fetches may temporarily fail; previously imported
  product links and price observations are preserved, and a later import
  can resume.

## Giant Tiger official product feed coverage

Giant Tiger publishes direct product and variant URLs in a publicly
accessible Shopify catalogue. Our bounded read of its first 100 product-feed
pages covered 25,000 products and retained **1,817 product-page links**
matching **242 GrabList product descriptions** after strict title matching.
Items might be sold online only or out of stock at a specific Peterborough
location; no Giant Tiger shelf price, stock claim, or historical sale price
is imported.

- `scripts/discover_gianttiger_urls.py` observes the retailer's robots
  directives and caps requests/pages. It only accepts publisher-issued handles
  and variant IDs, not guessed URL slugs, and excludes mismatched variant
  colours (for example, a rug coloured “Oat Milk” is not oat milk).
- `data/gianttiger-parts/` contains small source-attributed shards.
  The `/api/catalogue/import-gianttiger` endpoint requires the same owner
  key as existing price refresh and uploads URL metadata with scope
  `online_unverified`.
- **Compare prices → Refresh saved product prices** imports those shards once
  and retains a cursor locally to resume after a phone tab closes. Data
  remains in D1 between sessions; no product prices are overwritten.
- Verified no price is imported and no external provider or legacy pricing
  integration is re-enabled.

Our public-feed probes also found `Your Independent Grocer` serves a
sitemap, but its first 1 MB contained category links, not product `/p/`
links; its product catalogue remains to be discovered. FreshCo blocked
automated listing/sitemap requests (HTTP 403), and we do not bypass those
protections. Costco's actual robots-declared sitemap index is
`https://www.costco.ca/sitemap_lw_index.xml`, with separate public product
sitemap files; that is a candidate for the next importer.

## Direct product-page URL matching at scale

A one-time [Project Hammer](https://www.projecthammer.org/get-the-data.html)
metadata-only discovery run processed its publicly downloadable product table
without importing any historical prices or source price history. It selected
direct product-page URLs for the **No Frills and Walmart Canada** banners that
match GrabList's canonical grocery products, respecting brand, product type,
and available size constraints.

- The completed November 7 run retained **5,072 matched product-page URLs**: **2,463 No Frills** and **2,609 Walmart**, covering **297 of 368** canonical product descriptions (with conservative matching and per-product limits). These have not been verified against the current Peterborough inventory.
- `scripts/discover_hammer_urls.py` downloads public product metadata to an
  ephemeral GitHub Actions runner, matches existing catalogue identities,
  ignores search URLs, and generates a compact URL-only manifest.
- `data/hammer-parts/` holds 80-record shards for a fixed authenticated
  `/api/catalogue/import-hammer` endpoint. Source attribution is retained.
- First use of **Compare prices → Refresh saved product prices** after
  deployment imports the shards, showing progress. The import resumes safely
  on another click if a mobile browser closes or a request fails.
- **Only direct retailer product-page links are saved**, not search queries,
  price guesses, stock claims, UPC matches based on unverified assumptions,
  or historical Toronto prices. Listings are `online_unverified`.
- Matching is intentionally conservative but **does not guarantee live links,
  Peterborough-specific availability, or equivalent prices**. The URL data
  may contain stale/deleted product pages and some false-positive matches;
  actual product-page checks are still required.
- The source covers only **two of six stores**. Existing smaller curated
  imports cover a few FreshCo and Costco URLs, and a matched No Frills set.
  Full coverage of FreshCo, Independent, Giant Tiger and Costco needs a
  permitted storefront product search feed or verified sitemap/catalogue
  discovery. Do not fabricate cross-banner links by replacing domains.

The source site publishes its complete archive openly for research. The
GrabList repository retains only the product URL *subset* matching its own
catalogue and credits the source. Do not republish the full Project Hammer
archive, photographs or source price histories. Review the publisher's
reuse/licensing terms before expanded redistribution.

## November 2026 flyer and staple catalogue expansion

On the first catalogue API request after this release, D1 automatically
applies `migrations/0002_flyer_candidates.sql` (idempotent). It adds:

- **131 dated, manually reviewed product discoveries** spread across all six
  active store banners: FreshCo (18), No Frills (20), Walmart (21),
  Your Independent Grocer (23), Giant Tiger (20), and Costco (29).
- **216 additional common staple/category entries**, including marshmallows,
  bread, eggs, milk, snacks, produce, pantry, frozen and household goods.
  After deduping some flyer/staple overlap there are ~333 new *candidate*
  products on top of the original 35 (subject to existing catalogue rows).
- `catalogue_flyer_discoveries` tracks the retailer, validity period,
  regional-unverified scope, and original flyer page used to identify
  each candidate. Expired flyer references no longer count as *current*.
  No prices or guessed retailer product URLs are stored for these discoveries.
- `/api/catalogue/status` returns product, saved URL, flyer-discovery and
  current-flyer counts.
- The comparison sheet now shows whether a list item matches a known
  product, a currently dated regional flyer mention, and/or a saved
  retailer product URL, without mixing these states or inventing savings.

The sample was checked against flyers dated **November 4–11, 2026**
(Costco's longer flyer through November 22). Sample associations
**do not prove a Peterborough branch had the offer or advertised price**.
This is a *first pass*, not a licensed bulk republication of every flyer
item. Different flyers and branches can have different assortments.

For a complete weekly import of *every* item, use an authorized retailer feed
or a data source that permits that use. The Flipp application terms restrict
copying application content into a database without permission, while
Flyers Now's terms prohibit republishing substantial portions of its flyer
library. Do not automate large-scale copying from either service without an
appropriate agreement. The curated seed is limited to a modest number of
verified product identities, and never copies photos, flyer layouts, or prices.

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
