# Scraper evaluation for GrabList

This is a research inventory, **not** a claim that a provider is connected or verified.
Never treat a URL or flyer price as a verified local shelf price.

| Project | Repository | Candidate use | Validation required |
| --- | --- | --- | --- |
| Grocery Price Tracker | https://github.com/JP011098/grocery-price-tracker | FreshCo, Walmart, Loblaw product-page extraction and price history | Inspect license, selectors, branch/session handling and Cloudflare compatibility |
| Flipp Scraper | https://github.com/Kiizon/flippscrape | Weekly flyer discovery, offer dates, postal code | Inspect license, data terms, coverage and current endpoint behavior |
| Walmart Canada Scrapy | https://github.com/juansimon27/scrapy-walmart | Product/category discovery | Inspect license and store-specific pricing |
| Grocery App | https://github.com/snacsnoc/grocery-app | Canadian retailer search patterns | GPL-3.0: review compatibility before copying code |

## Proposed ingestion sequence

1. Import permitted flyer listings for configured stores, retaining offer start/end dates and source.
2. Normalize exact UPC/GTIN, product type, brand, package quantity and unit. Keep distinct variants distinct.
3. For each discovered product, search every enabled retailer, not only the flyer retailer.
4. Save retailer/store/product identity, canonical HTTPS URL, last verified price and timestamps.
5. On user refresh, query existing URLs first; discover missing links; apply results via catalogue.js.
6. On errors, retain last successful price and show it as stale; never silently substitute another city's price.
7. Record the exact store or session used. A generic page with no branch price is not a verified price.
8. Rate-limit and cache requests; do not bypass access controls or assume a scraper remains functional.

The catalogue.js module is a pure data-model foundation. It does not scrape sites,
schedule refreshes, create a D1 database or connect the existing Compare button.
Those steps require separately tested adapters and persistence migrations.
