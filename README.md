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
## Targeted retailer scraping feasibility

[snacsnoc/grocery-app](https://github.com/snacsnoc/grocery-app) demonstrates retailer-specific grocery search endpoints for Canadian retailers but uses **undocumented interfaces** and anti-bot workarounds. It is GPL-3.0 licensed. GrabList does **not** copy its code or implement the Walmart bot-bypass logic. Any future direct store adapters should use expressly permitted public data or authorized interfaces, honour retailer rules and reasonable rate limits, be isolated behind the provider contract, and stop rather than bypass access controls or CAPTCHA. Store-page price retrieval can become unreliable when sign-in, location cookies, promotions or browser rendering are needed.

## Product intelligence and automatic estimates

`intelligence.js` is a pure, tested decision layer used for automatic prices. It checks unit-normalized package size (e.g. 4 L vs 4000 mL), explicitly required brand, enabled stores, source freshness, confidence, and geographic scope. The closest appropriate evidence takes priority over a cheaper but less relevant national estimate. Among equally relevant sources, the currently assigned store is preferred, followed by price and user-ranked stores. This is **not** a guarantee of a branch-specific checkout price.

A national average is never automatically matched to an unspecified package size. GroceryPulse's exact one-line catalogue matches may be used as **estimates** for the requested size, but its response does not independently provide the physical package size; GrabList records `sizeEvidence=requested_exact_catalog_line` and discloses this uncertainty. A specific brand is never inferred from a generic reference. The app keeps learning item size and department from explicit edits, without locking in a brand.

The source freshness defaults are 30 days for a specific observed price, 45 days for GroceryPulse and 400 days for dated Statistics Canada averages. These are conservative application thresholds, not guarantees of validity. Manual prices are not automatically replaced. The app still needs broader authorized retailer coverage and a richer product catalogue to handle every generic item.
