const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('curated URL importer rejects off-retailer and search links',async()=>{
  const {safeCuratedUrl,extractCuratedLinks}=await import('../catalogue-sources.mjs');
  assert.equal(safeCuratedUrl('https://www.freshco.com/products/oat-milk','freshco'),
    'https://www.freshco.com/products/oat-milk');
  assert.equal(safeCuratedUrl('https://www.freshco.com/search?q=milk','freshco'),null);
  assert.equal(safeCuratedUrl('https://freshco.com.evil.example/products/milk','freshco'),null);
  assert.equal(safeCuratedUrl('http://www.walmart.ca/en/ip/milk/123','walmart'),null);
  assert.equal(safeCuratedUrl('https://www.walmart.ca/en/ip/milk/123','freshco'),null);
  const links=extractCuratedLinks({products:[
    {name:'Oat Milk 1.75 L',variants:[
      {store:'freshco',url:'https://www.freshco.com/products/oat-milk-175'},
      {store:'freshco',url:'https://www.freshco.com/products/oat-milk-175'},
      {store:'superstore',url:'https://www.realcanadiansuperstore.ca/en/products/milk'},
    ]},
  ]});
  assert.equal(links.length,1);
  assert.equal(links[0].size,'1.75 L');
});

test('curated import batches are bounded, private and store only product metadata',async()=>{
  const {importCuratedBatch,CURATED_SOURCE_URL}=await import('../catalogue-sources.mjs');
  const products=Array.from({length:20},(_,i)=>({
    name:'Coffee '+(500+i)+' g',
    variants:[{store:'walmart',url:'https://www.walmart.ca/en/ip/coffee/'+i,brand:'Brand'}]
  }));
  let lastBatch=[];
  const db={
    prepare(sql){return {sql,bind(...values){return {sql,values};}};},
    async batch(statements){lastBatch=statements;}
  };
  const fetcher=async (url,opts)=>{
    assert.equal(url,CURATED_SOURCE_URL);
    assert.equal(opts.redirect,'error');
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({products})};
  };
  const first=await importCuratedBatch(db,{offset:0},fetcher);
  assert.equal(first.total,20);
  assert.equal(first.processed,16);
  assert.equal(first.nextOffset,16);
  assert.equal(first.pricesImported,0);
  assert.equal(lastBatch.length,32);
  assert.equal(lastBatch.filter(x=>/last_price_cents|price_observed_at/.test(x.sql)).length,0);
  assert.equal(lastBatch[1].values[3],'online');
  assert.equal(lastBatch[1].values[2],'walmart');
  const second=await importCuratedBatch(db,{offset:16},fetcher);
  assert.equal(second.processed,4);
  assert.equal(second.finished,true);
  assert.equal(lastBatch.length,8);
});

test('No Frills existing links import only genuinely matched product URLs',async()=>{
  const {extractMatchedNoFrillsLinks,importCuratedBatch,NOFRILLS_SOURCE_URL,NOFRILLS_METADATA_URL}
    =await import('../catalogue-sources.mjs');
  const products='product_id,item_description,brand,size_qty,size_uom\n'+
    'sku_1,Chicken Noodle Soup,Tim Hortons,540,mL\n'+
    'sku_2,Tomato Soup,Campbells,284,mL\n';
  const urls='retailer_id,product_id,product_url,url_status,matched_product_name,last_checked,seller,notes\n'+
    'no_frills,sku_1,https://www.nofrills.ca/en/chicken-noodle-soup/p/123_EA,matched,Chicken Noodle Soup,2026-11-07,,\n'+
    'no_frills,sku_2,https://www.nofrills.ca/search?q=soup,blocked,,2026-11-07,,\n'+
    'walmart,sku_1,https://www.walmart.ca/en/ip/soup/123,matched,Soup,2026-11-07,,\n';
  const entries=extractMatchedNoFrillsLinks(urls,products);
  assert.equal(entries.length,1);
  assert.equal(entries[0].brand,'Tim Hortons');
  assert.equal(entries[0].size,'540 mL');
  let statements=[];
  const db={prepare(sql){return {bind(...values){return {sql,values};}};},
    async batch(batch){statements=batch;}};
  const fetcher=async url=>({
    ok:true,headers:{get:()=>null},
    text:async()=>url===NOFRILLS_SOURCE_URL?urls:
      url===NOFRILLS_METADATA_URL?products:''
  });
  const result=await importCuratedBatch(db,{source:'nofrills-matched',offset:0},fetcher);
  assert.equal(result.processed,1);
  assert.equal(result.pricesImported,0);
  assert.equal(statements.length,2);
  assert.equal(statements[1].values[2],'nofrills');
  assert.equal(statements[1].values[3],'online');
});

test('catalogue API requires owner secret for importing URLs',async()=>{
  const {handleCatalogueApi}=await import('../catalogue-api.mjs');
  let attempts=0;
  const db={
    prepare(sql){return {async first(){return {};}};},
    async batch(){attempts++;}
  };
  const response=await handleCatalogueApi(new Request('https://grablist.example/api/catalogue/import-curated',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offset:0})
  }),{CATALOGUE_DB:db,CATALOGUE_WRITE_KEY:'secret-key'});
  assert.equal(response.status,401);
  assert.equal(attempts,0);
});

test('UI initiates existing URL import automatically and never imports historical prices',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const api=fs.readFileSync('catalogue-api.mjs','utf8');
  assert.match(html,/fetch\('\/api\/catalogue\/import-curated'/);
  assert.match(api,/x-grablist-key/);
  assert.match(api,/CATALOGUE_WRITE_KEY/);
});
