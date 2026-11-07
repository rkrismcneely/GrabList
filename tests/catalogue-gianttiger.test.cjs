const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const example={
  source:'Giant Tiger public Shopify catalogue',scope:'online_unverified',
  sourceVersion:'0123456789abcdef',part:0,totalParts:2,totalRecords:1,
  records:[{
    retailer:'gianttiger',
    masterProductId:'candidate-12345abc',
    productName:'Kraft Peanut Butter Smooth 1 kg',
    brand:'Kraft',
    packageSize:'1 kg',
    retailerSku:'shopify-12345678901234',
    productUrl:'https://www.gianttiger.com/products/kraft-peanut-butter-smooth?variant=12345678901234',
    listingKey:'gianttiger|online|shopify-0123456789abcdef01234567',
  }]
};

test('Giant Tiger product feed URLs and variants import as unverified URL metadata only',async()=>{
  const {importGiantTigerPart}=await import('../catalogue-hammer.mjs');
  const statements=[];
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},
    async batch(values){statements.push(...values);}
  };
  const assets={async fetch(request){
    assert.equal(new URL(request.url).pathname,'/data/gianttiger-parts/0000.json');
    return new Response(JSON.stringify(example),{status:200});
  }};
  const result=await importGiantTigerPart(db,assets,'https://grablist.example/api/catalogue/import-gianttiger',0);
  assert.equal(result.processed,1);
  assert.equal(result.pricesImported,0);
  assert.equal(result.source,example.source);
  assert.equal(result.nextPart,1);
  assert.equal(statements.length,1);
  assert.equal(statements[0].args[2],'gianttiger');
  assert.equal(statements[0].args[3],'online');
  assert.equal(statements[0].args[5],example.records[0].productUrl);
  assert.doesNotMatch(statements[0].sql,/last_price_cents|price_observed_at/);
});

test('Giant Tiger import rejects foreign domains and malformed variant paths',async()=>{
  const {importGiantTigerPart}=await import('../catalogue-hammer.mjs');
  let ran=0;
  const invalid=[
    {...example.records[0],productUrl:'https://gianttiger.com.evil.example/products/milk'},
    {...example.records[0],productUrl:'https://www.gianttiger.com/search?q=milk'},
    {...example.records[0],productUrl:'http://www.gianttiger.com/products/milk'},
    {...example.records[0],productUrl:'https://www.gianttiger.com/products/milk?variant=abc'},
  ];
  const assets={fetch:async()=>new Response(JSON.stringify({...example,records:invalid}),{status:200})};
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},
    batch:async()=>{ran++;}};
  const result=await importGiantTigerPart(db,assets,'https://grablist.example/',0);
  assert.equal(result.processed,0);
  assert.equal(result.rejected,4);
  assert.equal(ran,0);
});

test('Giant Tiger import is owner-only and UI resumes batches',async()=>{
  const {handleCatalogueApi}=await import('../catalogue-api.mjs');
  const db={prepare(sql){return {first:async()=>sql.includes('schema_updates')?{migration_id:'0002_flyer_candidates'}:{amount:1},bind(){return this;}};},
    batch:async()=>{}};
  let calls=0;
  const assets={fetch:async()=>{calls++;return new Response(JSON.stringify(example));}};
  const request=new Request('https://grablist.example/api/catalogue/import-gianttiger',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({part:0})});
  const response=await handleCatalogueApi(request,{CATALOGUE_DB:db,ASSETS:assets,CATALOGUE_WRITE_KEY:'owner-secret'});
  assert.equal(response.status,401);
  assert.equal(calls,0);
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/fetch\('\/api\/catalogue\/import-gianttiger'/);
  assert.match(html,/gianttiger-2026-11-v1/);
  assert.doesNotMatch(html,/<script[^>]+src=["']\.\/pricing-ui\.js/);
});
