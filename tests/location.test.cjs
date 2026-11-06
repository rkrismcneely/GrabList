const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../location.js');
const compare = require('../comparison.js');
const now = Date.UTC(2026,10,6,12);

test('normalizes full Canadian postal codes without guessing from incomplete inputs',()=>{
  assert.equal(geo.normalizePostalCode('k9j7b5'),'K9J 7B5');
  assert.equal(geo.normalizePostalCode(' K9J-7B5 '),'K9J 7B5');
  assert.equal(geo.normalizePostalCode('K9J'),null);
});
test('uses the correct Canadian province prefix and leaves ambiguous territories unknown',()=>{
  const ont=geo.contextForPostalCode('K9J 7B5');
  assert.equal(ont.fsa,'K9J');
  assert.equal(ont.province,'ON');
  assert.equal(ont.cityId,null);
  assert.equal(ont.regionId,null);
  assert.equal(geo.contextForPostalCode('X0A 0H0').province,null);
});
test('favors exact local quote over newer broad quote, but never accepts a mismatched city',()=>{
  const ctx=geo.contextForPostalCode('K9J 7B5',{cityId:'peterborough',regionId:'peterborough-county',preferredBranchIds:{walmart:'west-store'}});
  const mk=(scope,loc,price=4,observedAt=now)=>({storeId:'walmart',price,source:'manual',observedAt,size:'1 L',brand:'',location:{scope,...loc}});
  const item={id:'x',size:'1 L',brand:'',quantity:'1',storeId:'walmart',complete:false,offers:[
    mk('national',{},3),mk('province',{province:'ON'},3.5),mk('region',{regionId:'peterborough-county'},3.9),
    mk('city',{cityId:'peterborough'},4.1),mk('postal',{postalCode:'K9J 7B5'},4.9),
    mk('branch',{branchId:'west-store'},5),mk('city',{cityId:'ottawa'},1)
  ]};
  assert.equal(compare.comparableOffer(item,'walmart',now,ctx).price,5);
  item.offers=item.offers.filter(o=>o.location.scope!=='branch');
  assert.equal(compare.comparableOffer(item,'walmart',now,ctx).price,4.9);
  item.offers=item.offers.filter(o=>o.location.scope!=='postal');
  assert.equal(compare.comparableOffer(item,'walmart',now,ctx).price,4.1);
  item.offers=item.offers.filter(o=>o.location.scope!=='city');
  assert.equal(compare.comparableOffer(item,'walmart',now,ctx).price,3.9);
  item.offers=item.offers.filter(o=>o.location.scope!=='region');
  assert.equal(compare.comparableOffer(item,'walmart',now,ctx).price,3.5);
  item.offers=item.offers.filter(o=>o.location.scope!=='province');
  assert.equal(compare.comparableOffer(item,'walmart',now,ctx).price,3);
});
test('does not use Ontario-specific prices for another province',()=>{
  const ctx=geo.contextForPostalCode('H2X 1Y4');
  assert.equal(geo.offerLocationRank({location:{scope:'province',province:'ON'}},ctx,'walmart'),null);
  assert.equal(geo.offerLocationRank({location:{scope:'national'}},ctx,'walmart'),7);
  assert.equal(geo.offerLocationRank({},ctx,'walmart'),8);
});
test('can find closest branch only when valid geo coordinates are supplied',()=>{
  const sample=geo.nearestBranch({lat:44.3,lon:-78.32},[
    {id:'far',lat:43.65,lon:-79.38},{id:'near',lat:44.31,lon:-78.31}
  ]);
  assert.equal(sample.branch.id,'near');
  assert.equal(geo.nearestBranch(null,[{id:'near',lat:44.31,lon:-78.31}]),null);
});
