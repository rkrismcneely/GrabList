# Pricing provider contract (future integration)

Live prices are **not** connected. All manual or sample prices must be labelled accordingly.

Each offer should carry retailer, branch or reference-store scope, product name, brand, size and unit, current price, unit price, observed timestamp, availability, membership and promotion restrictions, and source URL. The matching engine should prioritize product type and preferred size over brand unless a brand is explicitly specified. Price optimization should add stores only when expected savings exceed the user's configured threshold.

Initial retailers: Walmart, No Frills, FreshCo, Your Independent Grocer, Costco, Giant Tiger. Do not imply branch-specific accuracy for reference-store or online catalog data.