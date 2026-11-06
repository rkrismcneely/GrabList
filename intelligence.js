/* GrabList product intelligence: pure, conservative matching and price selection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GrabListIntelligence=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clean=x=>String(x||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
const measure=x=>{
 const s=clean(x).replace(/\s+/g,'');
 const m=s.match(/^(\d+(?:\.\d+)?)(kg|g|ml|l|lb|oz|ct|count|pack|pk)$/);
 if(!m)return s||null;
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
const scopeRank=c=>({
 observed_branch:0,covered_postal_area:1,nearest_reference_city:2,
 province_reference:3,reference_city:4,canadian_reference:5,national_average:6
})[c.scope]??7;
function assess(item,c,opts={}){
 if(!c||!Number.isFinite(c.price)||c.price<=0)return {ok:false,reason:'invalid_price'};
 if(c.storeId&&opts.enabledStores&&!opts.enabledStores.includes(c.storeId))return {ok:false,reason:'disabled_store'};
 if(item.brand){
  // Generic references cannot establish brand. Explicit named-brand product
  // listings must contain the required brand as a separate word sequence.
  if(!c.productName||!(' '+clean(c.productName)+' ').includes(' '+clean(item.brand)+' '))
   return {ok:false,reason:'brand_unverified'};
 }
 if(item.size){
  if(!c.packageSize)return {ok:false,reason:'size_unverified'};
  if(measure(item.size)!==measure(c.packageSize))return {ok:false,reason:'different_size'};
 }else if(c.source==='Statistics Canada')return {ok:false,reason:'size_unspecified'};
 if(c.source==='Statistics Canada'&&c.matchStatus!=='reference_size')return {ok:false,reason:'not_exact_reference'};
 if(c.source==='Open Prices'&&c.matchType!=='barcode')return {ok:false,reason:'name_only_observation'};
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
