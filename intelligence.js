/* GrabList product intelligence: pure, conservative matching and price selection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GrabListIntelligence=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clean=x=>String(x||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
const measure=x=>{
 // Keep decimal points: "1.5 L" must not turn into "15 L".
 const s=String(x||'').toLowerCase().trim().replace(/,/g,'.').replace(/\s+/g,'');
 const m=s.match(/^(\d+(?:\.\d+)?)(kg|g|ml|l|lb|oz|ct|count|pack|pk)$/);
 if(!m)return clean(x).replace(/\s+/g,'')||null;
 const n=Number(m[1]),unit=m[2];
 if(unit==='kg')return String(Math.round(n*1000))+'g';
 if(unit==='l')return String(Math.round(n*1000))+'ml';
 if(unit==='lb')return String(Math.round(n*453.592))+'g';
 if(unit==='oz')return String(Math.round(n*28.3495))+'g';
 if(['ct','count','pack','pk'].includes(unit))return String(n)+'ct';
 return String(n)+unit;
};
const ageDays=(date,now=Date.now())=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return Infinity;
 const t=Date.parse(date+'T12:00:00Z');
 return Number.isFinite(t)?Math.max(0,(now-t)/86400000):Infinity;
};
const scopeRank=c=>{
 if(c.scope==='selected_branch')return 0;
 if(c.scope==='observed_branch'){
  // An observed branch in a different province is not automatically the
  // most relevant evidence merely because it is a store-specific price.
  return c.geographicRank===0?0:c.geographicRank===1?1:c.geographicRank===2?4:8;
 }
 return ({
  covered_postal_area:2,nearest_reference_city:3,province_reference:4,
  reference_city:5,canadian_reference:6,national_average:7
 })[c.scope]??9;
};
function assess(item,c,opts={}){
 if(!c||!Number.isFinite(c.price)||c.price<=0)return {ok:false,reason:'invalid_price'};
 if(c.storeId&&opts.enabledStores&&!opts.enabledStores.includes(c.storeId))return {ok:false,reason:'disabled_store'};
 const exactBarcode=Boolean(item.barcode&&c.barcode&&item.barcode===c.barcode&&c.matchType==='barcode');
 if(item.brand&&!exactBarcode){
  // A barcode-confirmed record is the same selected SKU even if the price
  // service omits the brand in its product label.
  if(!c.productName||!(' '+clean(c.productName)+' ').includes(' '+clean(item.brand)+' '))
   return {ok:false,reason:'brand_unverified'};
 }
 if(item.size){
  if(!c.packageSize)return {ok:false,reason:'size_unverified'};
  if(measure(item.size)!==measure(c.packageSize))return {ok:false,reason:'different_size'};
 }else if(c.source==='Statistics Canada')return {ok:false,reason:'size_unspecified'};
 if(c.source==='Statistics Canada'&&c.matchStatus!=='reference_size')return {ok:false,reason:'not_exact_reference'};
 if(c.source==='Open Prices'&&c.matchType!=='barcode')return {ok:false,reason:'name_only_observation'};
 if(c.source==='VynnAI'&&(!item.barcode||c.matchType!=='barcode'||c.barcode!==item.barcode||!c.storeId))
  return {ok:false,reason:'retailer_identity_unverified'};
 if(c.source==='GroceryPulse'&&c.confidence!=='high')return {ok:false,reason:'uncertain_catalog_match'};
 if(c.source!=='Statistics Canada'&&c.source!=='GroceryPulse'&&c.source!=='Open Prices'&&c.confidence!=='high')
  return {ok:false,reason:'unverified_retailer_match'};
 const age=ageDays(c.date,opts.now);
 const maxAge=c.source==='Statistics Canada'?400:c.source==='GroceryPulse'?45:30;
 if(age>maxAge)return {ok:false,reason:'stale_or_undated'};
 return {ok:true,reason:'matched',age,scope:scopeRank(c),sizeConfidence:c.sizeEvidence||'reported'};
}
function select(item,candidates,opts={}){
 const eligible=candidates.map(c=>({candidate:c,assessment:assess(item,c,opts)})).filter(x=>x.assessment.ok);
 const order=opts.storeOrder||[];
 eligible.sort((a,b)=>a.assessment.scope-b.assessment.scope||
  Number(b.candidate.storeId===item.storeId)-Number(a.candidate.storeId===item.storeId)||
  a.candidate.price-b.candidate.price||
  (order.indexOf(a.candidate.storeId)<0?999:order.indexOf(a.candidate.storeId))-
  (order.indexOf(b.candidate.storeId)<0?999:order.indexOf(b.candidate.storeId))||
  a.assessment.age-b.assessment.age);
 return {best:eligible[0]?.candidate||null,eligible,rejected:candidates.length-eligible.length};
}
return {clean,measure,ageDays,assess,select};
});
