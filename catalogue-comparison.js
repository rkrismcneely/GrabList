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
  function itemKind(item){
    const name=normalized(item?.name);
    if(name==='milk'||name==='regular milk'||name==='dairy milk')return 'standard-milk';
    if((name==='eggs'||name==='egg')&&!item?.size)return 'standard-eggs';
    if(name==='bread'&&(!item?.size||/^\s*\d+\s*(?:loaf|loaves|items?|each)\s*$/i.test(item.size)))return 'standard-bread';
    if(name==='marshmallows'||name==='marshmallow')return 'marshmallows';
    return 'specified';
  }
  function standardMilk(name){
    // A generic 4 L milk request means ordinary cow's milk, 1% or 2%.
    // Never let a 6% specialty, cream, oat drink, or lactose-free premium
    // win merely because it has "milk" and "4 L" in its product title.
    if(/\b(?:oat|almond|soy|soya|coconut|rice|goat|sheep|chocolate|strawberry|vanilla|flavou?red|condensed|evaporated|powdered|buttermilk|coffee|protein|a2|lactose|organic|microfiltered|ultrafiltered|ultra|enriched|fortified|shelf stable|homo|homogenized|whole|skim)\b/.test(name))return false;
    const percents=[...name.matchAll(/(?:^| )(\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1]));
    return percents.length>0&&percents.every(p=>p===1||p===2);
  }
  function standardEggs(name,size){
    if(/\b(?:jumbo|small|extra large|extra-large|xl|liquid|whites|powdered|chocolate|easter|salad|noodles)\b/.test(name))return false;
    const both=name+' '+normalized(size);
    // An unspecified dozen permits standard medium OR large. "Large Eggs"
    // remains strict because it is a specifically named item, not generic.
    return /\b(?:large|medium)\b/.test(name)&&/(?:^| )12\s*(?:ea|ct|pk|pack|count|eggs)?(?: |$)/.test(both);
  }
  function standardBread(name){
    return !/\b(?:flour|crumbs|crumb|mix|sticks|buns|rolls|bagels|pita|naan|tortillas|garlic|keto|gluten free|low carb|sourdough|rye|artisan|focaccia|baguette|panettone|fruit|raisin|dessert|pudding)\b/.test(name);
  }
  function productMatch(item,listing){
    if(!item||!listing||!listing.productName)return false;
    if(item.barcode&&(!listing.barcode||item.barcode!==listing.barcode))return false;
    const unitOnly=/^\s*\d+\s*(?:loaf|loaves|item|items|each)\s*$/i.test(String(item.size||''));
    if(item.size&&!unitOnly&&measure(item.size)!==measure(listing.size))return false;
    // The retailer's actual title is authoritative for product variants;
    // an overly broad master category must never hide an incompatible SKU.
    const q=normalized(item.name),p=normalized(listing.productName);
    const brand=normalized(item.brand);
    if(brand&&!p.includes(brand)&&normalized(listing.brand)!==brand)return false;
    const tokens=q.split(' ').filter(t=>t.length>1||/^[0-9]$/.test(t));
    const words=p.split(' ');
    const singular=t=>t.endsWith('ies')?t.slice(0,-3)+'y':t.endsWith('s')?t.slice(0,-1):t;
    if(!tokens.length||!tokens.every(t=>words.includes(t)||words.includes(singular(t))))return false;
    const kind=itemKind(item);
    if(kind==='standard-milk'&&!standardMilk(p))return false;
    if(kind==='standard-eggs'&&!standardEggs(p,listing.size))return false;
    if(kind==='standard-bread'){
      if(!standardBread(p))return false;
      // "1 loaf" should not compare a 1.4 kg club pack against an ordinary
      // 570–675 g sandwich loaf just because both say bread.
      const grams=measure(listing.size);
      if(/^\d+(?:\.\d+)?g$/.test(grams)){
        const weight=parseFloat(grams);
        if(weight<450||weight>800)return false;
      }
    }
    const cases=[
      [/(^| )oat milk($| )/,/(^| )oat milk($| )/],
      [/(^| )almond milk($| )/,/(^| )almond milk($| )/],
      [/(^| )soy milk($| )/,/(^| )(soy|soya) milk($| )/],
      [/(^| )ground coffee($| )/,/(^| )ground coffee($| )/],
      [/(^| )whole wheat($| )/,/(^| )whole wheat($| )/]
    ];
    for(const [request,product] of cases)if(request.test(q)&&!product.test(p))return false;
    // Explicit percentages, product types, and brands remain constraints.
    if(/\bmilk\b/.test(q)&&q!=='milk'&&/\b(?:oat|almond|soy|soya)\b/.test(q)===false&&
       /\b(?:oat|almond|soy|soya|chocolate|coconut|condensed|evaporated)\b/.test(p) &&
       !/\b(?:oat|almond|soy|soya|chocolate|coconut|condensed|evaporated)\b/.test(q))return false;
    if(q==='coffee'&&/(instant|pods|capsules|k cups|beans|whole bean|decaf)/.test(p))return false;
    if(q==='butter'&&/(peanut|almond|cashew) butter/.test(p))return false;
    if((q==='tomato'||q==='tomatoes')&&/(sauce|paste|soup|juice)/.test(p))return false;
    if(kind==='marshmallows'&&/\b(?:candy|fluff|spread|creme|cream|chocolate|banana|strawberry|flavoured|flavored)\b/.test(p))return false;
    return true;
  }
  function productRank(item,listing){
    if(!productMatch(item,listing))return -Infinity;
    const p=normalized(listing.productName);
    const kind=itemKind(item);
    let rank=100;
    if(item.size&&measure(item.size)===measure(listing.size))rank+=20;
    if(kind==='standard-milk'){
      if(/(?:^| )2\s*%/.test(p))rank+=12;
      if(/(?:^| )1\s*%/.test(p))rank+=10;
      if(/\b(?:partly skimmed|polybag|bag)\b/.test(p))rank+=4;
    }
    if(kind==='standard-eggs'){
      if(/\b(?:organic|omega|free run|free range|enriched|specialty)\b/.test(p))rank-=18;
      if(/\bmedium\b/.test(p))rank-=2;
      if(/\b(?:white|grade a)\b/.test(p))rank+=8;
    }
    if(kind==='standard-bread'){
      if(/\b(?:sandwich|white|whole wheat)\b/.test(p))rank+=10;
      if(/\b(?:thin|thick|multigrain|seeded)\b/.test(p))rank-=4;
    }
    if(kind==='marshmallows'){
      if(/\b(?:regular|white|original)\b/.test(p))rank+=10;
      if(/\bmini\b/.test(p))rank-=12;
    }
    return rank-Math.min(p.length,150)/100;
  }
  // Choose diverse, equivalent SKUs BEFORE hitting retailer pages.
  // A fixed top-three list previously spent all fetches on the same brand or
  // 2% milk and missed cheaper 1%/other-brand alternatives.
  function choosePriceCandidates(item,offers,retailer,preferredKey='',limit=6){
    const take=Math.min(12,Math.max(1,Math.floor(Number(limit)||6)));
    const products=(offers||[]).filter(o=>
      o&&o.retailer===retailer&&o.key&&o.url&&
      o.scope!=='selected_branch'&&productMatch(item,o));
    const kind=itemKind(item);
    const variation=o=>{
      const name=normalized(o.productName);
      let type='standard';
      if(kind==='standard-milk')type=/(?:^| )1\s*%/.test(name)?'1pct':'2pct';
      else if(kind==='standard-eggs')type=/\bmedium\b/.test(name)?'medium':'large';
      else if(kind==='standard-bread')type=/\bwhole wheat\b/.test(name)?'wheat':'white';
      else if(kind==='marshmallows')type=/\bmini\b/.test(name)?'mini':'regular';
      const brand=normalized(o.brand||'')||normalized(o.productName).split(' ')[0]||'generic';
      return type+'|'+brand;
    };
    products.sort((a,b)=>
      Number(b.key===preferredKey)-Number(a.key===preferredKey)||
      Number(b.status==='current'&&Number.isInteger(b.priceCents))-
        Number(a.status==='current'&&Number.isInteger(a.priceCents))||
      ((a.status==='current'&&Number.isInteger(a.priceCents))?a.priceCents:Infinity)-
        ((b.status==='current'&&Number.isInteger(b.priceCents))?b.priceCents:Infinity)||
      Number(Boolean(a.lastError))-Number(Boolean(b.lastError))||
      productRank(item,b)-productRank(item,a)||a.productName.length-b.productName.length);
    const groups=new Map();
    for(const o of products){
      const key=variation(o),arr=groups.get(key)||[];
      arr.push(o);groups.set(key,arr);
    }
    const selected=[],used=new Set(),preferred=products.find(o=>o.key===preferredKey);
    if(preferred){selected.push(preferred);used.add(preferred.key);}
    // One per distinct brand and acceptable variant first, then next-best.
    // Preserve the highest-ranked variants on the first pass but include
    // alternative standards rather than brand-locking from past purchases.
    while(selected.length<take&&[...groups.values()].some(arr=>arr.length)){
      let changed=false;
      for(const arr of groups.values()){
        while(arr.length&&used.has(arr[0].key))arr.shift();
        if(!arr.length)continue;
        const candidate=arr.shift();
        selected.push(candidate);
        used.add(candidate.key);changed=true;
        if(selected.length===take)break;
      }
      if(!changed)break;
    }
    return selected;
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
  return {measure,productMatch,productRank,choosePriceCandidates,eligibleOffer,evaluate};
});
