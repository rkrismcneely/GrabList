const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const delivery=require('../delivery.js');

test('delivery settings save a branch without any URL and preserve platform priority',()=>{
 const elements=new Map();
 const get=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',innerHTML:'',textContent:'',handlers:{},
   addEventListener(name,fn){this.handlers[name]=fn;}
  });
  return elements.get(id);
 };
 let saves=0;
 const state={
  postalCode:'K9J 7B5',
  storeOrderIds:['freshco','nofrills','independent'],
  enabledStoreIds:['freshco','nofrills'],
  deliveryOrder:['doordash','ubereats','instacart'],
  deliveryEnabled:['doordash','ubereats','instacart'],
  deliveryLinks:{},deliveryBranches:{}
 };
 const ST0RES=state.storeOrderIds.map(id=>({id,name:id}));
 const context={
  state,document:{getElementById:get},STORES:ST0RES,
  storeById:id=>ST0RES.find(s=>s.id===id),
  GrabListDelivery:delivery,
  save:()=>{saves++;}
 };
 vm.runInNewContext(read('delivery-settings.js'),context);
 get('settings-button').handlers.click();
 assert.ok(get('delivery-platform-options').innerHTML.includes('DoorDash'));
 assert.ok(get('delivery-platform-options').innerHTML.includes('Uber Eats'));
 get('settings-delivery-store').value='nofrills';
 get('settings-delivery-service').value='doordash';
 get('settings-delivery-service').handlers.change();
 get('settings-delivery-branch').value='No Frills · 1866 Lansdowne St W';
 get('settings-save-delivery').handlers.click();
 assert.equal(state.deliveryBranches['nofrills:doordash'],'No Frills · 1866 Lansdowne St W');
 assert.equal(state.deliveryLinks['nofrills:doordash'],undefined);
 assert.ok(saves>0);
 const move={dataset:{platformMove:'doordash',step:'1'}};
 get('delivery-platform-options').handlers.click({target:{closest:()=>move}});
 assert.deepEqual(Array.from(state.deliveryOrder),['ubereats','doordash','instacart']);
 get('delivery-platform-options').handlers.change({target:{
  dataset:{platformToggle:'instacart'},checked:false,matches:()=>true
 }});
 assert.deepEqual(Array.from(state.deliveryEnabled),['ubereats','doordash']);
});
test('Compare runs automatic public source search but never fetches delivery-platform sites',()=>{
 const index=read('index.html'),pricing=read('pricing-ui.js'),sw=read('sw.js');
 for(const id of ['delivery-platform-options','settings-delivery-store','settings-delivery-branch',
  'settings-delivery-service','settings-delivery-url','compare-auto-results','compare-refresh-prices'])
  assert.ok(index.includes(id),id+' not present in comparison or settings markup');
 assert.ok(index.includes('globalThis.GrabListRunComparison?.()'));
 assert.ok(pricing.includes('async function runFullPriceComparison'));
 assert.ok(pricing.includes('lookupComparisonCandidates(lookup)'));
 assert.ok(pricing.includes('renderDeliveryCompareShortcuts'));
 assert.ok(sw.includes("'./delivery-settings.js'"));
 assert.equal(/fetch\(\s*['"]https:\/\/(?:www\.)?(?:doordash|ubereats|instacart)\./.test(pricing),false);
});
