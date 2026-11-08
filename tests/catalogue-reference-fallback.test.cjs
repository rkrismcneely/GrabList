const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const compare=require('../catalogue-comparison.js');

const directory={
 stores:[
  {store_id:'peter-1',banner:'No Frills',province:'ON',city:'Peterborough',
   observations_30d:250,observations_computed_at:'2026-11-07T10:00:00Z'},
  {store_id:'toronto-1',banner:'Walmart',province:'ON',city:'Toronto',
   observations_30d:250,observations_computed_at:'2026-11-07T10:00:00Z'},
  {store_id:'old',banner:'FreshCo',province:'ON',city:'Peterborough',
   observations_30d:100,observations_computed_at:'2026-01-01T10:00:00Z'},
  {store_id:'other-province',banner:'No Frills',province:'BC',city:'Vancouver',
   observations_30d:250,observations_computed_at:'2026-11-07T10:00:00Z'}
 ]
};
function fakeBudgetDb(){
 const counters=new Map();
 return {counters,prepare(sql){
  const run=async(...args)=>{
   if(sql.startsWith('CREATE TABLE'))return {meta:{changes:0}};
   if(sql.startsWith('INSERT OR IGNORE')){
     const key=args[0];if(!counters.has(key))counters.set(key,0);
     return {meta:{changes:1}};
   }
   if(sql.startsWith('UPDATE catalogue_provider_budget')){
     const [key,max]=args;
     const value=counters.get(key)||0;
     if(value>=max)return {meta:{changes:0}};
     counters.set(key,value+1);
     return {meta:{changes:1}};
   }
   throw Error('Unexpected query: '+sql);
  };
  return {run:()=>run(),bind:(...args)=>({run:()=>run(...args)})};
 }};
}
test('store directory distinguishes real Peterborough coverage from generic Ontario stores',async()=>{
 const {parseOntarioStoreCoverage}=await import('../catalogue-price-fallback.mjs');
 const result=parseOntarioStoreCoverage(directory,Date.parse('2026-11-08T14:00:00Z'));
 assert.equal(result.totalOntarioStores,3);
 assert.equal(result.peterboroughStores.length,2);
 assert.deepEqual(result.peterboroughWithObservations.map(x=>x.storeId),['peter-1']);
});
test('Vynn offers require recent CAD Ontario product prices, preserve distinct geography',async()=>{
 const {parseOntarioStoreCoverage,parseVynnProductOffers}=await import('../catalogue-price-fallback.mjs');
 const now=Date.parse('2026-11-08T14:00:00Z');
 const coverage=parseOntarioStoreCoverage(directory,now);
 const item={name:'Milk',size:'4 L'};
 const data={data:{products:[
  {canonical_product:{display_name:'Neilson 2% Milk 4 L',size:'4 L',brand:'Neilson'},
   offers:[
    {banner:'No Frills',store_id:'peter-1',province:'ON',current_price:6.49,
      observed_at:'2026-11-07T14:00:00Z',currency:'CAD'},
    {banner:'Walmart',store_id:'toronto-1',province:'ON',current_price:5.99,
      observed_at:'2026-11-07T14:00:00Z',currency:'CAD'},
    {banner:'Walmart',store_id:'toronto-1',province:'ON',current_price:0.99,
      observed_at:'2026-09-01T14:00:00Z',currency:'CAD'},
    {banner:'No Frills',store_id:'other-province',province:'BC',current_price:2,
      observed_at:'2026-11-07T14:00:00Z',currency:'CAD'}
   ]},
  {canonical_product:{display_name:'Specialty 6% Milk 4 L',size:'4 L'},
   offers:[{banner:'No Frills',store_id:'peter-1',province:'ON',current_price:2.49,
     observed_at:'2026-11-07T14:00:00Z',currency:'CAD'}]}
 ]}};
 const offers=parseVynnProductOffers(data,item,['nofrills','walmart'],coverage,now);
 assert.equal(offers.length,3);
 assert.equal(offers[0].scope,'city_reference');
 assert.equal(offers[1].scope,'province_reference');
 assert.ok(offers.every(o=>o.status==='current'&&o.source==='VynnAI reference'));
 const compatible=offers.filter(o=>compare.productMatch(item,o));
 assert.equal(compatible.length,2,'specialty 6% milk cannot become a cheap 4 L substitute');
 assert.equal(compatible.find(o=>o.retailer==='walmart').referenceCity,'');
});
test('free API budget reserves no more than daily and monthly caps even on repeated requests',async()=>{
 const {reserveVynnCall,VYNN_DAILY_CAP}=await import('../catalogue-price-fallback.mjs');
 const db=fakeBudgetDb();
 const day=new Date('2026-11-08T12:00:00Z');
 for(let i=0;i<VYNN_DAILY_CAP;i++)assert.equal(await reserveVynnCall(db,day),true);
 assert.equal(await reserveVynnCall(db,day),false);
 assert.equal(db.counters.get('vynn-day-2026-11-08'),VYNN_DAILY_CAP);
 assert.equal(db.counters.get('vynn-month-2026-11'),VYNN_DAILY_CAP);
 assert.equal(await reserveVynnCall(db,new Date('2026-11-09T12:00:00Z')),true);
});
test('without private provider secret fallback does no network calls and returns no offers',async()=>{
 const {vynnFallback}=await import('../catalogue-price-fallback.mjs');
 const old=globalThis.fetch;
 globalThis.fetch=()=>{throw Error('No network expected')};
 try{
   const response=await vynnFallback(fakeBudgetDb(),{},
    new Request('https://grablist.test/api/catalogue/reference-prices',{
      method:'POST',body:JSON.stringify({items:[{id:'milk',name:'Milk',size:'4 L'}],stores:['nofrills']})
    }));
   const result=await response.json();
   assert.equal(result.configured,false);
   assert.deepEqual(result.results,[]);
   assert.match(response.headers.get('cache-control'),/no-store/);
 }finally{globalThis.fetch=old;}
});
test('configured fallback does not expose key, only returns dated source-tagged reference prices',async()=>{
 const {vynnFallback}=await import('../catalogue-price-fallback.mjs');
 const old=globalThis.fetch;
 const urls=[];
 globalThis.fetch=async (url,opts)=>{
   urls.push(String(url));
   assert.equal(opts.headers.Authorization,'Bearer private_sample_key_123456789');
   if(String(url).includes('/v1/stores'))return new Response(JSON.stringify(directory));
   if(String(url).includes('/v1/products/search'))return new Response(JSON.stringify({
    data:{products:[{canonical_product:{display_name:'Neilson 2% Milk 4 L',size:'4 L'},
      offers:[{banner:'No Frills',province:'ON',store_id:'peter-1',current_price:6.49,
       observed_at:'2026-11-07T12:00:00Z'}]}]}
   }));
   throw Error('Unexpected URL');
 };
 try{
   const response=await vynnFallback(fakeBudgetDb(),{VYNN_API_KEY:'private_sample_key_123456789'},
     new Request('https://grablist.test/api/catalogue/reference-prices',{
      method:'POST',body:JSON.stringify({items:[{id:'milk',name:'Milk',size:'4 L'}],stores:['nofrills']})
     }));
   const result=await response.json();
   assert.equal(result.configured,true);
   assert.equal(result.coverage.hasPeterboroughCoverage,true);
   assert.equal(result.results[0].offers[0].scope,'city_reference');
   assert.equal(result.results[0].offers[0].priceCents,649);
   assert.equal(urls.length,2);
   assert.ok(!JSON.stringify(result).includes('private_sample_key_123456789'));
   assert.match(response.headers.get('cache-control'),/no-store/);
 }finally{globalThis.fetch=old;}
});
test('Compare and Edit can add reference quotes only after exact product matching',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/referencePriceFallbackConfigured=Boolean\(status\.referencePriceFallbackConfigured\)/);
 assert.match(html,/async function fallbackReferencePrices\(/);
 assert.match(html,/await fallbackReferencePrices\(null,\$\('auto-price-status'\)\)/);
 assert.match(html,/await fallbackReferencePrices\(\[saved\.item\.id\]/);
 assert.match(html,/GrabListCatalogueComparison\.productMatch\(item,offer\)/);
 assert.match(html,/Ontario reference/);
 assert.match(html,/Peterborough reference/);
 assert.match(html,/!referencePriceFallbackConfigured/);
 assert.match(html,/['"]province_reference['"]/);
});
