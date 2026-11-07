const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('worker.js','utf8');
test('no legacy price-provider script executes in browser',()=>{
  assert.doesNotMatch(html,/<script[^>]+src=["']\.\/pricing-ui\.js/);
  assert.doesNotMatch(html,/<script[^>]+src=["']\.\/delivery-settings\.js/);
  assert.match(html,/<script[^>]+src=["']\.\/catalogue-comparison\.js/);
  assert.doesNotMatch(html,/globalThis\.GrabListAutoPrices\?\.\(/);
});
test('all /api/pricing/ endpoints are disabled before legacy handlers',()=>{
  assert.match(worker,/if\(pathname\.startsWith\('\/api\/catalogue\/'\)\)return handleCatalogueApi\(request,env\)/);
  assert.match(worker,/if\(pathname\.startsWith\('\/api\/pricing\/'\)\)return responseError\([^\n]+410/);
  assert.doesNotMatch(worker,/if\(pathname==='\/api\/pricing\/open-prices'\)return/);
});
test('active comparison ignores legacy manual quotes and uses only catalogue records',()=>{
  assert.match(html,/GrabListCatalogueComparison\.evaluate\(/);
  assert.match(html,/function verifiedCataloguePrice\(item\)/);
  assert.doesNotMatch(html,/GrabListComparison\.evaluate\(/);
  assert.match(html,/Manual quote save capture is intentionally not registered/);
});
