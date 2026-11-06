# GrabList grocery pricing provider contract

## State of integration — Phase 2A

**No live retailer-price service is connected.** The browser currently collects user-entered quotes per item and store and feeds them into `comparison.js`. Stored sample prices are fictional and excluded from comparisons.

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
