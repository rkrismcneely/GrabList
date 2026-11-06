/* GrabList public sources — shopper-initiated, attributed reference estimates.
   Never claim these prices are confirmed at the shopper's branch. */
(function(){
'use strict';
const $id=id=>document.getElementById(id);
const money=value=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(value);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\u0027':'&#39;'}[c]));
const status=$id('lookup-item-results');
const nameForCity=d=>String(d?.data?.city?.name||d?.referenceMarket?.name||'Canadian reference city');
let lastRequestTime=0,referenceChoices=[],catalogueChoices=[];
const cooldown=()=>{const now=Date.now();if(now-lastRequestTime<2500)return false;lastRequestTime=now;return true;};
async function requestJson(url,opts={}){
  const {timeoutMs=20000,...fetchOptions}=opts;
  const response=await fetch(url,{...fetchOptions,headers:{accept:'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(timeoutMs)});
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
    pricePer:candidate.pricePer||'UNIT',packageSize:candidate.packageSize||'',
    sizeEvidence:candidate.sizeEvidence||'reported',recordedAt:Date.now()
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
    geographicScore(a)-geographicScore(b)||a.price-b.price||
    storeScore(a)-storeScore(b)||(b.date||'').localeCompare(a.date||'')
  )[0]||null;
}
function candidateCard(candidate,index,item){
  const size=String(candidate.packageSize||'');
  const wanted=String(item?.size||'');
  const mismatch=Boolean(size&&wanted&&GrabListComparison.normalizedSize(size)!==GrabListComparison.normalizedSize(wanted));
  const explanation=candidate.scope==='observed_branch'?'Observed at a particular branch':
    candidate.scope==='national_average'?'Published national average':
    candidate.scope==='nearest_reference_city'?'Nearest tracked reference city':
    candidate.scope==='retailer_search'?'Retailer search result; branch accuracy not guaranteed':
    'City/regional reference; not a local shelf price';
  const confidence=candidate.confidence?' · Match confidence: '+safe(candidate.confidence):'';
  const unit=Number.isFinite(candidate.comparableUnitPrice)&&candidate.comparableBasis?
     ' · '+money(candidate.comparableUnitPrice)+'/'+safe(candidate.comparableBasis):'';
  const reasons=Array.isArray(candidate.mismatchReasons)&&candidate.mismatchReasons.length?
     '<div class="source-price-small">Check: '+safe(candidate.mismatchReasons.join(', '))+'</div>':'';
  return '<article class="source-price-card"><div class="source-price-head"><strong>'+safe(candidate.storeName)+'</strong><b>≈'+money(candidate.price)+'</b></div>'+
    '<div class="source-price-small"><strong>'+safe(candidate.productName||'Reference product')+'</strong>'+
      (size?' · '+safe(size)+(candidate.sizeEvidence==='requested_exact_catalog_line'?' (requested size; retailer pack unverified)':''):' · size not reported')+(candidate.city?' · '+safe(candidate.city):'')+'</div>'+
    '<div class="source-price-small">'+safe(explanation)+confidence+(mismatch?' · Different pack size':'')+unit+'</div>'+reasons+
    '<div class="source-price-foot">'+safe(candidate.date||'Date not reported')+' · '+safe(candidate.source)+
     (candidate.url?' · <a target="_blank" rel="noopener noreferrer" href="'+safe(candidate.url)+'">Source</a>':'')+
     '</div><button type="button" data-use-reference="'+index+'" class="source-price-use">Choose this '+(candidate.storeId?'product / store':'reference')+'</button></article>';
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
  if(result.matchType!=='product'||result.pricePer!=='UNIT')return null;
  if(item.barcode&&item.barcode!==result.barcode)return null;
  const price=Number(result.price);
  const date=offerDate(result.date);
  if(!Number.isFinite(price)||price<=0||!date||Date.now()-Date.parse(date+'T12:00:00Z')>731*86400000)return null;
  const storeId=storeIdForName(result.storeName);
  const catalogVerified=item.barcode&&item.barcode===result.barcode&&item.catalogueSize&&item.size&&
    GrabListIntelligence.measure(item.catalogueSize)===GrabListIntelligence.measure(item.size);
  return {price,source:'Open Prices',date,storeId,storeName:result.storeName||'Observed Canadian store',
    city:result.city||result.storeAddress||'Canada',scope:'observed_branch',geographicRank:rankLocation(result,state.postalCode),url:result.sourceUrl,
    productName:result.productName||item.name,pricePer:'UNIT',
    packageSize:result.productQuantity||(catalogVerified?item.catalogueSize:''),
    sizeEvidence:result.productQuantity?'reported':catalogVerified?'catalogue_barcode':'not_reported',
    barcode:result.barcode||'',confidence:item.barcode?'high':'unverified name match',
    matchType:item.barcode?'barcode':'name'};
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
      productName:item.name+(item.size?' · '+item.size:''),pricePer:'UNIT',
      packageSize:item.size||'',sizeEvidence:'requested_exact_catalog_line',confidence:'high'};
  });
}
function fromNational(payload,item){
  const results=Array.isArray(payload?.results)?payload.results:[];
  return results.map(r=>({
    price:Number(r.price),source:'Statistics Canada',date:String(r.observedAt||''),
    storeId:null,storeName:'Statistics Canada · national average',city:'Canada',
    scope:'national_average',url:r.sourceUrl||'https://www.statcan.gc.ca/en/topics-start/food-price',
    productName:r.productName+' ('+r.pack+')',pricePer:'UNIT',
    packageSize:r.pack,confidence:'reference average',
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

function arrangeChoices(candidates,item){
  const rank=x=>{
    if(x.scope==='observed_branch')return x.geographicRank===0?0:x.geographicRank===1?1:x.geographicRank===2?3:6;
    if(x.scope==='covered_postal_area')return 2;
    if(x.scope==='retailer_search')return 3;
    if(x.scope==='nearest_reference_city')return 4;
    if(x.scope==='province_reference')return 5;
    if(x.scope==='canadian_reference')return 7;
    if(x.scope==='national_average')return 8;
    return 9;
  };
  const pref=id=>{const index=state.storeOrderIds?.indexOf(id)??-1;return index<0?99:index;};
  const confidence=x=>x.confidence==='high'?0:x.confidence==='medium'?1:x.confidence==='low'?2:3;
  const unique=new Map();
  for(const c of candidates){
    const key=[c.source,c.storeId,c.productName,c.packageSize,c.price,c.city].join('|');
    if(!unique.has(key))unique.set(key,c);
  }
  return [...unique.values()].sort((a,b)=>
    rank(a)-rank(b)||confidence(a)-confidence(b)||a.price-b.price||
    pref(a.storeId)-pref(b.storeId)||(b.date||'').localeCompare(a.date||''));
}
function renderChoices(candidates,item){
  referenceChoices=arrangeChoices(candidates,item);
  if(!referenceChoices.length)return '<p class="sheet-help">No confirmed equivalent product with an applicable price was found. Unmatched products are shown as references only.</p>';
  return '<p class="sheet-help"><strong>Select the product you want.</strong> Check the brand, package size, source date and store below. No match is chosen for you.</p>'+
    referenceChoices.map((c,i)=>candidateCard(c,i,item)).join('');
}
function fromSavviResult(data){
  return (Array.isArray(data?.results)?data.results:[]).map(r=>({
    price:Number(r.price),source:'Savvi / Apify',date:r.observedAt||'',
    storeId:r.storeId||null,storeName:r.storeName||r.storeId||'Retailer',
    city:r.branch||data.location||'Canada',scope:'retailer_search',url:r.sourceUrl||'',
    productName:r.productName||'',packageSize:r.packageSize||'',pricePer:'UNIT',
    confidence:r.confidence||'unrated',comparableUnitPrice:r.comparableUnitPrice,
    comparableBasis:r.comparableBasis,mismatchReasons:r.mismatchReasons||[],
    sale:r.sale,availability:r.availability
  })).filter(r=>Number.isFinite(r.price)&&r.price>0);
}
let apifyToken='';
try{apifyToken=sessionStorage.getItem('grablist-apify-token')||'';}catch{}
function showApifyStatus(){
  $id('apify-token-status').textContent=apifyToken?
    'Connected for this browser tab. Savvi lookups use your own Apify credits.':
    'Not connected. Savvi searches are optional and require an Apify account.';
}
$id('settings-button').addEventListener('click',showApifyStatus);
$id('save-apify-token').addEventListener('click',()=>{
  const key=$id('apify-token-input').value.trim();
  if(key.length<20||key.length>500||!/^[A-Za-z0-9_~.-]+$/.test(key)){
    $id('apify-token-status').textContent='Enter a valid Apify API token.';
    return;
  }
  apifyToken=key;
  try{sessionStorage.setItem('grablist-apify-token',apifyToken);}catch{}
  $id('apify-token-input').value='';
  showApifyStatus();
});
$id('clear-apify-token').addEventListener('click',()=>{
  apifyToken='';
  try{sessionStorage.removeItem('grablist-apify-token');}catch{}
  $id('apify-token-input').value='';
  showApifyStatus();
});
$id('look-up-retailer-pages').addEventListener('click',()=>{
 const name=$id('edit-name').value.trim();
 if(name.length<2){status.textContent='Enter a product name first.';return;}
 const query=encodeURIComponent(name);
 const retailers=[
  {id:'nofrills',name:'No Frills',base:'https://www.nofrills.ca'},
  {id:'independent',name:'Your Independent Grocer',base:'https://www.yourindependentgrocer.ca'}
 ].filter(store=>state.enabledStoreIds.includes(store.id));
 if(!retailers.length){status.textContent='Enable No Frills or Independent in My stores first.';return;}
 status.innerHTML='<p class="sheet-help">Open the retailer catalogue to check its displayed products and prices. Select your store on the retailer site first; GrabList does not automatically read or verify these prices. Return here to record a manual price.</p>'+
  retailers.map(store=>'<article class="source-price-card"><strong>'+safe(store.name)+'</strong><div class="source-price-foot"><a href="'+store.base+'/search?search-bar='+query+'" target="_blank" rel="noopener noreferrer">Search '+safe(store.name)+' website</a></div></article>').join('');
});
$id('look-up-savvi-price').addEventListener('click',async()=>{
  if(!cooldown())return;
  const id=$id('edit-id').value,item=state.items.find(i=>i.id===id);
  if(!item)return;
  if(!apifyToken){
    status.textContent='Connect your own Apify token under Settings → Optional Savvi price source.';
    return;
  }
  const retailers=state.enabledStoreIds.filter(id=>id==='nofrills'||id==='independent');
  if(!retailers.length){status.textContent='Enable No Frills or Independent under My stores to use Savvi.';return;}
  const name=$id('edit-name').value.trim(),size=$id('edit-size').value.trim(),brand=$id('edit-brand').value.trim();
  if(name.length<2){status.textContent='Enter an item name first.';return;}
  const query=[name,size,brand].filter(Boolean).join(' ').slice(0,100);
  const button=$id('look-up-savvi-price');
  button.disabled=true;button.textContent='Searching Savvi…';
  referenceChoices=[];
  status.textContent='Running one paid-per-use Savvi search through your own Apify account…';
  try{
    const data=await requestJson('/api/pricing/savvi',{
      method:'POST',headers:{'content-type':'application/json'},timeoutMs:75000,
      body:JSON.stringify({apiToken:apifyToken,query,postalCode:state.postalCode||'',retailers})
    });
    const candidates=fromSavviResult(data);
    status.innerHTML=candidates.length?
      '<p class="sheet-help">Savvi matches may have different brands or pack sizes. Prices are from retailer searches, not guaranteed at checkout. This search may consume Apify credits.</p>'+renderChoices(candidates,item):
      '<p class="sheet-help">Savvi returned no priced products for these stores. Check your Apify run history for coverage and charges.</p>';
  }catch(error){status.textContent='Savvi lookup failed: '+error.message+' Check your Apify usage before retrying.';}
  finally{button.disabled=false;button.textContent='Search Savvi (your Apify credits)';}
});
$id('look-up-item-price').addEventListener('click',async()=>{
  if(!cooldown())return;
  const id=$id('edit-id').value,item=state.items.find(i=>i.id===id);
  if(!item)return;
  const barcode=$id('edit-barcode').value.trim(),name=$id('edit-name').value.trim();
  if(barcode&&!/^\d{8,14}$/.test(barcode)){status.textContent='Enter an 8–14 digit barcode.';return;}
  if(!barcode&&name.length<3){status.textContent='Enter at least 3 letters of the item name.';return;}
  const lookupItem={...item,barcode:barcode||'',name,size:$id('edit-size').value.trim(),brand:$id('edit-brand').value.trim()};
  referenceChoices=[];catalogueChoices=[];
  const button=$id('look-up-item-price');
  button.disabled=true;button.textContent='Searching…';
  status.textContent='Checking Canadian store observations and broader reference prices…';
  const requests=[
    requestJson('/api/pricing/open-prices?'+new URLSearchParams(barcode?{barcode}:{name})),
    getPulse(lookupItem),
    requestJson('/api/pricing/national-reference?'+new URLSearchParams({name,size:lookupItem.size||''})),
    barcode?Promise.resolve({results:[]}):requestJson('/api/pricing/catalog-search?'+new URLSearchParams({name}))
  ];
  const settled=await Promise.allSettled(requests);
  let notes='',candidates=[],errors=[];
  if(settled[0].status==='fulfilled'){
    const results=(Array.isArray(settled[0].value.results)?settled[0].value.results:[])
      .sort((a,b)=>rankLocation(a,state.postalCode)-rankLocation(b,state.postalCode)||(b.date||'').localeCompare(a.date||''));
    const possibles=results.map(r=>fromOpenPrice(lookupItem,r)).filter(Boolean);
    candidates.push(...possibles);
    if(results.length>possibles.length){
      notes+='<p class="sheet-help">Other historical observations (not directly comparable to your requested package):</p>'+
        results.slice(0,8).filter(r=>!possibles.some(p=>p.url===r.sourceUrl)).map(r=>openCard(r,state.postalCode,name)).join('');
    }
  }else errors.push('Open Prices: '+settled[0].reason.message);
  if(settled[1].status==='fulfilled'){
    const result=settled[1].value,city=nameForCity(result),choices=fromGroceryPulse(result,lookupItem);
    candidates.push(...choices);
    if(result.isFallback)notes+='<p class="sheet-help">GroceryPulse reference: '+safe(city)+
       (Number.isFinite(result.referenceMarket?.distanceKm)?' (approximately '+result.referenceMarket.distanceKm+' km straight-line from your postal area)':'')+
       '. These are not prices guaranteed at your store.</p>';
    if(!choices.length&&Array.isArray(result.data?.lines)&&result.data.lines.some(l=>l.status==='closest'))
      notes+='<p class="sheet-help">GroceryPulse has a similar product but cannot confirm the exact variant. It was not priced as your item.</p>';
  }else errors.push('GroceryPulse: '+settled[1].reason.message);
  if(settled[2].status==='fulfilled'){
    const refs=fromNational(settled[2].value,lookupItem);
    candidates.push(...refs.filter(x=>x.matchStatus==='reference_size'));
    for(const r of refs.filter(x=>x.matchStatus==='different_size'))
      notes+='<p class="sheet-help">Statistics Canada average: '+safe(r.productName)+' ≈'+money(r.price)+
        ' (September 2026). Different package size; not assigned automatically.</p>';
  }else errors.push('Statistics Canada: '+settled[2].reason.message);
  let catalogueHtml='';
  if(settled[3].status==='fulfilled'){
    catalogueChoices=(Array.isArray(settled[3].value?.results)?settled[3].value.results:[]).slice(0,12);
    if(catalogueChoices.length){
      catalogueHtml='<details class="catalogue-matches" '+(candidates.length?'':'open')+'><summary>Find exact product · '+catalogueChoices.length+' catalogue options</summary>'+
        '<p class="sheet-help">These are products and barcodes, not price quotes. Choose a variant to check any crowdsourced prices for its exact barcode.</p>'+
        catalogueChoices.map((p,i)=>'<article class="source-price-card"><strong>'+safe(p.productName)+'</strong>'+
          '<div class="source-price-small">'+safe(p.brand||'Brand not recorded')+
          ' · '+safe(p.packageSize||'Size not recorded')+
          ' · '+safe(p.countryCoverage==='canada'?'Listed in Canada':'Canadian availability unconfirmed')+'</div>'+
          '<div class="source-price-foot"><a href="'+safe(p.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Product details</a></div>'+
          '<button type="button" class="source-price-use" data-catalogue-choice="'+i+'">Use this product and check barcode prices</button></article>').join('')+'</details>';
    }
  }else errors.push('Product catalogue: '+settled[3].reason.message);
  const chosen=renderChoices(candidates,item);
  status.innerHTML=chosen+catalogueHtml+notes+
    (errors.length?'<p class="sheet-help">Sources unavailable: '+safe(errors.join(' · '))+'</p>':'');
  button.disabled=false;button.textContent='Search public prices';
});
status.addEventListener('click',async event=>{
  const button=event.target.closest('[data-catalogue-choice]');
  if(!button||button.disabled)return;
  const match=catalogueChoices[Number(button.dataset.catalogueChoice)];
  const item=state.items.find(i=>i.id===$id('edit-id').value);
  if(!match||!item||!(/^\d{8,14}$/.test(match.barcode)))return;
  const previousSize=$id('edit-size').value.trim(),newSize=match.packageSize||'';
  const previousBrand=$id('edit-brand').value.trim();
  if(previousSize&&newSize&&GrabListIntelligence.measure(previousSize)!==GrabListIntelligence.measure(newSize)){
    if(!confirm('This product is '+newSize+' instead of your requested '+previousSize+'. Change the item to '+newSize+'?'))return;
  }
  if(previousBrand&&match.brand&&GrabListIntelligence.clean(previousBrand)!==GrabListIntelligence.clean(match.brand)){
    if(!confirm('This is '+match.brand+', not '+previousBrand+'. Change to the selected product?'))return;
  }
  if(item.price!==null&&item.priceSource==='manual'&&
    !confirm('Choosing a different product clears its previous manually recorded price. Continue?'))return;
  const originalId=item.barcode;
  item.barcode=match.barcode;
  item.catalogueSize=newSize||'';
  if(newSize){item.size=newSize;$id('edit-size').value=newSize;}
  if(match.brand){item.brand=match.brand;$id('edit-brand').value=match.brand;}
  $id('edit-barcode').value=match.barcode;
  if(originalId!==match.barcode&&item.price!==null){
    item.price=null;item.priceSource=null;item.priceEvidence=null;$id('edit-price').value='';
  }
  // Learn only the product type and package size, never an automatic brand lock.
  state.profiles[normalizedKey(item.name)]={department:item.department,size:item.size};
  save();render();
  button.disabled=true;button.textContent='Checking barcode…';
  status.insertAdjacentHTML('afterbegin','<p class="sheet-help">Selected '+safe(match.productName)+
    ' ('+safe(match.barcode)+'). Checking recent Canadian store observations…</p>');
  try{
    const payload=await requestJson('/api/pricing/open-prices?'+new URLSearchParams({barcode:match.barcode}));
    if($id('edit-id').value!==item.id)return;
    const observations=Array.isArray(payload.results)?payload.results:[];
    const priced=observations.map(r=>fromOpenPrice(item,r)).filter(Boolean);
    const best=GrabListIntelligence.select(item,priced,{
      enabledStores:state.enabledStoreIds,storeOrder:state.storeOrderIds
    }).best;
    if(best&&item.price===null)recordReference(item,best);
    status.innerHTML='<p class="sheet-help"><strong>'+safe(match.productName)+'</strong> · '+safe(newSize||'size unconfirmed')+
      (best?' · Best recent recorded price: ≈'+money(best.price):' · No recent Canadian price for this barcode')+
      '. A catalogued product does not guarantee local availability.</p>'+
      (priced.length?renderChoices(priced,item):'<p class="sheet-help">The product identity is saved. You can add a manual price or check again when new observations are published.</p>');
  }catch(error){
    status.insertAdjacentHTML('afterbegin','<p class="sheet-help">Barcode lookup unavailable: '+safe(error.message)+
      '. Your product selection was saved.</p>');
  }finally{button.disabled=false;}
});
status.addEventListener('click',event=>{
  const button=event.target.closest('[data-use-reference]');
  if(!button)return;
  const choice=referenceChoices[Number(button.dataset.useReference)];
  const item=state.items.find(i=>i.id===$id('edit-id').value);
  if(!choice||!item)return;
  const size=String(choice.packageSize||'').trim(),previousSize=$id('edit-size').value.trim();
  if(previousSize&&size&&GrabListComparison.normalizedSize(previousSize)!==GrabListComparison.normalizedSize(size)){
    if(!confirm('This product is '+size+' but your list requests '+previousSize+
       '. Use this product instead and change the item size to '+size+'?'))return;
    item.size=size;$id('edit-size').value=size;
  }
  if(choice.confidence==='low'||choice.confidence==='unverified name match'){
    if(!confirm('This match is not confirmed. Have you checked the exact product and size, and do you want to use this estimate?'))return;
  }
  if(choice.sizeEvidence==='requested_exact_catalog_line'&&
     !confirm('This price comes from an exact catalogue query, but the source did not independently report the package size. Use it as an estimate for '+(choice.packageSize||'this item')+'?'))return;
  // Explicit selection may override a manual/demo price, with confirmation.
  if(item.priceSource==='manual'||item.priceSource==='demo'){
    if(!confirm('Replace your existing price with this unverified reference estimate?'))return;
    item.price=null;item.priceSource=null;
  }
  if(choice.storeId&&state.enabledStoreIds.includes(choice.storeId)){
    item.storeId=choice.storeId;item.storeAutoAssigned=false;item.storeManuallyCleared=false;
    $id('edit-store').value=choice.storeId;editingStoreId=choice.storeId;
  }
  if(recordReference(item,choice)){
    status.insertAdjacentHTML('afterbegin','<p class="sheet-help"><strong>Chosen:</strong> '+
      safe(choice.productName)+' at '+safe(choice.storeName)+' · ≈'+money(choice.price)+
      '. You can still change the store or price in Edit.</p>');
  }
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
// Automatic lookup: prefer an exact, fresh reference for the existing store,
// then another enabled store. Never invent a product, price or local branch.
let autoReferencePending=false;
const attempted=new Map();
const AUTO_RETRY_MS=5*60*1000;
const autoStatus=$id('auto-price-status');
let autoDone=0,autoFound=0,autoTotal=0;
function setAutoStatus(message,refresh=false){
 if(mode!=='shopping'){autoStatus.hidden=true;return;}
 autoStatus.hidden=false;
 autoStatus.textContent=message;
 if(refresh){const button=document.createElement('button');button.type='button';button.textContent='Refresh prices';button.addEventListener('click',()=>{attempted.clear();globalThis.GrabListAutoPrices();});autoStatus.append(' · ',button);}
}
function autoKey(item){
 return [item.name,item.size,item.brand,state.postalCode,(state.enabledStoreIds||[]).join(',')].join('|').toLowerCase();
}
function compatibleAuto(item,candidate){
 return GrabListIntelligence.assess(item,candidate,{enabledStores:state.enabledStoreIds}).ok;
}
function autoPick(item,candidates){
 return GrabListIntelligence.select(item,candidates,{
  enabledStores:state.enabledStoreIds,storeOrder:state.storeOrderIds
 }).best;
}
async function autoPriceOne(item){
 const key=autoKey(item);
 if(Date.now()-(attempted.get(item.id)?.at||0)<AUTO_RETRY_MS&&attempted.get(item.id)?.key===key)return;
 attempted.set(item.id,{key,at:Date.now()});
 const lookup={...item};
 // First get the national average; if a regional match exists, it takes priority.
 const responses=await Promise.allSettled([
   getPulse(lookup),
   requestJson('/api/pricing/national-reference?'+new URLSearchParams({name:lookup.name,size:lookup.size||''}))
 ]);
 const choices=[];
 if(responses[0].status==='fulfilled')choices.push(...fromGroceryPulse(responses[0].value,lookup));
 if(responses[1].status==='fulfilled')choices.push(...fromNational(responses[1].value,lookup));
 const current=state.items.find(i=>i.id===item.id);
 if(!current||current.complete||current.priceSource==='manual'||current.priceSource==='demo')return;
 if(autoKey(current)!==key)return; // Item changed during lookup.
 const chosen=autoPick(current,choices);
 if(!chosen)return;
 // Preserve any user-selected reference. Only replace a national average
 // with a geographically more useful, same-size regional observation.
 if(current.price!==null&&current.priceSource!=='reference')return;
 if(current.price!==null&&current.priceEvidence?.source!=='Statistics Canada')return;
 if(current.price!==null&&chosen.source==='Statistics Canada')return;
 if(recordReference(current,chosen))autoFound++;
}
async function fillMissingPrices(){
 if(autoReferencePending)return;
 const missing=state.items.filter(i=>!i.complete&&
   (i.price===null||(i.priceSource==='reference'&&i.priceEvidence?.source==='Statistics Canada')))
   .filter(i=>!attempted.has(i.id)||attempted.get(i.id).key!==autoKey(i)||
      Date.now()-attempted.get(i.id).at>=AUTO_RETRY_MS).slice(0,20);
 if(!missing.length){
   const unpriced=state.items.filter(i=>!i.complete&&i.price===null).length;
   setAutoStatus(unpriced?unpriced+' item'+(unpriced===1?'':'s')+' still without a matching price.':'Available prices checked.',true);
   return;
 }
 autoReferencePending=true;autoDone=0;autoFound=0;autoTotal=missing.length;
 try{
   setAutoStatus('Finding prices… 0 of '+autoTotal);
   // Two lookups at a time avoids flooding the public reference provider.
   for(let i=0;i<missing.length;i+=2){
     if(mode!=='shopping')break;
     await Promise.allSettled(missing.slice(i,i+2).map(autoPriceOne));
     autoDone+=Math.min(2,missing.length-i);
     setAutoStatus('Finding prices… '+autoDone+' of '+autoTotal);
   }
 }finally{
   autoReferencePending=false;
   const unpriced=state.items.filter(i=>!i.complete&&i.price===null).length;
   setAutoStatus(autoFound+' price'+(autoFound===1?'':'s')+' found'+
      (unpriced?' · '+unpriced+' still unavailable':' · all items priced'),true);
   // Items added during the active batch were not included in its snapshot.
   const remaining=state.items.some(i=>!i.complete&&i.price===null&&
     (!attempted.has(i.id)||attempted.get(i.id).key!==autoKey(i)));
   if(remaining&&mode==='shopping')globalThis.GrabListAutoPrices();
 }
}
let referenceTimer=null;
globalThis.GrabListAutoPrices=()=>{
 if(referenceTimer!==null)clearTimeout(referenceTimer);
 referenceTimer=setTimeout(()=>{referenceTimer=null;fillMissingPrices();},300);
};
$id('shopping-tab').addEventListener('click',()=>globalThis.GrabListAutoPrices());
if(mode==='shopping')globalThis.GrabListAutoPrices();

})();