/* GrabList public sources — shopper-initiated, attributed reference estimates.
   Never claim these prices are confirmed at the shopper's branch. */
(function(){
'use strict';
const $id=id=>document.getElementById(id);
const money=value=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(value);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\u0027':'&#39;'}[c]));
const status=$id('lookup-item-results');
const nameForCity=d=>String(d?.data?.city?.name||d?.referenceMarket?.name||'Canadian reference city');
let lastRequestTime=0,referenceChoices=[];
const cooldown=()=>{const now=Date.now();if(now-lastRequestTime<2500)return false;lastRequestTime=now;return true;};
async function requestJson(url,opts={}){
  const response=await fetch(url,{...opts,headers:{accept:'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.error?.message||'Price source unavailable (HTTP '+response.status+').');
  return data;
}
function rankLocation(result,postal){
  const current=GrabListLocation.normalizePostalCode(postal);
  const observed=GrabListLocation.normalizePostalCode(result.postcode);
  if(current&&observed&&current===observed)return 0;
  if(current&&observed&&current.slice(0,3)===observed.slice(0,3))return 1;
  const a=GrabListLocation.contextForPostalCode(current).province;
  const b=GrabListLocation.contextForPostalCode(observed).province;
  if(a&&b&&a===b)return 2;
  return 3;
}
function locationDescription(result,postal){
  return ['Same postal code · specific observed store','Same postal area · specific observed store','Elsewhere in the province · reference only','Canadian store observation · reference only'][rankLocation(result,postal)];
}
function storeIdForName(value){
  const v=String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  return [
    ['walmart',/walmart/],['nofrills',/nofrills/],['freshco',/freshco/],
    ['independent',/independentgrocer|yourindependent/],['costco',/costco/],
    ['gianttiger',/gianttiger/]
  ].find(([,r])=>r.test(v))?.[0]||null;
}
function offerDate(value){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?value:null;
}
function recordReference(item,candidate){
  if(!item||!candidate||!Number.isFinite(candidate.price)||candidate.price<=0)return false;
  // A manually entered price is a deliberate choice. Never overwrite it.
  if(item.price!==null&&['manual','demo'].includes(item.priceSource))return false;
  item.price=candidate.price;
  item.priceSource='reference';
  item.priceEvidence={
    source:candidate.source,sourceUrl:candidate.url||'',
    observedAt:candidate.date||'',location:candidate.city||'Canada',
    scope:candidate.scope||'reference',storeName:candidate.storeName||'',
    storeId:candidate.storeId||null,productName:candidate.productName||'',
    pricePer:candidate.pricePer||'UNIT',recordedAt:Date.now()
  };
  update();
  const isCurrent=$id('edit-id').value===item.id;
  if(isCurrent){
    $id('edit-price').value=candidate.price.toFixed(2);
    $id('edit-source-note').textContent='Reference estimate from '+candidate.storeName+' ('+candidate.city+'), observed '+(candidate.date||'date unknown')+'. Not your store’s verified shelf price. Editing the amount makes it manual.';
  }
  return true;
}
function chooseCandidate(item,candidates){
  const enabled=new Set(state.enabledStoreIds);
  // Geographical relevance outranks store preference; missing local coverage
  // broadens to a province market, then Canada. No false nearest-branch claim.
  const geographicScore=x=>{
    if(x.scope==='observed_branch'){
      const r=x.geographicRank;
      return r===0?0:r===1?1:r===2?3:6;
    }
    if(x.scope==='covered_postal_area')return 2;
    if(x.scope==='province_reference')return 4;
    if(x.scope==='canadian_reference')return 7;
    if(x.scope==='national_average')return 8;
    return 9;
  };
  const storeScore=x=>x.storeId===item.storeId?0:x.storeId&&enabled.has(x.storeId)?1:2;
  return candidates.slice().sort((a,b)=>
    geographicScore(a)-geographicScore(b)||storeScore(a)-storeScore(b)||
    (b.date||'').localeCompare(a.date||'')||a.price-b.price
  )[0]||null;
}
function candidateCard(candidate,index){
  const distance=candidate.scope==='observed_branch'?'Store observation, not a guaranteed price':candidate.scope==='national_average'?'Published Canadian average, not a local shelf price':'Reference market estimate, not a local shelf price';
  return '<article class="source-price-card"><div class="source-price-head"><strong>'+safe(candidate.storeName)+'</strong><b>≈'+money(candidate.price)+'</b></div>'+
   '<div class="source-price-small">'+safe(candidate.productName||'Reference product')+' · '+safe(candidate.city)+'</div>'+
   '<div class="source-price-small">'+safe(distance)+'</div>'+
   '<div class="source-price-foot">'+safe(candidate.date||'Observation date unavailable')+' · '+safe(candidate.source)+
   (candidate.url? ' · <a target="_blank" rel="noopener noreferrer" href="'+safe(candidate.url)+'">View source</a>':'')+
   ' <button type="button" data-use-reference="'+index+'" class="source-price-use">Use estimate</button></div></article>';
}
function openCard(result,postal,queryName){
  const price=Number(result.price);
  const per=String(result.pricePer||'UNIT');
  const label=per==='UNIT'?money(price):money(price)+' / '+safe(per.toLowerCase());
  const date=offerDate(result.date)||'Date not supplied';
  const url=String(result.sourceUrl||'');
  const sourceLink=url.startsWith('https://prices.openfoodfacts.org/')?'<a href="'+safe(url)+'" target="_blank" rel="noopener noreferrer">View source</a>':'';
  return '<article class="source-price-card"><div class="source-price-head"><strong>'+safe(result.storeName||'Store not identified')+'</strong><b>'+label+'</b></div>'+
   '<div class="source-price-small">'+safe(result.productName||queryName)+' · '+safe(result.productQuantity||'Quantity unconfirmed')+
   (result.matchType==='category'?' · Category observation':'')+'</div>'+
   '<div class="source-price-small">'+safe(locationDescription(result,postal))+'</div>'+
   '<div class="source-price-small">'+safe(result.storeAddress||result.city||'Location on source')+'</div>'+
   '<div class="source-price-foot">'+safe(date)+(result.discounted?' · Sale observed':'')+' · '+sourceLink+'</div></article>';
}
function fromOpenPrice(item,result){
  if(!item.barcode||item.barcode!==result.barcode||result.matchType!=='product'||result.pricePer!=='UNIT')return null;
  const price=Number(result.price);
  const date=offerDate(result.date);
  if(!Number.isFinite(price)||price<=0||!date||Date.now()-Date.parse(date+'T12:00:00Z')>31*86400000)return null;
  const storeId=storeIdForName(result.storeName);
  return {price,source:'Open Prices',date,storeId,storeName:result.storeName||'Observed Canadian store',
    city:result.city||result.storeAddress||'Canada',scope:'observed_branch',geographicRank:rankLocation(result,state.postalCode),url:result.sourceUrl,
    productName:result.productName||item.name,pricePer:'UNIT'};
}
function fromGroceryPulse(payload,item){
  const plan=payload?.data||{},line=Array.isArray(plan.lines)?plan.lines[0]:null;
  if(!line||plan.lines.length!==1||line.status!=='exact')return [];
  const city=nameForCity(payload);
  const stores=Array.isArray(plan.stores)?plan.stores:[];
  return stores.filter(store=>{
    // Single-item total: only accept a full list (one line), not an incomplete subtotal.
    return (store.totalScope==='complete_requested_list'||store.completeRequestedList===true)
      && Number.isFinite(Number(store.totalCad))&&Number(store.totalCad)>0;
  }).map(store=>{
    const d=Array.isArray(store.itemObservationDates)?store.itemObservationDates[0]?.observedAt:null;
    const storeName=String(store.name||store.key||'Tracked store');
    return {price:Number(store.totalCad),source:'GroceryPulse',date:offerDate(d)||offerDate(plan.evaluatedOn),
      storeId:storeIdForName(store.key||storeName),storeName,city,scope:payload.scope||'reference_city',
      url:plan.comparisonUrl||payload.sourceUrl||'https://grocerypulse.ca/agents',
      productName:item.name+(item.size?' · '+item.size:''),pricePer:'UNIT'};
  });
}
function fromNational(payload,item){
  const results=Array.isArray(payload?.results)?payload.results:[];
  return results.map(r=>({
    price:Number(r.price),source:'Statistics Canada',date:String(r.observedAt||''),
    storeId:null,storeName:'Statistics Canada · national average',city:'Canada',
    scope:'national_average',url:r.sourceUrl||'https://www.statcan.gc.ca/en/topics-start/food-price',
    productName:r.productName+' ('+r.pack+')',pricePer:'UNIT',
    matchStatus:r.matchStatus
  })).filter(r=>Number.isFinite(r.price)&&r.price>0);
}
async function getPulse(item){
  const list=[item.name,item.size,item.brand].filter(Boolean).join(' ').slice(0,120);
  return requestJson('/api/pricing/grocerypulse-plan',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({postalCode:state.postalCode||'',list})
  });
}
$id('look-up-item-price').addEventListener('click',async()=>{
  if(!cooldown())return;
  const id=$id('edit-id').value,item=state.items.find(i=>i.id===id);
  if(!item)return;
  const barcode=$id('edit-barcode').value.trim(),name=$id('edit-name').value.trim();
  if(barcode&&!/^\d{8,14}$/.test(barcode)){status.textContent='Enter an 8–14 digit barcode.';return;}
  if(!barcode&&name.length<3){status.textContent='Enter at least 3 letters of the item name.';return;}
  const lookupItem={...item,barcode:barcode||'',name,size:$id('edit-size').value.trim(),brand:$id('edit-brand').value.trim()};
  referenceChoices=[];
  const button=$id('look-up-item-price');
  button.disabled=true;button.textContent='Searching…';
  status.textContent='Checking Canadian store observations and broader reference prices…';
  const requests=[
    requestJson('/api/pricing/open-prices?'+new URLSearchParams(barcode?{barcode}:{name})),
    getPulse(lookupItem),
    requestJson('/api/pricing/national-reference?'+new URLSearchParams({name,size:lookupItem.size||''}))
  ];
  const settled=await Promise.allSettled(requests);
  let html='',candidates=[],sourceErrors=[];
  if(settled[0].status==='fulfilled'){
    const data=settled[0].value;
    const results=(Array.isArray(data.results)?data.results:[])
      .sort((a,b)=>rankLocation(a,state.postalCode)-rankLocation(b,state.postalCode)||(b.date||'').localeCompare(a.date||''));
    if(results.length){
      html+='<p class="sheet-help">Open Prices historical observations. A product or package size may differ from your item. © Open Food Facts contributors (ODbL).</p>'+
        results.slice(0,12).map(r=>openCard(r,state.postalCode,name)).join('');
      candidates.push(...results.map(r=>fromOpenPrice(lookupItem,r)).filter(Boolean));
    }
  }else sourceErrors.push('Open Prices: '+settled[0].reason.message);
  if(settled[1].status==='fulfilled'){
    const result=settled[1].value,city=nameForCity(result);
    const choices=fromGroceryPulse(result,lookupItem);
    if(choices.length){
      html='<p class="sheet-help"><strong>'+safe(city)+' '+(result.isFallback?'reference-market':'covered-city')+' prices</strong>. These are sampled chain medians, not local checkout quotes. Only exact catalogue matches are eligible to estimate an item.</p>'+
        choices.map((c,i)=>candidateCard(c,i)).join('')+html;
      candidates=[...choices,...candidates];
    }else{
      const plan=result.data||{},lines=plan.lines||[];
      if(lines.some(l=>l.status==='closest'))html+='<p class="sheet-help">'+safe(city)+' has a similar product, but not the exact requested variant or pack size. It was not priced as your item.</p>';
      else html+='<p class="sheet-help">No fully matched, priced '+safe(name)+' item in '+safe(city)+' reference-market data.</p>';
    }
  }else sourceErrors.push('GroceryPulse: '+settled[1].reason.message);
  if(settled[2].status==='fulfilled'){
    const national=fromNational(settled[2].value,lookupItem);
    if(national.length){
      const matched=national.filter(x=>x.matchStatus==='reference_size');
      html+='<p class="sheet-help"><strong>Statistics Canada fallback:</strong> monthly nationwide retail averages from September 2026. These describe a standard package, not the shelf price at any particular store.</p>'+
        national.map(n=>n.matchStatus==='different_size'
          ?'<article class="source-price-card"><div class="source-price-head"><strong>'+safe(n.productName)+'</strong><b>'+money(n.price)+'</b></div><div class="source-price-small">Different package size from your item; shown for context only.</div><div class="source-price-foot">September 2026 · Statistics Canada · <a href="'+safe(n.url)+'" target="_blank" rel="noopener noreferrer">View source</a></div></article>'
          :candidateCard(n,candidates.length+matched.indexOf(n))).join('');
      candidates.push(...matched);
    }
  }else sourceErrors.push('Statistics Canada: '+settled[2].reason.message);
  referenceChoices=candidates;
  if(candidates.length){
    const target=state.items.find(i=>i.id===id);
    const best=chooseCandidate(target,candidates);
    if(target&&(target.price===null||target.priceSource==='reference')){
      if(recordReference(target,best)){
        html='<p class="sheet-help"><strong>Estimated '+money(best.price)+'</strong> using '+safe(best.storeName)+' in '+safe(best.city)+'. Your item remains assigned to '+safe(storeById(target.storeId)?.name||'its current store')+'. You can choose a different reference or enter your actual price in Edit.</p>'+html;
      }
    }else html='<p class="sheet-help">Your existing manual/example price was kept. Use a reference below only if you want to replace it.</p>'+html;
  }
  if(!html)html='<p class="sheet-help">No comparable Canadian observation or reference price was found for this item. Try an exact barcode or a more specific product size. No price was made up.</p>';
  if(sourceErrors.length)html+='<p class="sheet-help">Source limitations: '+safe(sourceErrors.join(' · '))+'</p>';
  status.innerHTML=html;
  button.disabled=false;button.textContent='Search public prices';
});
status.addEventListener('click',event=>{
  const button=event.target.closest('[data-use-reference]');
  if(!button)return;
  const choice=referenceChoices[Number(button.dataset.useReference)];
  const item=state.items.find(i=>i.id===$id('edit-id').value);
  if(!choice||!item)return;
  // Explicit selection may override a manual or demonstration price; no price is fabricated.
  if(item.priceSource==='manual'||item.priceSource==='demo'){
    if(!confirm('Replace your existing price with an unverified reference estimate?'))return;
    item.price=null;item.priceSource=null;
  }
  if(recordReference(item,choice))status.insertAdjacentHTML('afterbegin','<p class="sheet-help">Estimate selected: '+money(choice.price)+' from '+safe(choice.storeName)+'.</p>');
});
function groceryLine(item){
  const label=[item.name.trim(),item.size?.trim(),item.brand?.trim()].filter(Boolean).join(' ');
  return (item.quantity&&item.quantity!=='1'?item.quantity+' × ':'')+label.replace(/[\r\n]+/g,' ').slice(0,120);
}
const planStatus=$id('online-price-results'),planButton=$id('search-online-price-button');
planButton.addEventListener('click',async()=>{
  if(!cooldown())return;
  const active=state.items.filter(item=>!item.complete).slice(0,60);
  const list=active.map(groceryLine).join('\n').slice(0,3000);
  if(!list.trim()){planStatus.textContent='Add items to your list first.';return;}
  planButton.disabled=true;planButton.textContent='Checking prices…';
  planStatus.textContent='Checking your area, then broader Canadian reference markets when necessary…';
  try{
    const payload=await requestJson('/api/pricing/grocerypulse-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postalCode:state.postalCode||'',list})});
    const plan=payload.data||{},city=nameForCity(payload),lines=Array.isArray(plan.lines)?plan.lines:[],
      stores=Array.isArray(plan.stores)?plan.stores:[];
    const exact=lines.filter(x=>x.status==='exact').length;
    const enabled=new Set(state.enabledStoreIds.map(id=>id==='independent'?'yourindependentgrocer':id));
    const relevant=stores.filter(s=>enabled.has(String(s.key||'').toLowerCase())&&Number.isFinite(Number(s.totalCad))&&s.totalCad>0).slice(0,8);
    planStatus.innerHTML='<p class="sheet-help"><strong>'+safe(city)+' '+(payload.isFallback?'reference-city':'local-market')+' comparison</strong> · '+safe(plan.evaluatedOn||'date not reported')+'. Store totals may omit unpriced items; no local branch prices are guaranteed.</p>'+
      '<p class="sheet-help">'+exact+' exact matches out of '+active.length+' list items. Others remain unmatched or require confirmation.</p>'+
      (relevant.length?relevant.map(s=>'<article class="source-price-card"><div class="source-price-head"><strong>'+safe(s.name||s.key)+'</strong><b>≈'+money(s.totalCad)+'</b></div><div class="source-price-small">'+safe(s.totalScope==='complete_requested_list'?'Entire matched list':'Only priced items — partial subtotal')+'</div><div class="source-price-foot">'+safe(s.oldest||'No date')+' to '+safe(s.newest||s.oldest||'No date')+'</div></article>').join(''):
      '<p class="sheet-help">No store has a priced total for this list in this reference market. Try searching an individual item in Edit.</p>')+
      '<p class="sheet-help">Source: <a target="_blank" rel="noopener noreferrer" href="https://grocerypulse.ca/agents">GroceryPulse</a>. No store assignments were changed.</p>';
  }catch(error){planStatus.textContent='Comparison source unavailable: '+error.message+'. Try searching individual items.';}
  finally{planButton.disabled=false;planButton.textContent='Check Canadian online prices';}
});
// National averages are public, dated and fetched only from our own Worker.
// One bulk request fills missing staple prices when opening Shop (no third-party
// personal list transfer); city/store observations can replace them later.
let autoReferencePending=false;
async function fillMissingNationalEstimates(){
  if(autoReferencePending)return;
  const missing=state.items.filter(item=>!item.complete&&item.price===null).slice(0,75);
  if(!missing.length)return;
  autoReferencePending=true;
  try{
    const data=await requestJson('/api/pricing/national-reference-list',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({items:missing.map(i=>({id:i.id,name:i.name,size:i.size}))})
    });
    let found=0;
    for(const hit of Array.isArray(data.results)?data.results:[]){
      const item=state.items.find(i=>i.id===hit.id);
      const r=hit.reference;
      if(!item||item.complete||item.price!==null||!r||r.matchStatus!=='reference_size'||!Number.isFinite(r.price)||r.price<=0)continue;
      item.price=r.price;item.priceSource='reference';
      item.priceEvidence={
        source:'Statistics Canada',sourceUrl:r.sourceUrl||'',observedAt:r.observedAt||'',
        location:'Canada',scope:'national_average',
        storeName:'Canadian average (all retailers)',storeId:null,
        productName:r.productName+' ('+r.pack+')',pricePer:'UNIT',recordedAt:Date.now()
      };
      found++;
    }
    if(found)update();
  }catch(error){
    // Missing online estimates must never interrupt adding or shopping.
    console.info('National reference prices unavailable:',error.message);
  }finally{autoReferencePending=false;}
}
let referenceTimer=null;
globalThis.GrabListAutoPrices=()=>{
  if(referenceTimer!==null)clearTimeout(referenceTimer);
  referenceTimer=setTimeout(()=>{referenceTimer=null;fillMissingNationalEstimates();},250);
};
$id('shopping-tab').addEventListener('click',()=>globalThis.GrabListAutoPrices());

})();