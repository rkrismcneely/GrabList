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
 assert.deepEqual(data.sources,['open-prices-barcode','grocerypulse-reference-cities','statistics-canada-national-averages']);
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
test('GroceryPulse receives only FSA and the shopping list without a possibly unsupported store filter',async()=>{
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
 assert.equal(sent.stores,undefined);
 assert.equal(sent.list,'Milk');
 assert.equal((await r.json()).scope,'covered_postal_area');
});
test('does not call GroceryPulse with invalid postal code',async()=>{
 global.fetch=()=>{throw Error('Unwanted upstream fetch')};
 const api=await worker();
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/grocerypulse-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postalCode:'invalid',list:'Milk'})}),{});
 assert.equal(r.status,400);
});

test('uncovered postal codes select geographically closest tracked city, not arbitrary province rule',async()=>{
 const calls=[];
 global.fetch=async(req,opts)=>{
   const u=new URL(req);calls.push(u.hostname);
   if(u.hostname==='api.zippopotam.us'){
     assert.equal(u.pathname,'/CA/K9J');
     return response({'post code':'K9J',places:[{latitude:'44.3',longitude:'-78.32'}]});
   }
   assert.equal(u.hostname,'grocerypulse.ca');
   const body=JSON.parse(opts.body);
   if(body.postalCode){
     assert.equal(body.postalCode,'K9J');
     return response({error:{code:'postal_code_not_covered',message:'Not covered'}},400);
   }
   assert.equal(body.city,'toronto');
   return response({city:{name:'Toronto',province:'ON'},lines:[{status:'exact'}],
      stores:[{key:'nofrills',name:'No Frills',totalCad:4.83,totalScope:'complete_requested_list',itemObservationDates:[{observedAt:'2026-11-04'}]}]});
 };
 const api=await worker();
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/grocerypulse-plan',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postalCode:'K9J 7B5',list:'Large eggs 12-pack'})}),{});
 const data=await r.json();
 assert.deepEqual(calls,['grocerypulse.ca','api.zippopotam.us','grocerypulse.ca']);
 assert.equal(data.isFallback,true);
 assert.equal(data.scope,'nearest_reference_city');
 assert.equal(data.referenceMarket.name,'Toronto');
 assert.ok(data.referenceMarket.distanceKm>50&&data.referenceMarket.distanceKm<180);
 assert.equal(data.data.stores[0].totalCad,4.83);
});
test('Statistics Canada fallback only matches known staple and retains actual 2026-09 pack size',async()=>{
 global.fetch=()=>{throw Error('No upstream necessary')};
 const api=await worker();
 const milk=await (await api.fetch(new Request('https://grablist.example/api/pricing/national-reference?name=Milk&size=2%20L'),{})).json();
 assert.equal(milk.scope,'national_average');
 assert.equal(milk.results[0].price,5.50);
 assert.equal(milk.results[0].matchStatus,'reference_size');
 assert.equal(milk.results[0].observedAt,'2026-09');
 const wrong=await (await api.fetch(new Request('https://grablist.example/api/pricing/national-reference?name=Milk&size=4%20L'),{})).json();
 assert.equal(wrong.results[0].matchStatus,'different_size');
 const untracked=await (await api.fetch(new Request('https://grablist.example/api/pricing/national-reference?name=Kimchi'),{})).json();
 assert.equal(untracked.results.length,0);
});
test('does not treat provider network errors as grounds to invent a regional fallback',async()=>{
 let count=0;
 global.fetch=async()=>{count++;return response({error:{code:'temporarily_unavailable',message:'Unavailable'}},503)};
 const api=await worker();
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/grocerypulse-plan',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postalCode:'K9J 7B5',list:'Milk'})}),{});
 assert.equal(r.status,503);
 assert.equal(count,1);
});

test('Savvi requires shopper token and only uses approved retailers; never returns the key',async()=>{
 const api=await worker();
 const noToken=await api.fetch(new Request('https://grablist.example/api/pricing/savvi',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'eggs',retailers:['nofrills']})}),{});
 assert.equal(noToken.status,400);
 const token='apify_api_example_testing_key_123456789';
 let count=0;
 global.fetch=async(req,opts)=>{
   count++;
   assert.equal(new URL(req).hostname,'api.apify.com');
   assert.equal(opts.headers.Authorization,'Bearer '+token);
   assert.equal(new URL(req).searchParams.get('token'),null);
   const body=JSON.parse(opts.body);
   assert.deepEqual(body.retailers,['nofrills','independent']);
   assert.deepEqual(body.queries,['large eggs 12']);
   assert.equal(body.postal_code,'K9J7B5');
   return response([{_type:'comparison',retailer:'nofrills',price:4.39,currency:'CAD',
      matched_product:'No Name Large Eggs',package_size:'12 ct',
      banner:'No Frills',store:'Peterborough',match_confidence:'medium',
      scraped_at:'2026-11-06T12:00:00Z',source_url:'https://www.nofrills.ca/product/eggs'}]);
 };
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/savvi',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
     apiToken:token,query:'large eggs 12',retailers:['nofrills','independent','walmart'],postalCode:'K9J 7B5'
   })}),{});
 const d=await r.json();
 assert.equal(count,1);
 assert.equal(d.results[0].price,4.39);
 assert.equal(d.results[0].packageSize,'12 ct');
 assert.equal(d.results[0].confidence,'medium');
 assert.ok(!JSON.stringify(d).includes(token));
});

test('national milk reference never silently treats unspecified or 4 L milk as 2 L',async()=>{
 const api=await worker();
 const query=async(size)=>{const q=new URLSearchParams({name:'Milk'});if(size)q.set('size',size);
  const r=await api.fetch(new Request('https://grablist.example/api/pricing/national-reference?'+q),{});
  return (await r.json()).results[0];};
 const unspecified=await query('');
 assert.equal(unspecified.pack,'2 L');
 assert.equal(unspecified.matchStatus,'size_unspecified');
 assert.equal((await query('4 L')).matchStatus,'different_size');
 assert.equal((await query('2 L')).matchStatus,'reference_size');
});

test('catalogue search finds Canadian products but never invents their prices',async()=>{
  const api=await worker();let calls=0;
  global.fetch=async(req)=>{
    calls++;
    const url=new URL(req);
    assert.equal(url.hostname,'world.openfoodfacts.org');
    assert.equal(url.pathname,'/cgi/search.pl');
    assert.equal(url.searchParams.get('search_terms'),'marshmallows');
    assert.equal(url.searchParams.get('json'),'1');
    return response({products:[
      {code:'1234567890123',product_name:'Mini Marshmallows',brands:'Brand A',quantity:'400 g',countries_tags:['en:canada']},
      {code:'1234567890124',product_name:'Fluffy Marshmallows',brands:'Brand B',quantity:'250 g',countries_tags:['en:united-states']},
      {code:'bad',product_name:'Marshmallows',brands:'Bad',quantity:'200 g',countries_tags:['en:canada']},
      {code:'1234567890125',product_name:'Tomato Sauce',brands:'Other',quantity:'400 g',countries_tags:['en:canada']}
    ]});
  };
  const url='https://grablist.example/api/pricing/catalog-search?name=marshmallows';
  const a=await api.fetch(new Request(url),{});
  const data=await a.json();
  assert.equal(a.status,200);
  assert.equal(data.priceSource,false);
  assert.equal(data.results.length,2);
  assert.equal(data.results[0].barcode,'1234567890123');
  assert.equal(data.results[0].packageSize,'400 g');
  assert.equal(data.results[0].countryCoverage,'canada');
  assert.equal(data.results[0].price,undefined);
  const b=await api.fetch(new Request(url),{});
  assert.equal((await b.json()).results.length,2);
  assert.equal(calls,1);
});
test('catalogue does not accept arbitrary URLs or too-short names',async()=>{
  const api=await worker();
  assert.equal((await api.fetch(new Request('https://grablist.example/api/pricing/catalog-search?name=x'),{})).status,400);
  assert.equal((await api.fetch(new Request('https://grablist.example/api/pricing/catalog-search?name=https%3A%2F%2Fevil.example'),{})).status,400);
});

test('VynnAI exact barcode lookup uses shopper key and preserves observed store evidence',async()=>{
 const api=await worker(),token='vynn_pk_test_example_123456789';
 let requested=0;
 global.fetch=async(req,opts)=>{
  requested++;
  const u=new URL(req);
  assert.equal(u.hostname,'vynn.ai');
  assert.equal(u.pathname,'/v1/products/lookup');
  assert.equal(u.searchParams.get('upc'),'0060383682057');
  assert.equal(u.searchParams.get('province'),'ON');
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  return response({
    canonical_product:{display_name:'Milk 4 L',brand:'Natrel',size:'4 L',upc:'0060383682057'},
    offers:[{current_price:6.44,banner:'FreshCo',province:'ON',store_id:'F144',
      observed_at:'2026-11-06T12:00:00Z',currency:'CAD'}]
  });
 };
 const r=await api.fetch(new Request('https://grablist.test/api/pricing/vynn',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   apiToken:token,barcode:'0060383682057',postalCode:'K9J 7B5'
  })
 }),{});
 const data=await r.json();
 assert.equal(r.status,200);assert.equal(requested,1);
 assert.equal(data.results[0].storeId,'freshco');
 assert.equal(data.results[0].price,6.44);
 assert.equal(data.results[0].barcode,'0060383682057');
 assert.equal(data.results[0].confidence,'high');
 assert.equal(data.results[0].packageSize,'4 L');
 assert.equal(data.results[0].observedAt,'2026-11-06');
 assert.equal(data.results[0].scope,'province_reference');
 assert.ok(!JSON.stringify(data).includes(token));
});
test('VynnAI does not invent prices for catalogue-only search results',async()=>{
 const api=await worker();
 global.fetch=async()=>response({products:[
  {display_name:'Marshmallows 400 g',upc:'1234567890123',size:'400 g',offers:[]}
 ]});
 const r=await api.fetch(new Request('https://grablist.test/api/pricing/vynn',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   apiToken:'vynn_pk_test_example_123456789',query:'marshmallows',postalCode:'K9J 7B5'
  })
 }),{});
 assert.equal((await r.json()).results.length,0);
});
test('ReefAPI requires explicit branch and returns only store-specific priced products',async()=>{
 const api=await worker(),key='reef_key_sample_example_123456789';
 global.fetch=async(req,opts)=>{
  assert.equal(new URL(req).pathname,'/loblaws/v1/search');
  assert.equal(opts.headers['x-api-key'],key);
  const body=JSON.parse(opts.body);
  assert.equal(body.banner,'nofrills');assert.equal(body.store_id,'1534');
  assert.equal(body.query,'marshmallows');
  return response({ok:true,data:{products:[
   {product_name:'Mini Marshmallows',pack_size:'400 g',price:3.99,
    price_date:'2026-11-06',stock_status:'in_stock',original_price:4.99},
   {product_name:'Marshmallow Fluff',pack_size:'200 g',price:4.49,price_date:'2026-11-06'},
   {product_name:'Missing Price',pack_size:'200 g'}
  ]},meta:{charged_credits:2}});
 };
 const url='https://grablist.test/api/pricing/reef-search';
 const missing=await api.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({apiToken:key,storeId:'nofrills',query:'marshmallows'})}),{});
 assert.equal(missing.status,400);
 const res=await api.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({apiToken:key,storeId:'nofrills',branchId:'1534',query:'marshmallows'})}),{});
 const data=await res.json();
 assert.equal(res.status,200);assert.equal(data.results.length,2);
 assert.equal(data.results[0].price,3.99);assert.equal(data.results[0].packageSize,'400 g');
 assert.equal(data.results[0].branchId,'1534');assert.equal(data.results[0].scope,'selected_branch');
 assert.equal(data.chargedCredits,2);
 assert.ok(!JSON.stringify(data).includes(key));
});
test('ReefAPI store directory uses postal area, not full residential postal code',async()=>{
 const api=await worker(),key='reef_key_sample_example_123456789';
 global.fetch=async(req,opts)=>{
  assert.equal(new URL(req).pathname,'/loblaws/v1/stores');
  const body=JSON.parse(opts.body);
  assert.equal(body.postal_code,'K9J');assert.equal(body.banner,'independent');
  return response({ok:true,data:{stores:[{store_id:'8811',name:'Your Independent Grocer',
   address:'Example street',city:'Peterborough',latitude:44.3,longitude:-78.32,distance_km:2.1}]}});
 };
 const r=await api.fetch(new Request('https://grablist.test/api/pricing/reef-stores',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   apiToken:key,storeId:'independent',postalCode:'K9J 7B5'
  })
 }),{});
 const data=await r.json();
 assert.equal(r.status,200);
 assert.equal(data.branches[0].id,'8811');
 assert.equal(data.branches[0].distanceKm,2.1);
});

test('VynnAI excludes offers outside the requested postal province',async()=>{
 const api=await worker();
 global.fetch=async()=>response({
  canonical_product:{display_name:'4 L Milk',size:'4 L',upc:'0060383682057'},
  offers:[
   {current_price:3.00,banner:'FreshCo',province:'QC',observed_at:'2026-11-06'},
   {current_price:6.44,banner:'FreshCo',province:'ON',observed_at:'2026-11-06'}
  ]
 });
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/vynn',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({apiToken:'vynn_pk_testing_example_123456789',
    barcode:'0060383682057',postalCode:'K9J 7B5'})
 }),{});
 const data=await r.json();
 assert.equal(data.results.length,1);
 assert.equal(data.results[0].price,6.44);
});
test('ReefAPI never fabricates member prices from null or permits untrusted source URLs',async()=>{
 const api=await worker();
 global.fetch=async()=>response({ok:true,data:{products:[{
  product_name:'Milk 4 L',pack_size:'4 L',price:6.44,
  original_price:null,member_price:null,price_date:'2026-11-06',url:'javascript:alert(1)'
 }]}});
 const r=await api.fetch(new Request('https://grablist.example/api/pricing/reef-search',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({apiToken:'reef_key_sample_example_123456789',
   storeId:'nofrills',branchId:'1234',query:'milk'})
 }),{});
 const data=await r.json();
 assert.equal(data.results[0].memberPrice,null);
 assert.equal(data.results[0].originalPrice,null);
 assert.equal(data.results[0].sourceUrl,'');
});

test('free Épiceries.ca lookup translates marshmallows, checks exact size and keeps Québec scope',async()=>{
 const api=await worker();let requests=0;
 global.fetch=async(req)=>{
  requests++;
  const u=new URL(req);
  assert.equal(u.hostname,'epiceries.ca');
  if(u.searchParams.get('endpoint')==='search'){
   assert.equal(u.searchParams.get('q'),'guimauves');
   return response({ok:true,data:{results:[
    {id:'m123',name:'Mini guimauves',brand:'Sans nom',size:'400 g',
     price:2.79,store:'walmart',updated:'2026-11-05T10:00:00Z'},
    {id:'m250',name:'Mini guimauves',brand:'Sans nom',size:'250 g',
     price:1.99,store:'maxi',updated:'2026-11-05T10:00:00Z'},
    {id:'m999',name:'Chips de chocolat',brand:'Sans nom',size:'400 g',
     price:1,store:'walmart',updated:'2026-11-05T10:00:00Z'}
   ]}});
  }
  assert.equal(u.searchParams.get('endpoint'),'product');
  assert.equal(u.searchParams.get('id'),'m123');
  return response({ok:true,data:{
   id:'m123',name:'Mini guimauves',brand:'Sans nom',size:'400 g',
   prices:[
    {store:'walmart',price:2.79,size:'400 g',date:'2026-11-05T10:00:00Z'},
    {store:'maxi',price:3.19,size:'400 g',date:'2026-11-05T10:00:00Z'},
    {store:'iga',price:4.09,size:'250 g',date:'2026-11-05T10:00:00Z'}
   ]}});
 };
 const url='https://grablist.test/api/pricing/epiceries?name=marshmallows&size=400%20g';
 const res=await api.fetch(new Request(url),{});
 const data=await res.json();
 assert.equal(res.status,200);
 assert.equal(data.province,'QC');
 assert.equal(data.results.length,2);
 assert.equal(data.results[0].storeId,null); // A Québec Walmart price is not a Peterborough Walmart quote.
 assert.equal(data.results[0].scope,'quebec_reference');
 assert.equal(data.results[0].packageSize,'400 g');
 assert.equal(data.results[0].price,2.79);
 assert.equal(data.results[1].storeId,null);
 assert.ok(data.results.every(x=>x.city.includes('NOT')||x.city.includes('not')));
 const cached=await api.fetch(new Request(url),{});
 assert.equal((await cached.json()).results.length,2);
 assert.equal(requests,2);
});
test('Épiceries.ca does not use a product whose category name does not match',async()=>{
 const api=await worker();
 global.fetch=async(req)=>{
  assert.equal(new URL(req).searchParams.get('endpoint'),'search');
  return response({ok:true,data:{results:[
   {id:'fakebread',name:'Pain 100% blé entier',size:'675 g',price:3.49,store:'walmart'}
  ]}});
 };
 const res=await api.fetch(new Request('https://grablist.test/api/pricing/epiceries?name=marshmallows'),{});
 const data=await res.json();
 assert.deepEqual(data.results,[]);
});
