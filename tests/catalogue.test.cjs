const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../catalogue.js');
const sample = { retailer:'FreshCo',storeId:'lansdowne-parkway',productId:'coffee-864',name:'Coffee',url:'https://www.freshco.com/products/coffee' };
test('keys separate stores and retailer products', () => {
  assert.notEqual(c.listingKey(sample), c.listingKey({...sample,storeId:'other'}));
  assert.notEqual(c.listingKey(sample), c.listingKey({...sample,retailer:'Walmart'}));
});
test('successful price and failed refresh retain last known price', () => {
  const initial = c.normalizeListing(sample);
  const priced = c.applyObservation(initial,{attemptedAt:'2026-11-07T10:00:00Z',observedAt:'2026-11-07T10:00:00Z',priceCents:1797,source:'product-page'});
  const failed = c.applyObservation(priced,{attemptedAt:'2026-11-08T10:00:00Z',error:'timeout'});
  assert.equal(failed.lastPriceCents,1797);
  assert.equal(failed.priceObservedAt,'2026-11-07T10:00:00Z');
  assert.equal(failed.lastError,'timeout');
  assert.equal(c.status(failed,'2026-11-08T10:00:00Z'),'stale');
});
test('zero price is valid, missing price is not', () => {
  const initial=c.normalizeListing(sample);
  assert.equal(c.applyObservation(initial,{attemptedAt:'2026-11-07T10:00:00Z',observedAt:'2026-11-07T10:00:00Z',priceCents:0}).lastPriceCents,0);
  assert.equal(c.applyObservation(initial,{attemptedAt:'2026-11-07T10:00:00Z',priceCents:NaN}).lastPriceCents,null);
});
test('older scraper response cannot replace newer price', () => {
  const priced=c.applyObservation(c.normalizeListing(sample),{attemptedAt:'2026-11-08T10:00:00Z',observedAt:'2026-11-08T10:00:00Z',priceCents:1797});
  assert.equal(c.applyObservation(priced,{attemptedAt:'2026-11-08T10:01:00Z',observedAt:'2026-11-07T10:00:00Z',priceCents:999}).lastPriceCents,1797);
});
test('rediscovery updates URL without wiping historical price', () => {
  const priced=c.applyObservation(c.normalizeListing(sample),{attemptedAt:'2026-11-07T10:00:00Z',observedAt:'2026-11-07T10:00:00Z',priceCents:1797});
  const [merged]=c.mergeListings([priced],[{...sample,url:'https://www.freshco.com/products/new-coffee'}]);
  assert.equal(merged.lastPriceCents,1797);
  assert.equal(merged.url,'https://www.freshco.com/products/new-coffee');
});
test('reject unsafe product URLs',()=>assert.throws(()=>c.normalizeListing({...sample,url:'javascript:alert(1)'})));
