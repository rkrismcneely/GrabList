const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sample={
  source:'Project Hammer',sourceVersion:'0123456789abcdef',
  scope:'online_unverified',part:0,totalParts:2,totalRecords:2,
  records:[
    {retailer:'nofrills',masterProductId:'eggs-large-12',
      productName:'Large Size Eggs 12 Pack',retailerSku:'20812144001_EA',
      productUrl:'https://www.nofrills.ca/en/large-size-eggs-12-pack/p/20812144001_EA',
      listingKey:'nofrills|online|hammer-0123456789abcdef01234567',
      packageSize:'12ea',brand:''},
  ],
};

test('D1 bulk importer stores actual direct links and no source price',async()=>{
  const {importHammerPart}=await import('../catalogue-hammer.mjs');
  const statements=[],assets={async fetch(request){
    assert.equal(new URL(request.url).pathname,'/data/hammer-parts/0000.json');
    return new Response(JSON.stringify(sample),{status:200});
  }};
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},
    async batch(queries){statements.push(...queries);}};
  const result=await importHammerPart(db,assets,'https://grablist.example/api/catalogue/import-hammer',0);
  assert.equal(result.processed,1);
  assert.equal(result.pricesImported,0);
  assert.equal(result.finished,false);
  assert.equal(result.nextPart,1);
  assert.equal(statements.length,1);
  assert.equal(statements[0].args[1],'eggs-large-12');
  assert.equal(statements[0].args[3],'online');
  assert.equal(statements[0].args[5],sample.records[0].productUrl);
  assert.doesNotMatch(statements[0].sql,/last_price_cents|price_observed_at|price_source/);
  assert.match(statements[0].sql,/ON CONFLICT\(listing_key\) DO UPDATE/);
});

test('bulk importer rejects untrusted domains, malformed paths and redirect-free status',async()=>{
  const {importHammerPart}=await import('../catalogue-hammer.mjs');
  const statements=[];
  const data={...sample,records:[
    {...sample.records[0],productUrl:'https://nofrills.ca.evil.test/en/large-size-eggs/p/20812144001_EA'},
    {...sample.records[0],productUrl:'https://www.nofrills.ca/en/search?q=eggs'},
  ]};
  const assets={fetch:async()=>new Response(JSON.stringify(data),{status:200})};
  const db={prepare(sql){return {bind(...args){return {sql,args};}};},batch:async arr=>{statements.push(...arr);}};
  const result=await importHammerPart(db,assets,'https://grablist.example/',0);
  assert.equal(result.processed,0);
  assert.equal(result.rejected,2);
  assert.equal(statements.length,0);
  await assert.rejects(importHammerPart(db,assets,'https://grablist.example/',-1),/Invalid import page/);
});

test('unauthorized bulk URL import does not download any source assets',async()=>{
  const {handleCatalogueApi}=await import('../catalogue-api.mjs');
  let hits=0;
  const db={prepare(query){return {
    first:async()=>query.includes('catalogue_schema_updates')?{migration_id:'0002_flyer_candidates'}:{amount:100},
    bind(){return this;},
  };},batch:async()=>{}};
  const assets={fetch:async()=>{hits++;return new Response('{}')}};
  const request=new Request('https://grablist.example/api/catalogue/import-hammer',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({part:0})});
  const result=await handleCatalogueApi(request,{CATALOGUE_DB:db,ASSETS:assets,CATALOGUE_WRITE_KEY:'secret'});
  assert.equal(result.status,401);
  assert.equal(hits,0);
});

test('HTML starts resumable owner-authorized import and no legacy pricing source',()=>{
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/fetch\('\/api\/catalogue\/import-hammer'/);
  assert.match(html,/hammer-2026-11-v1/);
  assert.doesNotMatch(html,/<script[^>]+src=["']\.\/pricing-ui\.js/);
});
