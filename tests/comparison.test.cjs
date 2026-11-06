const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../comparison.js');

const NOW = Date.UTC(2026,10,6,12);
function item(id,quantity='1',overrides={}){
  return {id,name:'Milk',storeId:'walmart',size:'1 L',brand:'',quantity,complete:false,
    offers:[{storeId:'walmart',price:5,size:'1000 ml',brand:'',source:'manual',observedAt:NOW},
            {storeId:'nofrills',price:3,size:'1L',brand:'',source:'manual',observedAt:NOW}],
    ...overrides};
}

test('normalizes equivalent metric pack sizes',()=>{
  assert.equal(engine.normalizedSize('1 L'),engine.normalizedSize('1000 ml'));
  assert.equal(engine.normalizedSize('2 kg'),engine.normalizedSize('2000 g'));
  assert.notEqual(engine.normalizedSize('1 L'),engine.normalizedSize('2 L'));
});

test('does not recommend an extra store below the minimum savings',()=>{
  const result=engine.evaluate([item('a')],['walmart','nofrills'],5,NOW);
  assert.equal(result.totalSavings,0);
  assert.deepEqual(result.addedStores,[]);
});

test('can add a new store for combined savings across several items',()=>{
  const result=engine.evaluate([item('a'),item('b'),item('c')],['walmart','nofrills'],5,NOW);
  assert.equal(result.totalSavings,6);
  assert.equal(result.changes.length,3);
  assert.deepEqual(result.addedStores,['nofrills']);
});

test('quantity multiplies the basket savings',()=>{
  const result=engine.evaluate([item('a','3')],['walmart','nofrills'],5,NOW);
  assert.equal(result.totalSavings,6);
});

test('switches within stores already on the route without threshold',()=>{
  const extra=item('b','1',{storeId:'nofrills',offers:[{storeId:'nofrills',price:2,size:'1L',brand:'',source:'manual',observedAt:NOW}]});
  const result=engine.evaluate([item('a'),extra],['walmart','nofrills'],50,NOW);
  assert.equal(result.totalSavings,2);
  assert.deepEqual(result.addedStores,[]);
});

test('excludes observations more than 30 days old',()=>{
  const stale=item('a','1',{offers:item('a').offers.map(o=>({...o,observedAt:NOW-31*86400000}))});
  assert.equal(engine.evaluate([stale],['walmart','nofrills'],0,NOW).eligibleCount,0);
});

test('does not treat unknown or demo prices as usable offers',()=>{
  const unknown=item('a','1',{offers:[],price:null});
  const sample=item('b','1',{offers:[{storeId:'walmart',price:100,size:'1L',source:'demo',observedAt:NOW}]});
  assert.equal(engine.evaluate([unknown,sample],['walmart','nofrills'],0,NOW).eligibleCount,0);
});

test('excludes different item sizes and required brands',()=>{
  const m=item('a','1',{offers:[...item('a').offers.slice(0,1),{storeId:'nofrills',price:1,size:'2L',source:'manual',brand:'',observedAt:NOW}]});
  assert.equal(engine.evaluate([m],['walmart','nofrills'],0,NOW).changes.length,0);
  const branded=item('b','1',{brand:'Natrel',offers:[{storeId:'walmart',price:5,size:'1L',brand:'Natrel',source:'manual',observedAt:NOW},{storeId:'nofrills',price:1,size:'1L',brand:'Other Brand',source:'manual',observedAt:NOW}]});
  assert.equal(engine.evaluate([branded],['walmart','nofrills'],0,NOW).changes.length,0);
});

test('respects explicitly unassigned items and disabled stores',()=>{
  const r=engine.evaluate([item('a','1',{storeManuallyCleared:true})],['walmart','nofrills'],0,NOW);
  assert.equal(r.eligibleCount,0);
  const onlyWalmart=engine.evaluate([item('b')],['walmart'],0,NOW);
  assert.equal(onlyWalmart.changes.length,0);
});
test('prefers top-ranked existing shopping store when comparable prices tie',()=>{
  const a=item('a','1',{offers:[
    {storeId:'walmart',price:5,size:'1L',brand:'',source:'manual',observedAt:NOW},
    {storeId:'nofrills',price:5,size:'1L',brand:'',source:'manual',observedAt:NOW}
  ]});
  const b=item('b','1',{storeId:'nofrills',offers:[
    {storeId:'nofrills',price:3,size:'1L',brand:'',source:'manual',observedAt:NOW}
  ]});
  const result=engine.evaluate([a,b],['nofrills','walmart'],5,NOW);
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].to,'nofrills');
  assert.equal(result.totalSavings,0);
  assert.deepEqual(result.addedStores,[]);
});
test('never adds an unvisited store solely to resolve a price tie',()=>{
  const a=item('a','1',{offers:[
    {storeId:'walmart',price:5,size:'1L',brand:'',source:'manual',observedAt:NOW},
    {storeId:'nofrills',price:5,size:'1L',brand:'',source:'manual',observedAt:NOW}
  ]});
  const result=engine.evaluate([a],['nofrills','walmart'],0,NOW);
  assert.equal(result.changes.length,0);
  assert.deepEqual(result.addedStores,[]);
});
