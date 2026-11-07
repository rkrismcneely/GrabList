const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const data={
  source:'Costco public product sitemap',scope:'online_unverified',
  sourceVersion:'0123456789abcdef',part:0,totalParts:2,totalRecords:1,
  records:[{
    retailer:'costco',masterProductId:'butter-salted-454g',
    productName:'beatrice salted butter 454 g',brand:'',packageSize:'',
    retailerSku:'sitemap-100542617',
    productUrl:'https://www.costco.ca/p/-/beatrice-salted-butter-454-g/100542617',
    listingKey:'costco|online|sitemap-0123456789abcdef01234567',
  }]
};

test('Costco sitemap product URLs are imported without price or stock claims',async()=>{
  const {importCostcoPart}=await import('../catalogue-hammer.mjs');
  const queries=[];
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},async batch(s){queries.push(...s);}};
  const assets={fetch:async req=>{
    assert.equal(new URL(req.url).pathname,'/data/costco-parts/0000.json');
    return new Response(JSON.stringify(data),{status:200});
  }};
  const out=await importCostcoPart(db,assets,'https://grablist.example/api/catalogue/import-costco',0);
  assert.equal(out.source,'Costco public product sitemap');
  assert.equal(out.processed,1);
  assert.equal(out.pricesImported,0);
  assert.equal(out.nextPart,1);
  assert.equal(queries.length,1);
  assert.equal(queries[0].args[2],'costco');
  assert.equal(queries[0].args[3],'online');
  assert.equal(queries[0].args[5],data.records[0].productUrl);
  assert.doesNotMatch(queries[0].sql,/last_price_cents|price_observed_at/);
});

test('Costco importer rejects off-domain and non-product links',async()=>{
  const {importCostcoPart}=await import('../catalogue-hammer.mjs');
  const unsafe=[
    {...data.records[0],productUrl:'https://costco.ca.evil.test/p/-/butter/100542617'},
    {...data.records[0],productUrl:'https://www.costco.ca/search?q=butter'},
    {...data.records[0],productUrl:'http://www.costco.ca/p/-/butter/100542617'},
    {...data.records[0],productUrl:'https://www.costco.ca/p/-/butter/abc'},
  ];
  let calls=0;
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},async batch(){calls++;}};
  const assets={fetch:async()=>new Response(JSON.stringify({...data,records:unsafe}),{status:200})};
  const out=await importCostcoPart(db,assets,'https://grablist.example/',0);
  assert.equal(out.processed,0);
  assert.equal(out.rejected,4);
  assert.equal(calls,0);
});

test('Costco import is owner-only and mobile import state is resumable',async()=>{
  const {handleCatalogueApi}=await import('../catalogue-api.mjs');
  let requests=0;
  const db={prepare(sql){return {bind(){return this;},async first(){return sql.includes('schema_updates')?{migration_id:'0002_flyer_candidates'}:{amount:1};}};},async batch(){}};
  const assets={fetch:async()=>{requests++;return new Response(JSON.stringify(data));}};
  const req=new Request('https://grablist.example/api/catalogue/import-costco',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({part:0})});
  const response=await handleCatalogueApi(req,{CATALOGUE_DB:db,ASSETS:assets,CATALOGUE_WRITE_KEY:'owner'});
  assert.equal(response.status,401);
  assert.equal(requests,0);
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/fetch\('\/api\/catalogue\/import-costco'/);
  assert.match(html,/costco-sitemap-2026-11-v1/);
});
