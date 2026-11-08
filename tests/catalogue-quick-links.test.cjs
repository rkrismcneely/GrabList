const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const matcher=require('../catalogue-comparison.js');
const bread=['bread-white-675g','freshco|online|indexed-abc','freshco',
  'Compliments Sandwich Bread White 675 g','Compliments','675 g',
  'https://www.freshco.com/products/compliments-sandwich-bread-white-675-g'];
const milk=['milk-2pct-4l','nofrills|online|hammer-abc','nofrills',
  '2% Milk 4 L','', '4 L','https://www.nofrills.ca/en/2-milk/p/12345678_EA'];
const eggs=['eggs-large-12','freshco|online|indexed-eggs','freshco',
  'Large Eggs 12 Pack','','12 ct','https://www.freshco.com/products/large-eggs'];
const marsh=['candidate-marsh','freshco|online|indexed-marsh','freshco',
  'Regular Marshmallows 400 g','','400 g','https://www.freshco.com/products/regular-marshmallows'];
test('bundle-only URL index finds all four user groceries without a database import',async()=>{
 const {loadQuickLinks,quickLinkMatches}=await import('../catalogue-link-index.mjs');
 let calls=0;
 const assets={fetch:async request=>{
  calls++;
  assert.match(new URL(request.url).pathname,/^\/data\/quick-links\/\d{2}\.json$/);
  return new Response(JSON.stringify({version:'2026-11-08',scope:'online_unverified',
    records:[bread,milk,eggs,marsh]}),{status:200});
 }};
 const index=await loadQuickLinks(assets,'https://grablist.example');
 assert.equal(calls,8);
 for(const [item,store] of [
  [{name:'Bread',size:'1 loaf'},'freshco'],
  [{name:'Milk',size:'4 L'},'nofrills'],
  [{name:'Eggs'},'freshco'],
  [{name:'Marshmallows'},'freshco']
 ]){
  const found=quickLinkMatches(index,item,[store]);
  assert.ok(found.length,JSON.stringify(item)+' should find a published link');
  assert.equal(found[0].scope,'online_unverified');
  assert.equal(matcher.productMatch(item,found[0]),true);
 }
 assert.equal(matcher.productMatch({name:'Bread',size:'1 loaf'},
   {productName:'Bread Flour',size:'2 kg'}),false);
 assert.equal(matcher.productMatch({name:'Eggs'},
   {productName:'Egg Bread',size:'600 g'}),false);
 assert.equal(matcher.productMatch({name:'Milk',size:'4 L'},
   {productName:'Milk 2 L',size:'2 L'}),false);
});
test('read-only quote accepts indexed link keys without database writes or owner key',async()=>{
 const {loadQuickLinks}=await import('../catalogue-link-index.mjs');
 // Index is warmed by previous test, but this call documents the assets contract.
 const assets={fetch:async()=>{throw Error('Index was already loaded');}};
 await loadQuickLinks(assets,'https://grablist.example');
 const {quoteSavedUrls}=await import('../catalogue-api.mjs');
 const old=globalThis.fetch;
 let retailerRequests=0;
 globalThis.fetch=async (url)=>{
  retailerRequests++;
  assert.equal(url,'https://www.nofrills.ca/en/2-milk/p/12345678_EA');
  return new Response('<h1>2% Milk 4 L</h1><p>$6.49 ea</p>',
    {status:200,headers:{'Content-Type':'text/html'}});
 };
 let selects=0;
 const db={prepare:sql=>({
  bind:key=>({
   first:async()=>{selects++;assert.match(sql,/SELECT \*/);return null;}
  })
 })};
 try{
  const req=new Request('https://grablist.example/api/catalogue/quote',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({keys:[milk[1]]})
  });
  const res=await quoteSavedUrls(db,req,assets);
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.results[0].status,'priced');
  assert.equal(data.results[0].priceCents,649);
  assert.equal(data.results[0].scope,'online_unverified');
  assert.equal(retailerRequests,1);
  assert.equal(selects,1);
 }finally{globalThis.fetch=old;}
});
test('shop displays online price estimates but does not promote them to local quotes',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/function onlineCataloguePrice\(item\)/);
 assert.match(html,/online estimates · not local prices/);
 assert.match(html,/void quoteCataloguePrices\(\)/);
 const show=html.slice(html.indexOf('async function showPriceComparison()'),html.indexOf("\$('list-footer').addEventListener",html.indexOf('async function showPriceComparison()')));
 assert.doesNotMatch(show,/void refreshCataloguePrices\(\)/);
});
