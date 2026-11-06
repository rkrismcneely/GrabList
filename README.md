# GrabList

*Grab what you need. Spend less.*

A mobile-first, swipe-driven grocery shopping Progressive Web App. Hosted on Cloudflare Workers, deployed automatically from this independent GitHub repository.

## What works

### Phase 1 — list and shopping UX

- Clear-inspired coloured, solid item rows and swipe gestures.
- Enter adds a new item without dismissing the keyboard; pull down also starts a new entry.
- Shop mode groups items by enabled retailer and the preferred aisle/department order.
- Swipe right to mark bought, left to delete, with Undo.
- Completed items remain at the bottom with a strikethrough style.
- Unpriced, unassigned items default to the busiest enabled store; Edit offers manual override.
- Data is stored on this device; export/import JSON for backup.
- Settings includes a validated Canadian postal code, saved locally, to support geographically relevant price offers.
- In **Settings → My stores**, use the up/down arrows to rank preferred stores. This order is used for Shop mode, unpriced-store placement ties and equal-price comparisons.

### Phase 2A — comparison foundations (in progress)

- Enter separately observed **manual** prices for the same item at multiple enabled stores from its Edit panel.
- In Shop mode tap **Compare store prices** to review proposed changes and total potential savings.
- No additional store is recommended unless its basket-wide savings meet the configured threshold (default **$5**). Improvements within stores you already visit need no extra-stop threshold.
- Quantity affects calculated savings. Unpriced items are not considered free.
- Only explicitly recorded offers with the same item size/required brand and an observation date within **30 days** participate.
- When source location metadata exists, prefer applicable offers in this order: selected branch, exact postal code, postal prefix, city, region, province, national, then unscoped manual quotes. No unrelated area's price is substituted.
- City and region matching require verified provider geography; GrabList does not infer a city or branch merely from a postal code.
- The preview never reassigns stores until you tap **Apply suggestions**.
- Example/demo prices never count toward savings.

### Phase 2B — public-source discovery (on-demand)

- Tap **Search public prices** in an item's Edit screen: enter an optional barcode for a precise lookup, or search by the item's name. GrabList queries the free **Open Prices** public API and shows Canadian CAD observations from identifiable individual stores, now extending up to two years back with observation dates visible.
- For **GroceryPulse**, GrabList first tries your postal area. If unsupported, it looks up the approximate centroid of your three-character postal area using the free Zippopotam.us/GeoNames API and chooses the **nearest of the 16 tracked reference cities by straight-line distance**. If that lookup fails, it uses a clearly labelled regional fallback and does not claim geographic closeness. Reference-market chain prices are not a nearby branch quote.
- **Statistics Canada monthly average retail food prices** (Table 18-10-0245-01) provide a final fallback for selected matching groceries. The embedded snapshot is explicitly dated **September 2026**, not live. Opening **Shop** automatically fills eligible missing staple prices from this dataset; mismatched package sizes are not silently converted.
- Reference estimates show with **≈**, including their source/location/date in Edit. They can be replaced with actual manual prices. They do not count as manually confirmed observations or enter store-savings calculations.
- The observations are sorted by relevance: same postal code, same postal-code prefix, other branches in the same province, other Canadian locations. Every result includes its store, source, observed date and product details when available.
- In Shop mode, tap **Compare store prices**, then **Check Canadian online prices** to request a GroceryPulse comparison. GroceryPulse covers 16 specified Canadian cities and 50 reference products; for unsupported postal codes such as Peterborough, GrabList **explicitly selects a reference city** (e.g. Toronto), which is labelled as nonlocal. Chain medians never count as confirmed prices at your own branch.
- Public-price searches require a deliberate tap, except the local **Statistics Canada** national-average snapshot loaded when shopping. API requests go through `worker.js` with fixed allowlisted upstream hosts.
- Product searches present **several candidates** with name, brand/size where available, store, source, match confidence, date and price. The shopper explicitly chooses which product/offer to use; a different package size requires confirmation. No source search silently selects a match. Savvi also provides its original match score and mismatch reasons when available.
- **Savvi via Apify (optional)**: enter your own Apify API token in Settings, then tap **Search Savvi (your Apify credits)** for a single product. Current adapter covers **No Frills and Independent**. API calls are billed to that user's Apify credits, never the GrabList owner; the token is only held in tab sessionStorage and is sent to the fixed Apify actor via the Worker. No token appears in the source code, URL or list backup. Free credits are limited, and an Actor may time out or charge even if the browser loses the response.
- Public observations and dated averages are **estimates for planning**, not price guarantees. Only explicitly selected or confidently identified products may populate an approximate list price. Exact branch selection, tax/promotion eligibility and authoritative national shelf-price feeds are not available yet.

**Not yet implemented:** retailer-authorized direct live inventory/regular-price feeds, exact store-branch selection, barcodes scanned with the camera, automatic synchronization, or automatic substitution. No coverage, matching or price is invented to fill an API gap. A manual quote is **not** a live verified store price.

## Supported retailers

Walmart, No Frills, FreshCo, Your Independent Grocer, Costco, Giant Tiger.

The app does not imply coverage at every retailer; enabled stores are *shopping preferences*, not a claim of connected pricing.

## Price integration design

See [providers/CONTRACT.md](providers/CONTRACT.md). The price comparison engine is a standalone, provider-neutral module, [comparison.js](comparison.js), and geographic matching is in [location.js](location.js). Public lookup routes are implemented in [worker.js](worker.js). Providers will need to attach source, product identity, exact size, observed date, store/region scope and eligibility restrictions. Missing matches remain unknown.

Open Prices is open community data but may have sparse Canadian coverage. Savvi is operated through Apify and is metered; each shopper supplies their own key for optional use. **Never hardcode a platform API token in source code, GitHub, or a public Worker binding.** Session-stored user tokens are accessible to scripts running in that browser tab and should be treated as sensitive.

## Tests

```bash
node --test tests/*.test.cjs
```

Tests exercise the comparison and location-matching engines without external calls. This does not replace real-device iPhone gesture tests.

## Deployment

- Cloudflare **Workers Builds**, linked to `main` of `rkrismcneely/GrabList`
- `worker.js` handles bounded public price inquiries; static files are served using Cloudflare's `ASSETS` binding.
- Deploy command: `npx wrangler deploy`
- Asset plus price-gateway Worker configuration: [wrangler.jsonc](wrangler.jsonc)
- Production URL: https://grablist.rkrismcneely.workers.dev
- No manual build command or npm dependencies required

This repository and deployment are independent of Tales Without End.

## Privacy, offline access and backups

The list, quote history and preferences are kept in browser localStorage. A Savvi Apify token, if provided, is kept separately in sessionStorage (not exported) and sent only on explicit Savvi searches; close the tab or select Disconnect to clear it. The service worker caches the app shell to enable offline use after an initial successful load. There is no account synchronization. Clearing Safari website data can erase the list, so export a backup regularly.
## Exact product discovery and barcode-based prices

When an item has no suitable priced match, **Search public prices** also offers Open Food Facts catalogue variants (brand, package size, barcode and Canadian listing status). This is user-initiated, not automatic full-text scraping. Selecting a product stores its barcode and associated catalogue size for that item, learns its preferred size for future generic entries, and immediately checks crowdsourced Open Prices observations for the **exact** barcode. The product catalogue is not a price source: no price is created if no Canadian observation exists.

Once a barcode is saved, Shop mode can check recent Open Prices observations automatically, alongside the existing GroceryPulse and national-reference sources. Only the matching barcode, compatible package size and recent dated source observations are eligible for automatic price estimates. A user-selected catalogue size can resolve missing package-size metadata in the price response, but the displayed price remains clearly labelled an estimate and is not assumed to be a local branch price. Explicit brand selection applies to the current item, not to future generic groceries.

The catalogue gateway **GET /api/pricing/catalog-search?name=...** uses the legacy Open Food Facts full-text search endpoint as documented. Search results are bounded, cached for ten minutes per Worker isolate, and throttled to respect the provider's published **10 search requests/minute/IP** restriction. Searches are never sent as the user types; only a deliberate Search tap triggers them. Access may be unavailable or rate-limited, and the data is licensed under ODbL. Nothing is automatically copied into a price history database.

## Configured delivery platforms and one-tap comparison

Delivery platforms are configured under **Settings → Delivery app preferences**. The shopper can enable/disable and rank DoorDash, Uber Eats, and Instacart, and save an optional storefront URL and/or branch address for each retailer on each platform. All configuration remains in local list storage (and exported backups). Product-specific price capture remains in Edit, but one-time storefront setup is now centralized in Settings.

**Compare store prices** now initiates a fresh, sequentially throttled check for up to 50 active items, using the available, directly queryable public sources and opt-in limited-key sources (VynnAI is still limited to eight automatic lookups per UTC day/device and only exact-barcode matching). An already running Shop lookup finishes before Compare starts. The result shows eligible per-store reference candidates, an explicitly *partial* reference subtotal and coverage count per store, and individual buttons to choose a different source/store when the shopper confirms the estimate. The list updates missing or outdated national estimates only when the new reference belongs to the item's assigned store (or is truly store-neutral), never by copying another retailer's quote onto that store. Manual prices and shopper-confirmed delivery estimates are preserved. The separate existing conservative savings optimizer continues to use only actual manually recorded fresh offers; it does not turn partial reference subtotals into fictitious basket savings.

**Delivery app priorities are not automated delivery-app price lookups.** DoorDash, Uber Eats and Instacart have no unrestricted consumer price search API we can legitimately call from GrabList. Saved storefront links (or branch labels when the native iPhone app has no shareable URL) appear in priority order in the comparison as review shortcuts, not as prices retrieved by the compare operation. Official API authorization or an appropriately licensed data provider would be required for unattended extraction. Site-owner costs remain zero and paid per-request services are never invoked without their individual prior opt-in.

## DoorDash, Uber Eats and Instacart (shopper-assisted)

GrabList offers a first-stage integration with these delivery platforms in **Edit item → Check DoorDash, Uber Eats or Instacart**. A shopper can choose one of their enabled retailers, save the **exact storefront URL for their branch** and open that platform in a new tab. A one-tap button copies the item name, preferred size and any explicitly required brand for searching inside the store. Back in GrabList, the shopper can paste visible product text (or tap the clipboard button when browser permissions allow), review any extracted price and package size, and explicitly confirm the identity and store before recording a price.

The workflow deliberately performs **no platform scraping, no unofficial API calls, and no hidden background searches**. The user must visit the delivery app and confirm the listing. Official DoorDash Marketplace API access is application/partner-limited. Uber Eats' API and Instacart terms restrict unauthorized automated extraction and competitive aggregation. Personal/family use alone does not confer API permission. Shop uses these as `priceSource=reference` with a clearly labelled, manually observed **delivery-platform estimate**, never as an in-store price. Differences in delivery-platform markups, per-weight estimates, promotions, tax and service fees remain the shopper's responsibility to check.

Saved storefront URLs are HTTPS-only and strictly restricted to the appropriate platform's host and retailer storefront paths, with tracking queries and fragments removed. The selected branch is remembered only after an explicit shopper action; GrabList never silently selects a different local branch. Optional verified links for Peterborough FreshCo (181 Brock Street), Independent (400 Lansdowne East) and Costco (485 The Parkway) are suggested only for `K9...` postal codes and must be confirmed by the shopper. Saved URLs are included in the local list backup, but no delivery-platform credentials are requested or kept. Product links from outside the selected delivery service are rejected. A parser detects `CA$6 44` and `$6.44`, refuses to choose between multiple conflicting sale/regular price amounts, and ignores prices expressed solely per kilogram. Confirmation and product size are required before an estimate is stored. If the delivery app opens without a copyable URL, the shopper can instead enter the branch's street address (including street number); no deep link is fabricated or required. The store selector lists all supported stores, including disabled ones, and prompts before enabling a newly selected store. The DoorDash Peterborough No Frills directory is available as a navigation shortcut; the shopper explicitly selects the 1866 Lansdowne Street West branch rather than assuming the directory is an individual storefront.

This is not full automatic delivery-app integration. For automatic prices we would need platform authorization or a licensed, API-accessible provider permitted to supply the data for cross-store comparison.

## Optional broader retailer price sources (bring your own account)

GrabList now supports two additional **optional** key-funded price APIs, using fixed routes in the Cloudflare Worker rather than shipping a platform owner's credentials:

- **VynnAI:** `POST /api/pricing/vynn`. Shopper supplies their own VynnAI key in Settings. Their documented Free tier currently allows **500 API requests/month**, with broader reference-store data across Canadian chains and provinces. Search by name or exact UPC. Name results are presented for review, not automatically treated as guaranteed product matches. With an explicit **automatic search** opt-in, GrabList can spend up to **eight requests per UTC day on this device** when public sources cannot price an item reliably; the automatic selector accepts VynnAI results only with the **same saved barcode, compatible size, known enabled retailer and an actual observation date**. If the source supplies no date or price, no automatic reference is created. This is an extra limit chosen by GrabList, not a guarantee that another device or API consumer cannot use more of the account's monthly quota.
- **ReefAPI Loblaws:** `POST /api/pricing/reef-stores` and `POST /api/pricing/reef-search`. Shopper supplies their own ReefAPI key. The introductory **1,000 credits** are not a permanent monthly free allowance. Store-directory and search requests currently cost **two credits per successful call**. In Settings the shopper searches for No Frills or Independent branches with their postal area, and explicitly selects the branch to use. Search results preserve the selected branch, price, size, stock and available member/regular-price context. The app does **not automatically** spend ReefAPI credits, choose a default branch, or equate an approximate per-weight shelf price with an exact package price.

Keys are held only in this browser's **sessionStorage**, not exported with list backups or saved in Cloudflare account settings. Each gateway forwards the supplied key only to its fixed upstream API host using a server-side bearer/API-key header, and returns normalized product data without echoing the key. The Worker does not cache authenticated responses. A browser session is not a secure long-term credential vault: use restricted or easily revoked provider keys if offered.

Both sources may have data gaps, stale information, mismatched variants, quotas, or API changes. It is okay for a search to have **zero valid results**. A live provider response must be tested with the user's own key before claiming real-world compatibility; mocks and CI only verify the adapter contract.

## Targeted retailer scraping feasibility

[snacsnoc/grocery-app](https://github.com/snacsnoc/grocery-app) demonstrates retailer-specific grocery search endpoints for Canadian retailers but uses **undocumented interfaces** and anti-bot workarounds. It is GPL-3.0 licensed. GrabList does **not** copy its code or implement the Walmart bot-bypass logic. Any future direct store adapters should use expressly permitted public data or authorized interfaces, honour retailer rules and reasonable rate limits, be isolated behind the provider contract, and stop rather than bypass access controls or CAPTCHA. Store-page price retrieval can become unreliable when sign-in, location cookies, promotions or browser rendering are needed.

## Product intelligence and automatic estimates

`intelligence.js` is a pure, tested decision layer used for automatic prices. It checks unit-normalized package size (e.g. 4 L vs 4000 mL), explicitly required brand, enabled stores, source freshness, confidence, and geographic scope. The closest appropriate evidence takes priority over a cheaper but less relevant national estimate. Among equally relevant sources, the currently assigned store is preferred, followed by price and user-ranked stores. This is **not** a guarantee of a branch-specific checkout price.

A national average is never automatically matched to an unspecified package size. GroceryPulse's exact one-line catalogue matches may be used as **estimates** for the requested size, but its response does not independently provide the physical package size; GrabList records `sizeEvidence=requested_exact_catalog_line` and discloses this uncertainty. A specific brand is never inferred from a generic reference. The app keeps learning item size and department from explicit edits, without locking in a brand.

The source freshness defaults are 30 days for a specific observed price, 45 days for GroceryPulse and 400 days for dated Statistics Canada averages. These are conservative application thresholds, not guarantees of validity. Manual prices are not automatically replaced. The app still needs broader authorized retailer coverage and a richer product catalogue to handle every generic item.

## One-tap, full-list pricing (no per-item lookups required)

**Shop → Compare store prices** checks all active items, displays per-item and partial per-store comparison evidence, and automatically populates compatible missing or outdated reference prices. A separate progress bar shows completion and a final count identifies any products still without a credible quote. The shopper does **not** need to visit Edit or pick a price for each grocery item. Saved manually entered prices and shopper-confirmed delivery-platform prices are not automatically overwritten. A retailer's price is never silently attributed to a different store. Auto-assigned, unpriced items may be routed to a better-covered enabled store; deliberate store assignments remain unchanged.

The lookup checks keyless, dated Canadian reference data from GroceryPulse and Statistics Canada, exact-barcode Open Prices observations, and a new **Épiceries.ca** fallback through `GET /api/pricing/epiceries`. This free documented read-only service provides real product names, pack sizes, dates and prices from six **Québec** chains. Its values are tagged as **Québec budget benchmarks**, never as prices at FreshCo, No Frills, or a Walmart branch in Ontario. Named-brand and mismatched-package references are rejected. For a generic item with no size, a high-confidence catalogue match can pick one actual SKU package and record that provisional size; this is an explicitly labelled source product, not a made-up pack. The API response and source are attributed to épiceries.ca. Cache time: ten minutes per Cloudflare Worker isolate, with modest bounded result counts.

Open Prices barcode observations up to two years old are permitted as **last-resort dated estimates** when a fresher comparable source is missing; old observations rank below fresh nearby references. The item source and date remain inspectable.

GroceryPulse public shopper calls are limited to roughly 30/min/network. The new bulk scan first sends the shopper's list in small batches to classify which lines are exact matches, then runs item-level price queries only for those that are tracked, at a paced rate of 2.1 seconds between calls. This avoids wasting the free public API quota on unrelated grocery products and keeps larger one-button scans within its fair-use rules. Results are cached for four minutes in the active browser tab. The slower Shop-on-open convenience lookup checks only a few items, leaving the comprehensive scan to the Compare button.

**Coverage limitation:** No public provider has verified prices for every product at every Canadian store. A truly unavailable or mismatched item must remain unpriced (and is listed under “Still missing”) rather than receive a fabricated amount. DoorDash, Uber Eats and Instacart storefronts are not automatically scraped; fully automated delivery-platform prices would require an authorized feed. Real authenticated and public upstream response compatibility still needs independent live validation; CI uses mocked provider responses.
