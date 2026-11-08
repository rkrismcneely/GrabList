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
 assert.match(html,/void refreshAllCataloguePrices\(\)/);
 const show=html.slice(html.indexOf('async function showPriceComparison()'),html.indexOf("\$('list-footer').addEventListener",html.indexOf('async function showPriceComparison()')));
 assert.doesNotMatch(show,/void refreshCataloguePrices\(\)/);
});


test('bundled FreshCo data excludes specialty milk and finds standard grocery equivalents',()=>{
 const fs=require('node:fs');
 const rows=Array.from({length:8},(_,i)=>
   JSON.parse(fs.readFileSync('data/quick-links/'+String(i).padStart(2,'0')+'.json','utf8')).records)
   .flat().filter(row=>row[2]==='freshco');
 const matching=(item)=>rows.filter(row=>matcher.productMatch(item,{
   productName:row[3],brand:row[4],size:row[5]
 }));
 const milk=matching({name:'Milk',size:'4 L'});
 assert.ok(milk.some(row=>/\b[12]\s*%\s*milk/i.test(row[3])),JSON.stringify(milk));
 assert.ok(milk.every(row=>!/(?:^|\s)6\s*%/i.test(row[3])));
 assert.ok(!milk.some(row=>/\b(?:protein|a2|microfiltered|lactose)\b/i.test(row[3])));
 const eggs=matching({name:'Eggs'});
 assert.ok(eggs.some(row=>/\blarge\b/i.test(row[3])));
 assert.ok(eggs.every(row=>!/\b(?:jumbo|extra.large)\b/i.test(row[3])));
 const bread=matching({name:'Bread',size:'1 loaf'});
 assert.ok(bread.some(row=>/\bsandwich\b/i.test(row[3])));
});


test('main Compare button updates list directly; Edit can refresh, switch store and pin exact product',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const handler=html.slice(html.indexOf('function showPriceComparison(){'),
  html.indexOf("\$('list-footer').addEventListener",html.indexOf('function showPriceComparison(){')));
 assert.match(handler,/void refreshAllCataloguePrices\(\)/);
 assert.doesNotMatch(handler,/openSheet\(/);
 assert.match(html,/id="edit-refresh-price"/);
 assert.match(html,/id="edit-price-options"/);
 assert.match(html,/data-select-product/);
 assert.match(html,/data-edit-switch-store/);
 assert.match(html,/preferredListingByStore/);
 assert.match(html,/keepQuote\(offer\)/);
 assert.match(html,/restoreQuote/);
 assert.match(html,/loadCatalogueComparison\(\[saved\.item\.id\]\)/);
 assert.match(html,/priceRefreshBusy\?'disabled'/);
});
test('refreshing a changed item updates its selected store without saving unwanted stale quote',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const start=html.indexOf('async function quoteCataloguePrices(');
 const stop=html.indexOf('async function refreshAllCataloguePrices()',start);
 const block=html.slice(start,stop);
 assert.match(block,/offer.status='unavailable'/);
 assert.match(block,/offer.priceCents=null/);
 assert.match(block,/delete priceCache\[result.key\]/);
 assert.match(block,/refresh:Boolean\(options.refresh&&itemIds\)/);
 assert.match(html,/item.preferredListingByStore\[store\]=key/);
});


test('No Frills product URL from user retains SKU but drops cart and search tracking',async()=>{
 const {canonicalNofrillsUrl,withNofrillsStore,nofrillsSku}=await import('../catalogue-nofrills.mjs');
 const raw='https://www.nofrills.ca/en/1-milk/p/20047439_EA?source=nspt&search-bar=1%25+Milk&storeId=3142&cartId=redacted';
 const clean='https://www.nofrills.ca/en/1-milk/p/20047439_EA';
 assert.equal(canonicalNofrillsUrl(raw),clean);
 assert.equal(nofrillsSku(raw),'20047439_EA');
 assert.equal(withNofrillsStore(raw,'3142'),clean+'?storeId=3142');
 assert.equal(withNofrillsStore(raw,'3634'),clean+'?storeId=3634');
 assert.equal(withNofrillsStore(raw,''),clean);
 assert.equal(withNofrillsStore(raw,'3142&cartId=bad'),null);
 assert.equal(canonicalNofrillsUrl('https://nofrills.ca.evil.example/en/1-milk/p/20047439_EA'),null);
 assert.equal(canonicalNofrillsUrl('https://www.nofrills.ca/en/search?search-bar=milk'),null);
 assert.equal(canonicalNofrillsUrl('https://www.nofrills.ca/en/soda/p/21653480_C12'),
   'https://www.nofrills.ca/en/soda/p/21653480_C12');
 assert.equal(canonicalNofrillsUrl('https://www.nofrills.ca/cocoa-pebbles-cereal/p/21576432_EA'),
   'https://www.nofrills.ca/en/cocoa-pebbles-cereal/p/21576432_EA');
});
test('all published No Frills product links can be read canonically without changing their SKUs',async()=>{
 const {canonicalNofrillsUrl,nofrillsSku}=await import('../catalogue-nofrills.mjs');
 const records=Array.from({length:8},(_,i)=>
  JSON.parse(fs.readFileSync('data/quick-links/'+String(i).padStart(2,'0')+'.json','utf8')).records)
   .flat().filter(r=>r[2]==='nofrills');
 assert.ok(records.length>1000);
 let corrected=0,casePacks=0;
 for(const r of records){
   const canon=canonicalNofrillsUrl(r[6]);
   assert.ok(canon,'Unsupported No Frills product link: '+r[6]);
   if(canon!==r[6])corrected++;
   if(/_C\d{2}$/.test(nofrillsSku(r[6])))casePacks++;
   assert.equal(nofrillsSku(canon),nofrillsSku(r[6]));
 }
 assert.ok(corrected>=10,'Legacy paths should be normalized at read time');
 assert.ok(casePacks>=10,'Case pack suffixes must remain distinct');
 const exact=records.find(r=>r[6].endsWith('/p/20047439_EA'));
 assert.ok(exact,'Known real 1% 4L milk product should already be indexed');
});
test('No Frills price quote requests carry store context and use separate edge caches',async()=>{
 const {quoteSavedUrls}=await import('../catalogue-api.mjs');
 const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;
 let hits=[],cached=new Map();
 globalThis.caches={default:{
   match:async req=>cached.get(req.url)?.clone(),
   put:async(req,res)=>{cached.set(req.url,res.clone());}
 }};
 globalThis.fetch=async url=>{
   hits.push(String(url));
   return new Response('<script type="application/ld+json">'+
     JSON.stringify({'@type':'Product',name:'1% Milk',offers:{price:'6.44',priceCurrency:'CAD'}})+
     '</script>',{headers:{'content-type':'text/html'}});
 };
 const db={prepare:()=>({bind:()=>({first:async()=>({
   product_url:'https://www.nofrills.ca/en/1-milk/p/20047439_EA',
   product_name:'1% Milk',price_scope:'online_unverified'
 })})})};
 const req=store=>new Request('https://grablist.example/api/catalogue/quote',{
   method:'POST',body:JSON.stringify({keys:['nofrills|online|milk-1pct'],nofrillsStoreId:store})
 });
 try{
   const one=(await (await quoteSavedUrls(db,req('3142'))).json()).results[0];
   const two=(await (await quoteSavedUrls(db,req('3634'))).json()).results[0];
   const again=(await (await quoteSavedUrls(db,req('3142'))).json()).results[0];
   assert.equal(one.priceCents,644);
   assert.equal(one.storeContext,'3142');
   assert.equal(two.storeContext,'3634');
   assert.equal(one.scope,'online_unverified');
   assert.equal(hits.length,2,'each branch needs a separate cache lookup');
   assert.ok(hits[0].endsWith('?storeId=3142'));
   assert.ok(hits[1].endsWith('?storeId=3634'));
   assert.equal(again.cached,true);
   assert.ok(!hits.join('').includes('cartId'));
 }finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;}
});
test('settings and Edit links use correct No Frills branch without promoting online price',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="nofrills-branch"/);
 assert.match(html,/3142">George Street/);
 assert.match(html,/3634">Lansdowne Street/);
 assert.match(html,/function nofrillsBrowserLink\(/);
 assert.match(html,/function productPageHref\(/);
 assert.match(html,/nofrillsStoreId:state\.catalogueBranches\?\.nofrills/);
 assert.match(html,/storeContext:offer\.storeContext/);
 assert.match(html,/o\.storeContext\|\|''/);
});

test('Shop pricing still has no modal and preserves user local store preferences',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/function showPriceComparison\(\)\{\s*\/\/ The main action never opens a sheet/);
 assert.match(html,/walmartPreferredLocation:'lansdowne'/);
 assert.match(html,/compareAlternateNofrills:true/);
 assert.match(html,/id="walmart-preferred-location"/);
 assert.match(html,/id="nofrills-alt-store"/);
 assert.match(html,/choosePriceCandidates\(/);
 assert.match(html,/function cheaperOnlineSuggestion\(/);
 assert.match(html,/Possible cheaper:/);
 assert.match(html,/nofrillsStoreId:alternative/);
 assert.match(html,/allowedNofrillsQuoteContext\(/);
 assert.match(html,/HTTP \(403\|429\)/);
});
