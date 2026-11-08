const test = require('node:test');
const assert = require('node:assert/strict');
const compare = require('../catalogue-comparison.js');
const item={id:'coffee',name:'Ground Coffee',size:'864 g',brand:'',quantity:'2',storeId:'walmart',complete:false};
const offer=(retailer,priceCents,branchId='peterborough',extra={})=>({
 key:retailer+'|'+branchId+'|coffee',retailer,branchId,
 productName:'Maxwell House Original Roast Ground Coffee',size:'864 g',brand:'Maxwell House',
 status:'current',scope:'selected_branch',priceCents,observedAt:'2026-11-07T10:00:00Z',...extra
});
test('package sizes and variants prevent wrong matches',()=>{
 assert.equal(compare.measure('1 kg'),compare.measure('1000 g'));
 assert.equal(compare.productMatch(item,offer('walmart',1800)),true);
 assert.equal(compare.productMatch({...item,barcode:'123456789012'},offer('walmart',1800)),false);
 assert.equal(compare.productMatch(item,offer('walmart',1800,'peterborough',{size:'340 g'})),false);
 assert.equal(compare.productMatch({name:'Oat Milk',size:'1 L'}, {productName:'Rolled Oats',size:'1 L'}),false);
 assert.equal(compare.productMatch({name:'2% Milk'}, {productName:'1% Milk'}),false);
 assert.equal(compare.productMatch({name:'Ground Coffee'}, {productName:'Instant Coffee'}),false);
 assert.equal(compare.productMatch({name:'Coffee'}, {productName:'Instant Coffee'}),false);
 assert.equal(compare.productMatch({name:'Butter'}, {productName:'Peanut Butter'}),false);
});
test('online-only, old or wrong-branch prices never enter savings',()=>{
 const matched=offer('freshco',800,'online',{scope:'online_unverified'});
 assert.equal(compare.eligibleOffer(item,matched,{freshco:'peterborough'}),false);
 assert.equal(compare.eligibleOffer(item,offer('freshco',800,'other'),{freshco:'peterborough'}),false);
 assert.equal(compare.eligibleOffer(item,offer('freshco',800,'peterborough',{status:'stale'}),{freshco:'peterborough'}),false);
});
test('comparison ignores item manual offers and requires verified price at original store',()=>{
 const old={...item,price:999,offers:[{storeId:'freshco',source:'manual',price:1,observedAt:Date.now()}]};
 const result=compare.evaluate([old],[{id:'coffee',offers:[offer('freshco',800)]}],['walmart','freshco'],{walmart:'peterborough',freshco:'peterborough'},0);
 assert.equal(result.eligibleCount,0);
 assert.equal(result.changes.length,0);
});
test('only database offers can justify savings and an extra store',()=>{
 const rows=[{id:'coffee',offers:[offer('walmart',1999),offer('freshco',1499)]}];
 const stores={walmart:'peterborough',freshco:'peterborough'};
 const plan=compare.evaluate([item],rows,['walmart','freshco'],stores,5);
 assert.equal(plan.eligibleCount,1);
 assert.equal(plan.totalSavings,10);
 assert.equal(plan.changes[0].to,'freshco');
 assert.deepEqual(plan.addedStores,['freshco']);
 const tooHigh=compare.evaluate([item],rows,['walmart','freshco'],stores,11);
 assert.equal(tooHigh.changes.length,0);
});
test('explicit brand name must match',()=>{
 assert.equal(compare.productMatch({...item,brand:'Folgers'},offer('walmart',1800)),false);
});
test('API extracts only unambiguous structured product page prices',async()=>{
 const {extractProductPrice,handleCatalogueApi}=await import('../catalogue-api.mjs');
 const product=JSON.stringify({'@context':'https://schema.org','@type':'Product',name:'Coffee',offers:{'@type':'Offer',price:'17.97',priceCurrency:'CAD'}});
 assert.deepEqual(extractProductPrice('<script type="application/ld+json">'+product+'</script>'),
   {priceCents:1797,scope:'online_unverified',source:'public-product-page'});
 assert.equal(extractProductPrice('Recommended product $3.99').priceCents,null);
 assert.equal(extractProductPrice('<script type="application/ld+json">'+
   JSON.stringify({'@type':'Product',offers:[{price:'8.00'},{price:'9.00'}]})+'</script>').priceCents,null);
 assert.equal(extractProductPrice('<script type="application/ld+json">'+
   JSON.stringify({'@type':'Product',offers:{price:20,priceCurrency:'USD'}})+'</script>').priceCents,null);
 const status=await handleCatalogueApi(new Request('https://example.com/api/catalogue/status'),{});
 assert.deepEqual((await status.json()).ready,false);
});


test('Shopify product URLs can supply exact Giant Tiger online variant prices',async()=>{
 const {extractShopifyProductPrice}=await import('../catalogue-api.mjs');
 const data={variants:[
   {id:12345678901234,price:399,available:true},
   {id:12345678901235,price:549,available:true}
 ]};
 const url='https://www.gianttiger.com/products/oat-drink?variant=12345678901235';
 assert.deepEqual(extractShopifyProductPrice(data,url),
   {priceCents:549,scope:'online_unverified',source:'gianttiger-shopify-product'});
 assert.equal(extractShopifyProductPrice(data,'https://www.gianttiger.com/products/oat-drink').priceCents,null);
 assert.equal(extractShopifyProductPrice(data,url.replace('12345678901235','99999999999999')).priceCents,null);
 assert.equal(extractShopifyProductPrice({...data,variants:[{id:1,price:399,available:false}]},url).priceCents,null);
 assert.equal(extractShopifyProductPrice({variants:[{id:1,price:299,available:true}]},
   'https://www.gianttiger.com/products/cereal').priceCents,299);
});
test('JSON-LD is found when HTML script attributes appear in a different order',async()=>{
 const {extractProductPrice}=await import('../catalogue-api.mjs');
 const p=JSON.stringify({'@graph':[{'@type':'Product',name:'Milk',offers:{price:'5.99',priceCurrency:'CAD'}}]});
 const html='<script nonce="xyz" id="structured" type="application/ld+json">'+p+'</script>';
 assert.equal(extractProductPrice(html).priceCents,599);
 const range=JSON.stringify({'@type':'Product',offers:{lowPrice:10,highPrice:19}});
 assert.equal(extractProductPrice('<script type="application/ld+json">'+range+'</script>').priceCents,null);
});


test('read-only catalogue quotes use saved product URL without an owner key',async()=>{
 const {quoteSavedUrls}=await import('../catalogue-api.mjs');
 const oldFetch=globalThis.fetch;
 const urls=[];
 globalThis.fetch=async url=>{
   urls.push(String(url));
   assert.equal(String(url),'https://www.gianttiger.com/products/oat-drink.js');
   return new Response(JSON.stringify({title:'Oat Drink',variants:[
     {id:12345678901234,price:399,available:true},
     {id:12345678901235,price:549,available:true}
   ]}),{headers:{'Content-Type':'application/json'}});
 };
 const db={prepare(sql){
   assert.match(sql,/SELECT \* FROM catalogue_listings WHERE listing_key/);
   return {bind(key){
     assert.equal(key,'gianttiger|online|oat-drink');
     return {first:async()=>({
       price_scope:'online_unverified',
       product_url:'https://www.gianttiger.com/products/oat-drink?variant=12345678901235'
     })};
   }};
 }};
 try{
   const request=new Request('https://grablist.example/api/catalogue/quote',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({keys:['gianttiger|online|oat-drink']})
   });
   const response=await quoteSavedUrls(db,request);
   assert.equal(response.status,200);
   const data=await response.json();
   assert.equal(data.results[0].priceCents,549);
   assert.equal(data.results[0].status,'priced');
   assert.equal(data.results[0].scope,'online_unverified');
   assert.equal(urls.length,1);
 }finally{globalThis.fetch=oldFetch;}
});
test('public quote is bounded and never accepts caller-supplied URLs',async()=>{
 const {quoteSavedUrls}=await import('../catalogue-api.mjs');
 const db={prepare(){throw Error('No DB access expected');}};
 const response=await quoteSavedUrls(db,new Request('https://grablist.example/api/catalogue/quote',{
   method:'POST',body:JSON.stringify({keys:Array.from({length:9},(_,i)=>'key-'+i)})
 }));
 assert.equal(response.status,400);
 const noUrl=await quoteSavedUrls(db,new Request('https://grablist.example/api/catalogue/quote',{
   method:'POST',body:JSON.stringify({url:'https://attacker.example/secret'})
 }));
 assert.equal(noUrl.status,400);
});


test('Loblaw direct product pages expose a price without relying on JSON-LD',async()=>{
 const {extractLoblawVisiblePrice}=await import('../catalogue-api.mjs');
 const url='https://www.nofrills.ca/en/smooth-peanut-butter/p/20132369001_EA';
 const html='<div>Sponsored sale$2.00 was$9.00</div>'+
  '<h1>Smooth Peanut Butter</h1><div>500 g</div><b>$3.75 ea</b>'+
  '<s>$4.49</s><div>Product description</div><div>Other product $1.00 ea</div>';
 assert.deepEqual(extractLoblawVisiblePrice(html,url),
   {priceCents:375,scope:'online_unverified',source:'loblaw-product-page'});
 assert.equal(extractLoblawVisiblePrice(html,
   'https://www.nofrills.ca/en/different-item/p/20132369001_EA').priceCents,null);
 assert.equal(extractLoblawVisiblePrice(html,
   'https://www.nofrills.ca/en/search?q=peanut').priceCents,null);
 assert.equal(extractLoblawVisiblePrice('<h1>Smooth Peanut Butter</h1><p>was $5.99</p>',url).priceCents,null);
});


test('generic 4 L milk only compares ordinary 1% or 2% varieties',()=>{
 const item={name:'Milk',size:'4 L'};
 const product=(productName,size='4 L',masterName='2% Milk')=>({productName,size,masterName});
 assert.equal(compare.productMatch(item,product('Dairyland 2% Milk Partly Skimmed 4 L')),true);
 assert.equal(compare.productMatch(item,product('Farmers 1% Milk Polybag Partly Skimmed 4 L')),true);
 assert.equal(compare.productMatch(item,product('Dairyland 6% Milk 4 L')),false);
 assert.equal(compare.productMatch(item,product('Dairyland 3.25% Homogenized Milk 4 L')),false);
 assert.equal(compare.productMatch(item,product('Walker Farms Protein A2 1% Milk 4 L')),false);
 assert.equal(compare.productMatch(item,product('1% Microfiltered Milk 4 L')),false);
 assert.equal(compare.productMatch(item,product('2% Chocolate Milk 4 L')),false);
 assert.equal(compare.productMatch(item,product('2% Milk 2 L','2 L')),false);
 assert.equal(compare.productMatch({name:'6% Milk',size:'4 L'},product('Dairyland 6% Milk 4 L')),true);
 assert.equal(compare.productMatch({name:'2% Milk',size:'4 L'},product('Dairyland 2% Milk 4 L')),true);
 assert.ok(compare.productRank(item,product('Dairyland 2% Milk 4 L'))>
   compare.productRank(item,product('Dairyland 1% Milk 4 L')));
});
test('generic eggs mean large dozen, and plain loaf means sandwich bread',()=>{
 const egg={name:'Eggs'};
 assert.equal(compare.productMatch(egg,{productName:'Compliments White Eggs Large 12 Count',size:'12 ct'}),true);
 assert.equal(compare.productMatch(egg,{productName:'Compliments White Eggs Medium 12 Count',size:'12 ct'}),false);
 assert.equal(compare.productMatch(egg,{productName:'Compliments White Eggs Extra Large 12 Count',size:'12 ct'}),false);
 assert.equal(compare.productMatch(egg,{productName:'Large Eggs 18 Count',size:'18 ct'}),false);
 assert.equal(compare.productMatch(egg,{productName:'Egg Bread Homemade 525 g',size:'525 g'}),false);
 assert.equal(compare.productMatch({name:'Medium Eggs',size:'12 ct'},
   {productName:'Compliments White Medium Eggs 12 Count',size:'12 ct'}),true);
 assert.equal(compare.productMatch({name:'Bread',size:'1 loaf'},
   {productName:'Compliments Sandwich Bread White 675 g',size:'675 g'}),true);
 assert.equal(compare.productMatch({name:'Bread',size:'1 loaf'},
   {productName:'Artisan Sourdough Bread 600 g',size:'600 g'}),false);
});
test('official page identity and availability must agree with the requested item',async()=>{
 const {extractProductPrice,extractShopifyProductPrice,productTitleCompatible}=await import('../catalogue-api.mjs');
 assert.equal(productTitleCompatible('Candy Mallow 150 g','Candy Mallow 170 g'),false);
 assert.equal(productTitleCompatible('Compliments White Eggs Medium 12 Count',
  'Compliments White Eggs Medium 12 EA'),true);
 assert.equal(extractShopifyProductPrice({title:'Candy Mallow 170 g',
   variants:[{id:11111,price:199,available:true}]},
   'https://www.gianttiger.com/products/mallow','Candy Mallow 150 g').priceCents,null);
 const json=offers=>'<script type="application/ld+json">'+
  JSON.stringify({'@type':'Product',name:'Dairyland 2% Milk 4 L',offers})+'</script>';
 const out=json({price:'6.49',priceCurrency:'CAD',availability:'https://schema.org/OutOfStock'});
 assert.equal(extractProductPrice(out,'Dairyland 2% Milk 4 L').priceCents,null);
 assert.equal(extractProductPrice(json({price:'6.49',priceCurrency:'CAD'}),
  'Dairyland 6% Milk 4 L').priceCents,null);
 assert.equal(extractProductPrice('<h1>Dairyland 6% Milk 4 L</h1>'+
   json({price:'6.49',priceCurrency:'CAD'}),'Dairyland 2% Milk 4 L').priceCents,null);
});
test('same-retailer 307 redirect stays within a product URL and returns online quote',async()=>{
 const {quoteSavedUrls}=await import('../catalogue-api.mjs');
 const oldFetch=globalThis.fetch;
 let hits=0;
 globalThis.fetch=async url=>{
  hits++;
  if(hits===1){
   assert.equal(String(url),'https://www.walmart.ca/en/ip/2-milk/600000001');
   return new Response(null,{status:307,headers:{location:'/en/ip/milk-2-percent/600000001'}});
  }
  assert.equal(String(url),'https://www.walmart.ca/en/ip/milk-2-percent/600000001');
  return new Response('<script type="application/ld+json">'+
    JSON.stringify({'@type':'Product',name:'Dairyland 2% Milk 4 L',offers:{price:'6.49',priceCurrency:'CAD'}})+
    '</script>',{headers:{'Content-Type':'text/html'}});
 };
 const db={prepare:()=>({bind:()=>({first:async()=>({
   price_scope:'online_unverified',product_url:'https://www.walmart.ca/en/ip/2-milk/600000001',
   product_name:'Dairyland 2% Milk 4 L'
 })})})};
 try{
  const response=await quoteSavedUrls(db,new Request('https://grablist.example/api/catalogue/quote',{
   method:'POST',body:JSON.stringify({keys:['walmart|online|milk-2']})
  }));
  const data=await response.json();
  assert.equal(hits,2);
  assert.equal(data.results[0].priceCents,649);
  assert.equal(data.results[0].scope,'online_unverified');
 }finally{globalThis.fetch=oldFetch;}
});
