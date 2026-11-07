const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

function sample(kind) {
  const independent=kind==='independent';
  const retailer=independent?'independent':'freshco';
  const sku=independent?'20812144001_EA':'indexed-0123456789abcdef01234567';
  return {
    source:independent?'Loblaw cross-banner SKU candidate':'FreshCo search-indexed official product pages',
    scope:'online_unverified',sourceVersion:'0123456789abcdef',part:0,totalParts:2,totalRecords:1,
    records:[{
      retailer,masterProductId:'eggs-large-12',productName:independent?'Large Size Eggs 12 Pack':'Compliments White Eggs Free Run Large 12 Count',
      packageSize:'12 ct',brand:'',retailerSku:sku,
      productUrl:independent?'https://www.yourindependentgrocer.ca/en/large-size-eggs-12-pack/p/20812144001_EA':
        'https://www.freshco.com/products/compliments-white-eggs-free-run-large-12-count',
      listingKey:retailer+'|online|'+(independent?'loblaw-':'indexed-')+'0123456789abcdef01234567',
      discoveryStatus:independent?'shared_loblaw_sku_candidate_unverified':'search_indexed_page_unverified_at_store'
    }]
  };
}

for(const source of ['independent','freshco']){
  test(source+' source imports only product-page links, no price, at online_unverified scope',async()=>{
    const {importIndependentPart,importFreshcoPart}=await import('../catalogue-hammer.mjs');
    const fn=source==='independent'?importIndependentPart:importFreshcoPart;
    let statements=[];
    const db={prepare(sql){return {bind(...args){return {sql,args};}};},async batch(values){statements=values;}};
    const assets={async fetch(request){
      assert.equal(new URL(request.url).pathname,'/data/'+source+'-parts/0000.json');
      return new Response(JSON.stringify(sample(source)),{status:200});
    }};
    const result=await fn(db,assets,'https://grablist.example/api/catalogue/import-'+source,0);
    assert.equal(result.processed,1);
    assert.equal(result.pricesImported,0);
    assert.equal(result.nextPart,1);
    assert.equal(statements.length,1);
    assert.equal(statements[0].args[2],source);
    assert.equal(statements[0].args[3],'online');
    assert.equal(statements[0].args[5],sample(source).records[0].productUrl);
    assert.doesNotMatch(statements[0].sql,/last_price_cents|price_observed_at/);
  });

  test(source+' source rejects offsite, search, and wrong provenance',async()=>{
    const {importIndependentPart,importFreshcoPart}=await import('../catalogue-hammer.mjs');
    const fn=source==='independent'?importIndependentPart:importFreshcoPart;
    const good=sample(source);
    const invalid=[
      {...good.records[0],productUrl:'https://www.yourindependentgrocer.ca.evil.example/en/eggs/p/20812144001_EA'},
      {...good.records[0],productUrl:'https://www.freshco.com/products/category/Milk'},
      {...good.records[0],discoveryStatus:'made_up_verification'},
    ];
    let calls=0;
    const db={prepare(sql){return {bind(...args){return {sql,args};}};},async batch(){calls++;}};
    const assets={fetch:async()=>new Response(JSON.stringify({...good,records:invalid}),{status:200})};
    const result=await fn(db,assets,'https://grablist.example/',0);
    assert.equal(result.processed,0);
    assert.equal(result.rejected,invalid.length);
    assert.equal(calls,0);
  });
}

test('remaining retailer imports are owner-key protected and UI warns about candidate scope',async()=>{
  const {handleCatalogueApi}=await import('../catalogue-api.mjs');
  let hits=0;
  const db={prepare(sql){return {bind(){return this;},async first(){return sql.includes('schema_updates')?{migration_id:'0002_flyer_candidates'}:{amount:1};}};},async batch(){}};
  const assets={fetch:async()=>{hits++;return new Response(JSON.stringify(sample('freshco')));}};
  for(const source of ['independent','freshco']){
    const response=await handleCatalogueApi(new Request('https://grablist.example/api/catalogue/import-'+source,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({part:0})
    }),{CATALOGUE_DB:db,ASSETS:assets,CATALOGUE_WRITE_KEY:'owner-only'});
    assert.equal(response.status,401);
  }
  assert.equal(hits,0);
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/fetch\('\/api\/catalogue\/import-'\+source.id/);
  assert.match(html,/Independent page and stock unverified/);
  assert.match(html,/Indexed FreshCo product page/);
  assert.doesNotMatch(html,/<script[^>]+src=["']\.\/pricing-ui\.js/);
});
