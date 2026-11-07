/* Persistent retailer listing model for GrabList.
 * Pure functions: storage/HTTP adapters can be attached without coupling to a scraper.
 * A failed refresh must never overwrite a confirmed price or its observation time.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrabListCatalogue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_PRICE_CENTS = 10000000;
  function text(value) { return String(value ?? "").trim(); }
  function listingKey(input) {
    const retailer = text(input.retailer).toLowerCase();
    const store = text(input.storeId).toLowerCase();
    const product = text(input.productId).toLowerCase();
    if (!retailer || !store || !product) throw new Error("Retailer, storeId and productId are required");
    return JSON.stringify([retailer, store, product]);
  }
  function validDate(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
  }
  function validPrice(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE_CENTS;
  }
  function normalizeListing(input) {
    if (!input || typeof input !== "object") throw new Error("Listing must be an object");
    const key = listingKey(input);
    const url = text(input.url);
    if (url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("Only HTTPS product URLs are allowed");
    }
    return {
      key, retailer: text(input.retailer), storeId: text(input.storeId),
      productId: text(input.productId), masterProductId: text(input.masterProductId),
      name: text(input.name), brand: text(input.brand), size: text(input.size),
      url, lastPriceCents: null, currency: "CAD", priceSource: null,
      priceObservedAt: null, lastAttemptAt: null, lastError: null,
      saleEndsAt: null
    };
  }
  function applyObservation(previous, observation) {
    if (!previous || !previous.key) throw new Error("Normalized listing required");
    const result = { ...previous };
    const at = validDate(observation?.attemptedAt);
    if (!at) throw new Error("A valid attemptedAt is required");
    result.lastAttemptAt = at;
    if (!validPrice(observation?.priceCents) || !validDate(observation?.observedAt)) {
      result.lastError = text(observation?.error) || "Price unavailable";
      return result;
    }
    const observedAt = observation.observedAt;
    // Out-of-order jobs cannot roll a newer verified price backwards.
    if (result.priceObservedAt && Date.parse(observedAt) < Date.parse(result.priceObservedAt)) {
      result.lastError = "Older observation ignored";
      return result;
    }
    result.lastPriceCents = observation.priceCents;
    result.priceObservedAt = observedAt;
    result.priceSource = text(observation.source) || "retailer";
    result.saleEndsAt = validDate(observation.saleEndsAt);
    result.lastError = null;
    return result;
  }
  function status(listing, now, maxAgeHours = 24) {
    if (!validPrice(listing?.lastPriceCents) || !validDate(listing?.priceObservedAt)) return "unavailable";
    const age = Date.parse(now) - Date.parse(listing.priceObservedAt);
    return age >= 0 && age < maxAgeHours * 3600000 ? "current" : "stale";
  }
  function mergeListings(existing, discovered) {
    const merged = new Map(existing.map(x => [x.key, { ...x }]));
    for (const candidate of discovered) {
      const fresh = normalizeListing(candidate);
      const old = merged.get(fresh.key);
      merged.set(fresh.key, old ? { ...old, ...Object.fromEntries(Object.entries(fresh).filter(([k,v]) =>
        !["lastPriceCents","priceSource","priceObservedAt","lastAttemptAt","lastError","saleEndsAt"].includes(k) && v !== "")) } : fresh);
    }
    return Array.from(merged.values());
  }
  return { listingKey, normalizeListing, applyObservation, status, mergeListings };
});
