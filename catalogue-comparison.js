/* Catalogue-only comparator. Never consults legacy item.price, item.offers,
 * Statistics Canada, GroceryPulse or manually recorded prices.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GrabListCatalogueComparison=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  function normalized(value){return String(value||'').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').replace(/[^a-z0-9% ]/g,' ').replace(/\s+/g,' ').trim();}
  function measure(value){
    const m=String(value||'').toLowerCase().trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|lb|lbs|oz|ct|count|pk|pack)$/);
    if(!m)return normalized(value);
    const n=Number(m[1].replace(',','.'));
    const multipliers={kg:1000,g:1,l:1000,ml:1,lb:453.592,lbs:453.592,oz:28.3495,ct:1,count:1,pk:1,pack:1};
    const family={kg:'g',g:'g',l:'ml',ml:'ml',lb:'g',lbs:'g',oz:'g',ct:'ct',count:'ct',pk:'ct',pack:'ct'};
    return Math.round(n*multipliers[m[2]]*100)/100+family[m[2]];
  }
  function productMatch(item,listing){
    if(!item||!listing||!listing.productName)return false;
    if(item.barcode&&(!listing.barcode||item.barcode!==listing.barcode))return false;
    // "1 loaf" is a requested unit count, not a demand for a gram weight.
    // Keep exact measured package sizes (4 L, 675 g, 12 ct, etc.) strict.
    const unitOnly=/^\s*\d+\s*(?:loaf|loaves|item|items|each)\s*$/i.test(String(item.size||''));
    if(item.size&&!unitOnly&&measure(item.size)!==measure(listing.size))return false;
    const q=normalized(item.name),p=normalized(listing.productName+' '+(listing.masterName||''));
    const brand=normalized(item.brand);
    if(brand&&!p.includes(brand)&&normalized(listing.brand)!==brand)return false;
    // Words supplied by the user are product constraints, not hints to ignore.
    const tokens=q.split(' ').filter(t=>t.length>1||/^[0-9]$/.test(t));
    const words=p.split(' ');
    const singular=t=>t.endsWith('ies')?t.slice(0,-3)+'y':t.endsWith('s')?t.slice(0,-1):t;
    if(!tokens.length||!tokens.every(t=>words.includes(t)||words.includes(singular(t))))return false;
    const cases=[
      [/(^| )oat milk($| )/,/(^| )oat milk($| )/],
      [/(^| )almond milk($| )/,/(^| )almond milk($| )/],
      [/(^| )soy milk($| )/,/(^| )(soy|soya) milk($| )/],
      [/(^| )ground coffee($| )/,/(^| )ground coffee($| )/],
      [/(^| )whole wheat($| )/,/(^| )whole wheat($| )/]
    ];
    for(const [request,product] of cases)if(request.test(q)&&!product.test(p))return false;
    if(q==='milk'&&/(oat|almond|soy|soya|chocolate|coconut|condensed|evaporated) milk/.test(p))return false;
    if(q==='bread'&&/\b(flour|crumbs|crumb|maker|knives|knife|sticks|mix)\b/.test(p))return false;
    if((q==='eggs'||q==='egg')&&/\b(chocolate|candy|noodles|salad|rolls|tarts|waffles|muffins|easter)\b/.test(p))return false;
    if((q==='marshmallows'||q==='marshmallow')&&/\b(fluff|spread|creme|cream|candy)\b/.test(p))return false;
    if(q==='coffee'&&/(instant|pods|capsules|k cups|beans|whole bean|decaf)/.test(p))return false;
    if(q==='butter'&&/(peanut|almond|cashew) butter/.test(p))return false;
    if(q==='tomato'||q==='tomatoes')if(/(sauce|paste|soup|juice)/.test(p))return false;
    return true;
  }
  function eligibleOffer(item,listing,selectedBranches){
    return productMatch(item,listing)&&listing.status==='current'&&
      listing.scope==='selected_branch'&&Number.isInteger(listing.priceCents)&&listing.priceCents>0&&
      selectedBranches?.[listing.retailer]===listing.branchId;
  }
  function count(item){
    const v=Number.parseFloat(String(item.quantity||'1'));
    return Number.isFinite(v)&&v>0?v:1;
  }
  function evaluate(items,results,enabledStoreIds,selectedBranches={},minExtraStopSavings=5){
    const list=Array.isArray(items)?items.filter(i=>!i.complete):[];
    const byId=new Map((results||[]).map(r=>[r.id,r.offers||[]]));
    const storeIds=[...new Set(enabledStoreIds||[])];
    const knownStores=new Set(list.filter(i=>storeIds.includes(i.storeId)).map(i=>i.storeId));
    const route=new Set(knownStores);
    const planned=new Map();
    for(const item of list){
      const matches=(byId.get(item.id)||[]).filter(o=>storeIds.includes(o.retailer)&&eligibleOffer(item,o,selectedBranches));
      const best=new Map();
      for(const offer of matches){
        const prev=best.get(offer.retailer);
        if(!prev||prev.priceCents>offer.priceCents)best.set(offer.retailer,offer);
      }
      const base=best.get(item.storeId);
      if(base)planned.set(item.id,{item,from:item.storeId,baseline:base,chosen:base,offers:best});
    }
    const priority=store=>storeIds.indexOf(store);
    const improve=(store)=>{
      for(const p of planned.values()){
        const offer=p.offers.get(store);
        if(!offer)continue;
        if(offer.priceCents<p.chosen.priceCents||
          offer.priceCents===p.chosen.priceCents&&priority(store)<priority(p.chosen.retailer)){
          p.chosen=offer;
        }
      }
    };
    for(const store of route)improve(store);
    const threshold=Math.round(Math.max(0,Number(minExtraStopSavings)||0)*100);
    while(true){
      let best=null;
      for(const store of storeIds){
        if(route.has(store))continue;
        let saving=0;
        for(const p of planned.values()){
          const offer=p.offers.get(store);
          if(offer)saving+=Math.max(0,Math.round((p.chosen.priceCents-offer.priceCents)*count(p.item)));
        }
        if(saving>0&&saving>=threshold&&(!best||saving>best.saving))best={store,saving};
      }
      if(!best)break;
      route.add(best.store);
      improve(best.store);
    }
    const changes=[...planned.values()].filter(p=>p.chosen.retailer!==p.from).map(p=>({
      id:p.item.id,name:p.item.name,from:p.from,to:p.chosen.retailer,
      originalPrice:p.baseline.priceCents/100,newPrice:p.chosen.priceCents/100,
      savings:Math.round((p.baseline.priceCents-p.chosen.priceCents)*count(p.item))/100,
      observedAt:p.chosen.observedAt,source:'catalogue',branchId:p.chosen.branchId
    }));
    return {changes,totalSavings:Math.round(changes.reduce((n,c)=>n+Math.round(c.savings*100),0))/100,
      addedStores:[...route].filter(id=>!knownStores.has(id)),eligibleCount:planned.size,activeCount:list.length};
  }
  return {measure,productMatch,eligibleOffer,evaluate};
});
