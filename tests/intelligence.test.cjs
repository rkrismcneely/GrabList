const test=require('node:test');
const assert=require('node:assert/strict');
const intelligence=require('../intelligence.js');
const NOW=Date.parse('2026-11-06T12:00:00Z');
const base={name:'Milk',size:'4 L',brand:'',storeId:'freshco'};
const regional={price:6.44,source:'GroceryPulse',scope:'nearest_reference_city',
 date:'2026-11-06',storeId:'freshco',productName:'Milk · 4 L',packageSize:'4 L',
 confidence:'high',sizeEvidence:'requested_exact_catalog_line'};
const national={price:5.50,source:'Statistics Canada',scope:'national_average',
 date:'2026-09-01',productName:'Milk (2 L)',packageSize:'2 L',matchStatus:'different_size'};
test('4 L milk cannot use a 2 L national average',()=>{
 assert.equal(intelligence.assess(base,national,{now:NOW}).reason,'different_size');
 assert.equal(intelligence.select(base,[national,regional],{now:NOW,enabledStores:['freshco']}).best.price,6.44);
});
test('no unspecified size is silently matched to a national pack',()=>{
 assert.equal(intelligence.assess({...base,size:''},national,{now:NOW}).reason,'size_unspecified');
});
test('equivalent units normalize to the same physical amount',()=>{
 assert.equal(intelligence.measure('4 L'),intelligence.measure('4000ml'));
 assert.notEqual(intelligence.measure('2 L'),intelligence.measure('4 L'));
 assert.equal(intelligence.measure('1 kg'),intelligence.measure('1000 g'));
});
test('brand is required only when explicitly specified',()=>{
 assert.equal(intelligence.assess({...base,brand:'Natrel'},regional,{now:NOW}).reason,'brand_unverified');
 assert.equal(intelligence.assess(base,regional,{now:NOW}).ok,true);
});
test('stale and unknown-date regional prices are excluded',()=>{
 assert.equal(intelligence.assess(base,{...regional,date:'2025-01-01'},{now:NOW}).reason,'stale_or_undated');
 assert.equal(intelligence.assess(base,{...regional,date:''},{now:NOW}).reason,'stale_or_undated');
});
test('prefers local evidence to cheaper national averages for exact products',()=>{
 const national4={...national,price:4.99,packageSize:'4 L',matchStatus:'reference_size'};
 assert.equal(intelligence.select(base,[national4,regional],{now:NOW,enabledStores:['freshco']}).best.price,6.44);
});
test('prefer assigned store when two equally geographically relevant prices exist',()=>{
 const other={...regional,storeId:'nofrills',price:6.20};
 assert.equal(intelligence.select(base,[other,regional],{now:NOW,enabledStores:['freshco','nofrills']}).best.storeId,'freshco');
});
test('do not use low-confidence retailer search automatically',()=>{
 const retailer={...regional,source:'Savvi / Apify',confidence:'low'};
 assert.equal(intelligence.assess(base,retailer,{now:NOW}).reason,'unverified_retailer_match');
});
test('disallow disabled stores',()=>{
 assert.equal(intelligence.assess(base,regional,{now:NOW,enabledStores:['walmart']}).reason,'disabled_store');
});

test('exact selected barcode establishes identity even if price feed omits the brand',()=>{
  const item={name:'Marshmallows',size:'400 g',brand:'Jet-Puffed',barcode:'1234567890123',storeId:'walmart'};
  const row={price:3.49,source:'Open Prices',scope:'observed_branch',geographicRank:0,
    date:'2026-11-06',storeId:'walmart',barcode:'1234567890123',matchType:'barcode',
    productName:'Marshmallows',packageSize:'400 g',confidence:'high'};
  assert.equal(intelligence.assess(item,row,{now:NOW,enabledStores:['walmart']}).ok,true);
  assert.equal(intelligence.assess(item,{...row,barcode:'1234567890999'},{now:NOW,enabledStores:['walmart']}).reason,'brand_unverified');
});
test('distant branch observations do not beat locally relevant city price merely for being branch-specific',()=>{
  const reference={...regional,price:6.44,scope:'nearest_reference_city'};
  const distant={...regional,price:5.10,source:'Open Prices',matchType:'barcode',
    barcode:'1234567890123',scope:'observed_branch',geographicRank:3,packageSize:'4 L'};
  const item={...base,barcode:'1234567890123'};
  assert.equal(intelligence.select(item,[distant,reference],{now:NOW,enabledStores:['freshco']}).best.price,6.44);
});
test('exact barcode still rejects a different package size',()=>{
  const item={...base,barcode:'1234567890123'};
  const other={...regional,source:'Open Prices',matchType:'barcode',barcode:item.barcode,
    scope:'observed_branch',geographicRank:0,packageSize:'2 L'};
  assert.equal(intelligence.assess(item,other,{now:NOW,enabledStores:['freshco']}).reason,'different_size');
});

test('decimal quantity equivalence preserves decimal separator',()=>{
 assert.equal(intelligence.measure('1.5 L'),intelligence.measure('1500 mL'));
 assert.equal(intelligence.measure('0.5 kg'),intelligence.measure('500 g'));
 assert.notEqual(intelligence.measure('1.5 L'),intelligence.measure('15 L'));
});

test('automatic list update uses the assigned retailer rather than another store quote',()=>{
 const item={...base,storeId:'freshco'};
 const rival={...regional,storeId:'nofrills',storeName:'No Frills',price:5.50};
 const choice=intelligence.bestForAssignedStore(item,[rival,regional],{
  now:NOW,enabledStores:['nofrills','freshco'],storeOrder:['nofrills','freshco']
 });
 assert.equal(choice.storeId,'freshco');
 assert.equal(choice.price,6.44);
});
test('fallback uses a compatible national average rather than a different retailer price',()=>{
 const item={...base,storeId:'freshco',size:'2 L'};
 const rival={...regional,storeId:'nofrills',packageSize:'2 L',price:4.99};
 const average={...national,packageSize:'2 L',matchStatus:'reference_size'};
 const choice=intelligence.bestForAssignedStore(item,[rival,average],{
  now:NOW,enabledStores:['nofrills','freshco']
 });
 assert.equal(choice.source,'Statistics Canada');
 assert.equal(choice.price,5.50);
 assert.equal(intelligence.bestForAssignedStore(item,[rival],{
  now:NOW,enabledStores:['nofrills','freshco']
 }),null);
});
