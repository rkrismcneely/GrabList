const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const url=require('node:url');
const moduleText=fs.readFileSync(path.join(__dirname,'../worker.js'),'utf8');
let workerPromise;
const worker=()=>workerPromise||(workerPromise=import('data:text/javascript;base64,'+Buffer.from(moduleText).toString('base64')).then(m=>m.default));
const originalFetch=global.fetch;
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test.afterEach(()=>{global.fetch=originalFetch;});
test('returns source status without calling upstream',async()=>{
 global.fetch=()=>{throw Error('No upstream should be requested')};
 const api=await worker(),r=await api.fetch(new Request('https://grablist.example/api/pricing/status'),{});
 assert.equal(r.status,200);
 const data=await r.json();
 assert.deepEqual(data.sources,['open-prices-barcode','grocerypulse-covered-cities']);
});
test('blocks arbitrary unsupported paths or invalid product searches',async()=>{
 const api=await worker();
 assert.equal((await api.fetch(new Request('https://grablist.example/api/other'),{})).status,404);
 assert.equal((await api.fetch(new Request('https://grablist.example/api/pricing/open-prices?barcode=abc'),{})).status,400);
});
test('accepts only fresh Canadian CAD observations for a specific barcode',async()=>{
 global.fetch=async(request)=>{
  const addr=new URL(request);
  assert.equal(addr.hostname,'prices.openfoodfacts.org');
  assert.equal(addr.searchParams.get('product_code'),'12345678');
  assert.equal(addr.searchParams.get('currency'),'CAD');
  return response({items:[
   {id:42,type:'PRODUCT',product_code:'12345678',price:5,currency:'CAD',date:new Date().toISOString().slice(0,10),location:{osm_address_country_code:'CA',osm_name:'Walmart',osm_address_postcode:'K9J 7B5'}},
   {id:43,type:'PRODUCT',product_code:'12345678',price:1,currency:'EUR',date:new Date().toISOString().slice(0,10),location:{osm_address_country_code:'FR'}},
   {id:44,type:'PRODUCT',product_code:'12345678',price:1,currency:'CAD',date:new Date().toISOString().slice(0,10),location:{osm_address_country_code:'US'}}
  ]});
 };
 const api=await worker(),r=await api.fetch(new Request('https://grablist.example/api/pricing/open-prices?barcode=12345678'),{});
 const data=await r.json();
 assert.equal(data.results.length,1);assert.equal(data.results[0].price,5);assert.equal(data.results[0].locationScope,'observed_branch');
});
test('public name search stays narrowly scoped to product name and CAD',async()=>{
 global.fetch=async(request)=>{
  const addr=new URL(request);
  assert.equal(addr.searchParams.get('product_name'),'Milk');
  assert.equal(addr.searchParams.get('currency'),'CAD');
  return response({items:[]});
 };
 const api=await worker(),r=await api.fetch(new Request('https://grablist.example/api/pricing/open-prices?name=Milk'),{});
 assert.equal((await r.json()).results.length,0);
});
test('GroceryPulse receives only FSA, requested list and approved retailer names',async()=>{
 let sent;
 global.fetch=async(req,opts)=>{
   assert.equal(new URL(req).hostname,'grocerypulse.ca');
   sent=JSON.parse(opts.body);
   return response({city:{name:'Ottawa'},lines:[],stores:[],recommendation:{status:'insufficient_coverage'}});
 };
 const api=await worker();
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/grocerypulse-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postalCode:'K1P 1J1',list:'Milk',stores:['walmart','costco','nofrills','danger']})}),{});
 assert.equal(r.status,200);
 assert.equal(sent.postalCode,'K1P');
 assert.deepEqual(sent.stores,['Walmart','No Frills']);
 assert.equal(sent.list,'Milk');
 assert.equal((await r.json()).scope,'city_chain_median');
});
test('does not call GroceryPulse with invalid postal code',async()=>{
 global.fetch=()=>{throw Error('Unwanted upstream fetch')};
 const api=await worker();
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/grocerypulse-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postalCode:'invalid',list:'Milk'})}),{});
 assert.equal(r.status,400);
});
