const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

function sample(rows=2){
  return {
    source:'Giant Tiger official grocery collection',
    scope:'online_unverified',sourceVersion:'0123456789abcdef',
    part:0,totalParts:3,totalRecords:rows*3,
    records:Array.from({length:rows},(_,i)=>({
      retailer:'gianttiger',masterProductId:'gtg-0123456789abcdef012345'+String(i).padStart(2,'0'),
      productName:'Pasta Sauce Original '+(650+i)+' ml',
      brand:'Primo',packageSize:(650+i)+' ml',category:'Pantry',
      retailerSku:'shopify-'+(12345678901234+i),
      productUrl:'https://www.gianttiger.com/products/primo-pasta-sauce-original-'+(650+i)+'ml',
      listingKey:'gianttiger|online|shopify-'+('0123456789abcdef0123456'+String(i).padStart(3,'0')),
      discoveryStatus:'official_grocery_collection_unverified_at_store',
    }))
  };
}

test('Giant Tiger grocery source creates canonical descriptions and listings in only two SQL statements',async()=>{
  const {importGroceryPart}=await import('../catalogue-grocery.mjs');
  const payload=sample(80),calls=[];
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},
    async batch(queries){calls.push(...queries);}};
  const assets={fetch:async req=>{
    assert.equal(new URL(req.url).pathname,'/data/gianttiger-grocery/0000.json');
    return new Response(JSON.stringify(payload),{status:200});
  }};
  const r=await importGroceryPart(db,assets,'https://grablist.example/api/catalogue/import-gt-grocery',0);
  assert.equal(r.processed,80);
  assert.equal(r.productsDiscovered,80);
  assert.equal(r.pricesImported,0);
  assert.equal(r.nextPart,1);
  assert.equal(calls.length,2);
  assert.match(calls[0].sql,/INSERT OR IGNORE INTO catalogue_products/);
  assert.match(calls[1].sql,/INSERT INTO catalogue_listings/);
  assert.equal(calls[0].args.length,80*7);
  assert.equal(calls[1].args.length,80*9);
  assert.equal(calls[1].args[3],'online');
  assert.doesNotMatch(calls[0].sql+calls[1].sql,/last_price_cents|price_observed_at/);
});

test('Giant Tiger grocery importer rejects hostile URLs and wrong source labels',async()=>{
  const {importGroceryPart}=await import('../catalogue-grocery.mjs');
  const payload=sample(1);
  payload.records=[
    {...payload.records[0],productUrl:'https://www.gianttiger.com.evil.example/products/pasta'},
    {...payload.records[0],productUrl:'https://www.gianttiger.com/search?q=coffee'},
    {...payload.records[0],productUrl:'https://www.gianttiger.com/products/pasta?variant=abc'},
    {...payload.records[0],discoveryStatus:'invented_warehouse_price'},
  ];
  let calls=0;
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},
    async batch(){calls++;}};
  const assets={fetch:async()=>new Response(JSON.stringify(payload),{status:200})};
  const r=await importGroceryPart(db,assets,'https://grablist.example/',0);
  assert.equal(r.processed,0);
  assert.equal(r.rejected,4);
  assert.equal(calls,0);
});

test('Only catalogue owner can create grocery products; UI resumes interrupted batches',async()=>{
  const {handleCatalogueApi}=await import('../catalogue-api.mjs');
  let hits=0;
  const db={prepare(sql){return {bind(){return this;},async first(){
    return sql.includes('schema_updates')?{migration_id:'0002_flyer_candidates'}:{amount:1};
  }};},async batch(){}};
  const assets={fetch:async()=>{hits++;return new Response(JSON.stringify(sample(1)));}};
  const req=new Request('https://grablist.example/api/catalogue/import-gt-grocery',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({part:0})});
  const response=await handleCatalogueApi(req,{CATALOGUE_DB:db,ASSETS:assets,CATALOGUE_WRITE_KEY:'secret'});
  assert.equal(response.status,401);
  assert.equal(hits,0);
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/fetch\('\/api\/catalogue\/import-gt-grocery'/);
  assert.match(html,/gt-grocery-full-2026-11-v1/);
});
