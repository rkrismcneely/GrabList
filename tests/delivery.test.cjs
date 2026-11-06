const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../delivery.js');

test('accepts exact delivery storefront links only on approved hosts',()=>{
 assert.equal(D.sanitizeUrl('https://www.doordash.com/convenience/store/freshco-peterborough-40756041/?utm_source=email#abc','doordash',true),
  'https://www.doordash.com/convenience/store/freshco-peterborough-40756041/');
 assert.equal(D.sanitizeUrl('https://www.ubereats.com/ca/store/freshco-brock-george/12345','ubereats',true),
  'https://www.ubereats.com/ca/store/freshco-brock-george/12345');
 assert.equal(D.sanitizeUrl('https://www.instacart.ca/store/loblaws/storefront','instacart',true),
  'https://www.instacart.ca/store/loblaws/storefront');
 for(const url of [
  'http://www.doordash.com/convenience/store/freshco',
  'https://www.doordash.com.evil.test/convenience/store/freshco',
  'https://www.doordash.com/search?search=milk',
  'https://user:pass@www.ubereats.com/ca/store/freshco/123',
  'javascript:alert(1)'
 ])assert.equal(D.sanitizeUrl(url,url.includes('ubereats')?'ubereats':'doordash',true),null);
});
test('extracts one DoorDash-style or Uber Eats price and package size',()=>{
 const d=D.parse('CA$6 44\n4 L\nSealtest Partly Skimmed Milk');
 assert.equal(d.price,6.44);assert.equal(d.size,'4 L');
 assert.equal(D.parse('Sealtest Partly Skimmed Milk (4 L) · $6.44').price,6.44);
});
test('refuses to silently pick sale/regular price or per-weight unit price',()=>{
 const p=D.parse('SALE $6.44 Was $7.49 · Milk (4 L)');
 assert.equal(p.price,null);assert.deepEqual(p.prices,[6.44,7.49]);
 const w=D.parse('CA$6.44/kg · Est 1.3 kg · $8.37 total');
 assert.equal(w.price,8.37);
});
test('does not guess a size if multiple package sizes appear',()=>{
 const p=D.parse('12 ct x 500 ml · $8.99');
 assert.equal(p.size,null);assert.deepEqual(p.sizes,['12 ct','500 ml']);
});
test('supports an explicitly copied numeric price',()=>{
 assert.equal(D.parse('6.44').price,6.44);
 assert.equal(D.parse('5,99').price,5.99);
 assert.deepEqual(D.parse('Milk').prices,[]);
});
