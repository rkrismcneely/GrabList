# GrabList grocery pricing provider contract

## State of integration — Phase 2A

**No direct retailer-price service is connected.** The browser currently collects user-entered quotes per item and store and feeds them into `comparison.js`. Public source searches are available for review but do not automatically become checkout prices or savings offers. Stored sample prices are fictional and excluded from comparisons.

Do **not** describe the manually recorded prices as verified, current, shelf, or checkout prices.

## Normalized offer

Every future provider adapter must return structured offers, not an unqualified number:

```json
{
  "storeId": "walmart",
  "storeScope": { "kind": "reference", "province": "ON", "branchId": null },
  "product": {
    "name": "Milk",
    "type": "milk",
    "brand": "Natrel",
    "barcode": null,
    "pack": { "amount": 4, "unit": "L" }
  },
  "price": { "amountCAD": 6.25, "unitAmountCAD": 1.5625, "unit": "L" },
  "source": {
    "kind": "provider",
    "providerId": "example-provider",
    "url": "https://example.invalid/placeholder",
    "observedAt": "2026-11-06T00:00:00Z"
  },
  "availability": "unknown",
  "promotion": {
    "requiresMembership": false,
    "requiresCoupon": false,
    "minimumQuantity": 1,
    "expiresAt": null
  }
}
```

This JSON is a **schema example**, not a real price or an actual connected provider. Never display it as a market observation. URLs and branches must come from real source records.

## Matching rules

1. Match product type before brand. Respect brand requirements explicitly entered by the user.
2. Respect package size and unit price. Do not compare 1 L with 2 L at face value; distinguish per-unit versus required purchase cost and minimum pack sizes.
3. Distinguish ordinary, sale, and members-only prices; do not recommend ineligible promotions.
4. Carry source URL, quote freshness, location scope, tax/deposit applicability and availability, including `unknown`.
5. Represent unmatched items as **unknown price**, not zero. No fake offers, fabricated timestamps, or implied verified branch prices.
6. Price optimization may reassign purchased quantities across existing shopping stops; recommend additional stores only if aggregate incremental savings reach the user threshold.
7. Never override a deliberate store choice except after the user reviews and applies a proposed change.
8. Use conservative provider freshness windows and persist provenance. Avoid resubmitting unnecessary requests and respect rate limits.

## Manual quote format — implemented

`item.offers[]` currently contains:

```json
{
  "storeId": "nofrills",
  "price": 4.49,
  "source": "manual",
  "observedAt": 1793977200000,
  "size": "1 L",
  "brand": ""
}
```

All prices are per requested package. Values should be interpreted as CAD. Saving another store's manual quote does not automatically change the item's assigned store. Manual quotes older than 30 days, quotes with a mismatched size or required brand, and examples are excluded from recommendations.

## Geographic precision and fallback policy

A Canadian postal code is stored locally in GrabList Settings (validated and formatted; never guessed from GPS). The first three characters form the **FSA**, a coarse postal geography. The first letter can identify a province for most Canadian postal codes, but **X** spans Nunavut and Northwest Territories and does not prove either province or territory.

The location engine (`location.js`) ranks **applicable** offers by:

1. Preferred or nearest confirmed **store branch** with a matching branch identifier.
2. Exact six-character postal-code coverage.
3. Matching postal-code FSA.
4. Verified matching city.
5. Verified matching region.
6. Matching province or territory.
7. Explicitly national price.
8. Manually recorded quote without verified location metadata (labelled **location unverified**).

A scoped offer for a different city, region, province or branch **must not** be treated as a match. Within the same scope, prefer the most recently observed eligible quote. Quotes outside the existing freshness cutoff remain ineligible.

**Closest branch is not yet determined in the UI.** That requires an authorized store directory with accurate branch coordinates and a permitted postal-code geocoder or explicit device location. A postal code alone is not enough to assert that a particular branch is the closest. The engine includes a deterministic nearest-branch helper for later integration with confirmed coordinates.

Prices for one locale cannot necessarily be assumed valid throughout a province. Show exact coverage and source date next to any future automatically retrieved quote, including promotions' eligibility and effective date. A national reference price must remain labelled national/indicative, never guaranteed in-store.

Flipp offers relevant geographic distribution via retailer partnerships, flyers, online and local-store catalogues. Its FlyerKit APIs are documented primarily for retailer/publisher integrations and require appropriate authorization. Do not imply unrestricted public API access or scrape protected resources without permission.

## Connected public sources — Phase 2B

**Open Prices / Open Food Facts:** on-demand search for an item using its optional barcode or name. GrabList filters to recent (last 31 days) CAD observations physically recorded in Canada, includes precise store address, date, product name/size, quantity unit and source link, and ranks based on the saved postal code. No API key required for public reads. The data is licensed under the ODbL; attribute the contributors and preserve provenance. An individual store observation is **not** a province-wide or national price and is not silently entered into an optimizer as if it were a quote from the user's preferred store. The API may return no relevant Canadian observations.

**GroceryPulse public shopper plan:** a user-initiated POST with a maximum 60 lines. The first **three characters** of the shopper's postal code are tried first. Its 16 supported cities and 50 standard reference items remain hard coverage limits. When a postal area is unsupported, GrabList makes an **explicit** second request for a named same-province city when one is configured; a Toronto Canadian benchmark is the last fallback. This does not claim the comparison is local or from the nearest branch. Returned prices represent dated **city-level chain medians**, not a confirmed individual branch price or inventory. Show unmatched items, date, scope and excluded items. The shopper API is free/read-only but subject to fair-use restrictions; never bulk extract, republish a database, scrape or evade quotas. No API key required.

**Statistics Canada Table 18-10-0245-01:** a dated static snapshot of selected official national average food prices (September 2026), stored in the Worker as reference estimates. It is published government statistics, not a live store offer. Both the single-item and bulk routes return package-size match status; a conflicting size is shown for comparison, but not automatically attached as a price. National averages populate missing prices when opening Shop, labelled with **≈** and source/date in Edit. They never become recent manually verified retailer offers.

Cloudflare Worker gateway paths:

- `GET /api/pricing/status`
- `GET /api/pricing/open-prices?barcode=...` or `?name=...` (Canadian observations, up to two years old; historical)
- `POST /api/pricing/grocerypulse-plan` (covered city or labelled province/Canada reference city)
- `GET /api/pricing/national-reference?name=...&size=...`
- `POST /api/pricing/national-reference-list` (up to 75 items; local Worker lookups)

These are fixed-destination, validated gateways rather than arbitrary open proxies. User lists and FSA requests are not retained by GrabList's Worker. The service worker explicitly excludes API paths from its offline cache. No request is sent to a price provider until a person taps a search button. In-app notes explain unverified/reference prices and source coverage.

## Provider selection notes

- **Open Prices / Open Food Facts:** open community price records with documented location and date, but not guaranteed product/retailer coverage in a given Ontario city. Its Open Database License has attribution and share-alike conditions that must be assessed before integrating. See https://prices.openfoodfacts.org/api/docs and https://openfoodfacts.github.io/open-prices/guides/data/.
- **VynnAI:** currently advertises a free API trial/limited plan, but licensing, reference-store coverage, and request quota must be reviewed before using it for a public shopping app. It reports that Costco is not covered. See https://vynn.ai/developers/docs and https://vynn.ai/methodology.
- **Retailer websites or partner APIs:** do not assume publicly displayed products grant permission for automated reuse or that seller marketplace credentials are suitable for consumer comparisons.

Any API secret belongs in a Cloudflare Worker server-side secret, never in `index.html`, `comparison.js`, the browser's localStorage or a committed repository file. If a free provider cannot legally or reliably support the required use, leave that retailer without live prices until another source is available.

## Future milestones

- Provider adapter validation and data-source consent/licensing
- Store location selection and price-region precision
- Barcode and normalized product catalog lookup
- Verified price freshness, promotion eligibility, audit trail
- Basket optimization with pack-size arithmetic and additional-stop threshold
- Caching, quota telemetry and fallback when a provider fails
