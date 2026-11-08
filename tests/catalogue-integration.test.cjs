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
