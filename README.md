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
- When an exact catalogued item is available from **GroceryPulse**, an unsupported postal area falls back to a clearly named **reference market in the same province** (or a labelled Canadian reference market). This is not a quote from a nearby branch, and we do not claim the selected market is the nearest.
- **Statistics Canada monthly average retail food prices** (Table 18-10-0245-01) provide a final fallback for selected matching groceries. The embedded snapshot is explicitly dated **September 2026**, not live. Opening **Shop** automatically fills eligible missing staple prices from this dataset; mismatched package sizes are not silently converted.
- Reference estimates show with **≈**, including their source/location/date in Edit. They can be replaced with actual manual prices. They do not count as manually confirmed observations or enter store-savings calculations.
- The observations are sorted by relevance: same postal code, same postal-code prefix, other branches in the same province, other Canadian locations. Every result includes its store, source, observed date and product details when available.
- In Shop mode, tap **Compare store prices**, then **Check Canadian online prices** to request a GroceryPulse comparison. GroceryPulse covers 16 specified Canadian cities and 50 reference products; for unsupported postal codes such as Peterborough, GrabList **explicitly selects a reference city** (e.g. Toronto), which is labelled as nonlocal. Chain medians never count as confirmed prices at your own branch.
- Price searches require a deliberate tap. API requests go through `worker.js` using hardcoded provider hosts, so the browser does not need third-party CORS access or any API keys.
- Public observations and dated averages are **estimates for planning**, not price guarantees. Only confirmed same-product matches may populate an approximate list price. Exact branch selection, tax/promotion eligibility and authoritative national shelf-price feeds are not available yet.

**Not yet implemented:** retailer-authorized direct live inventory/regular-price feeds, local branch selection/geocoding, barcodes scanned with the camera, automatic synchronization, or automatic substitution. No coverage, matching or price is invented to fill an API gap. A manual quote is **not** a live verified store price.

## Supported retailers

Walmart, No Frills, FreshCo, Your Independent Grocer, Costco, Giant Tiger.

The app does not imply coverage at every retailer; enabled stores are *shopping preferences*, not a claim of connected pricing.

## Price integration design

See [providers/CONTRACT.md](providers/CONTRACT.md). The price comparison engine is a standalone, provider-neutral module, [comparison.js](comparison.js), and geographic matching is in [location.js](location.js). Public lookup routes are implemented in [worker.js](worker.js). Providers will need to attach source, product identity, exact size, observed date, store/region scope and eligibility restrictions. Missing matches remain unknown.

Possible sources are under evaluation. Open Prices is open community data but may have sparse Canadian coverage. Other APIs can have account and licensing constraints. **Never put provider API keys in client-side code or GitHub.**

## Tests

```bash
node --test tests/*.test.cjs
```

Tests exercise the comparison and location-matching engines without external calls. This does not replace real-device iPhone gesture tests.

## Deployment

- Cloudflare **Workers Builds**, linked to `main` of `rkrismcneely/GrabList`
- `worker.js` handles bounded public price inquiries; static files are served using Cloudflare's `ASSETS` binding.
- Deploy command: `npx wrangler deploy`
- Asset-only Worker configuration: [wrangler.jsonc](wrangler.jsonc)
- Production URL: https://grablist.rkrismcneely.workers.dev
- No manual build command or npm dependencies required

This repository and deployment are independent of Tales Without End.

## Privacy, offline access and backups

The list, quote history and preferences are kept in browser localStorage. The service worker caches the app shell to enable offline use after an initial successful load. There is no account synchronization. Clearing Safari website data can erase the list, so export a backup regularly.