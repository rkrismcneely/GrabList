/* User-initiated free public price lookups. No automatic scraping or background scans. */
(function(){
'use strict';
const $id=id=>document.getElementById(id);
const money=value=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(value);
const safe=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const status=$id('lookup-item-results');
let lastRequestTime=0;
const cooldown=()=>{const now=Date.now();if(now-lastRequestTime<3000)return false;lastRequestTime=now;return true;};
async function requestJson(url,opts){
  const response=await fetch(url,{...opts,headers:{accept:'application/json',...(opts?.headers||{})},signal:AbortSignal.timeout(18000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.error?.message||'Price source unavailable. '+response.status);
  return data;
}
function quoteLocationRank(result,postal){
  const current=GrabListLocation.normalizePostalCode(postal);
  const observed=GrabListLocation.normalizePostalCode(result.postcode);
  if(current&&observed&&current===observed)return 0;
  if(current&&observed&&current.slice(0,3)===observed.slice(0,3))return 1;
  const currentProvince=GrabListLocation.contextForPostalCode(current).province;
  const observedProvince=GrabListLocation.contextForPostalCode(observed).province;
  if(currentProvince&&observedProvince&&currentProvince===observedProvince)return 2;
  return 3;
}
function locationExplanation(result,postal){
  const rank=quoteLocationRank(result,postal);
  return ['Same postal code — observed at a specific branch','Same postal area — observed at a specific branch','Other branch in your province — reference only','Another Canadian location — reference only'][rank];
}
function quoteHtml(result,postal,queryName){
  const rank=quoteLocationRank(result,postal);
  const name=result.productName||queryName;
  const store=result.storeName||'Store not identified';
  const when=/^\d{4}-\d{2}-\d{2}$/.test(result.date)?result.date:'Date unavailable';
  const quoted=Number(result.price);
  const isPerUnit=result.pricePer==='UNIT';
  const priceLabel=isPerUnit?money(quoted):(money(quoted)+' / '+safe(result.pricePer||'unit'));
  const caution=result.discounted?' · Sale observed (may have ended)':'';
  const url=String(result.sourceUrl||'');
  const sourceLink=url.startsWith('https://prices.openfoodfacts.org/')?'<a href="'+safe(url)+'" target="_blank" rel="noopener noreferrer">View source</a>':'';
  const band=rank<=1?'Nearby observation':'Regional reference';
  return '<article class="source-price-card"><div class="source-price-head"><strong>'+safe(store)+'</strong><b>'+priceLabel+'</b></div><div class="source-price-small">'+safe(name)+(result.productQuantity?' · '+safe(result.productQuantity):'')+(result.brand?' · '+safe(result.brand):'')+'</div><div class="source-price-small">'+safe(locationExplanation(result,postal))+'</div><div class="source-price-small">'+safe(result.storeAddress||result.city||'Canadian location')+'</div><div class="source-price-foot">'+safe(when+caution)+' · '+safe(band)+' · '+sourceLink+'</div></article>';
}
$id('look-up-item-price').addEventListener('click',async()=>{
  if(!cooldown())return;
  const barcode=$id('edit-barcode').value.trim(),name=$id('edit-name').value.trim();
  if(barcode&&!/^\d{8,14}$/.test(barcode)){status.textContent='A barcode must contain 8–14 digits.';return;}
  if(!barcode&&name.length<3){status.textContent='Enter at least 3 characters of the item name or a barcode.';return;}
  const button=$id('look-up-item-price');
  button.disabled=true;button.textContent='Searching…';
  status.textContent='Checking recent Canadian crowdsourced price observations…';
  try{
    const qs=new URLSearchParams(barcode?{barcode}:{name});
    const data=await requestJson('/api/pricing/open-prices?'+qs);
    const results=(Array.isArray(data.results)?data.results:[])
      .sort((a,b)=>quoteLocationRank(a,state.postalCode)-quoteLocationRank(b,state.postalCode)||b.date.localeCompare(a.date));
    status.innerHTML=results.length
      ?'<p class="sheet-help">Open Prices results are <strong>observations at individual stores</strong>, not prices guaranteed at your branch. Confirm the product size, store and date before using them. Data © Open Food Facts contributors, ODbL.</p>'+results.slice(0,20).map(r=>quoteHtml(r,state.postalCode,name)).join('')+(data.partialPage?'<p class="sheet-help">More historical observations may exist; showing only recent matches.</p>':'')
      :'<p class="sheet-help">No recent Canadian price observations matched this '+(barcode?'barcode':'name')+'. Try adding an exact barcode, or enter a price you have checked yourself. No price has been invented.</p>';
  }catch(error){status.innerHTML='<p class="sheet-help">'+safe(error.message)+'. Your saved list was not changed.</p>';}
  finally{button.disabled=false;button.textContent='Search public prices';}
});
function groceryLine(item){
  let label=item.name.trim();
  if(item.size)label+=' '+item.size.trim();
  if(item.brand)label+=' '+item.brand.trim();
  if(item.quantity&&item.quantity!=='1')label=item.quantity+' × '+label;
  return label.replace(/[\r\n]+/g,' ').slice(0,120);
}
const planStatus=$id('online-price-results');
const planButton=$id('search-online-price-button');
planButton.addEventListener('click',async()=>{
  if(!cooldown())return;
  const postal=GrabListLocation.normalizePostalCode(state.postalCode);
  if(!postal){planStatus.textContent='Set your postal code in Settings before checking city-level price comparisons.';return;}
  const list=state.items.filter(item=>!item.complete).slice(0,60).map(groceryLine).join('\n').slice(0,3000);
  if(!list.trim()){planStatus.textContent='Add items to the list first.';return;}
  planButton.disabled=true;planButton.textContent='Checking city coverage…';
  planStatus.textContent='Checking GroceryPulse for dated Canadian store comparisons. Unsupported postal areas will not be substituted with a different city.';
  try{
    const data=await requestJson('/api/pricing/grocerypulse-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      postalCode:postal,list,stores:state.enabledStoreIds
    })});
    const plan=data.data||{},rec=plan.recommendation||{},city=plan.city?.name||'Covered city';
    const lines=Array.isArray(plan.lines)?plan.lines:[],stores=Array.isArray(plan.stores)?plan.stores:[];
    const counted=lines.filter(line=>line.status==='exact').length;
    const excluded=lines.length-counted;
    const storesWithTotals=stores.filter(store=>Number.isFinite(store.totalCad)).slice(0,8);
    const candidates=storesWithTotals.map(store=>'<div class="source-price-card"><div class="source-price-head"><strong>'+safe(store.name||store.key)+'</strong><b>'+money(store.totalCad)+'</b></div><div class="source-price-small">City-level chain median · '+safe(store.totalScope||'Coverage varies')+'</div>'+(store.oldest?'<div class="source-price-small">Observations from '+safe(store.oldest)+' to '+safe(store.newest||store.oldest)+'</div>':'')+'</div>').join('');
    planStatus.innerHTML='<p class="sheet-help"><strong>'+safe(city)+' reference prices</strong> · Checked '+safe(plan.evaluatedOn||'date unavailable')+'. This is not a price quote at your nearest branch.</p>'+
      '<p class="sheet-help">'+counted+' exact matches; '+excluded+' items unmatched or requiring review. Totals may exclude unmatched items.</p>'+
      (rec.explanation?'<p class="sheet-help">'+safe(rec.explanation)+'</p>':'')+
      candidates+(excluded?'<p class="sheet-help">Items without exact matches stay unpriced. No substitutions were applied.</p>':'')+
      '<p class="sheet-help">Source: <a href="https://grocerypulse.ca/agents" target="_blank" rel="noopener noreferrer">GroceryPulse</a>. No store assignments or prices were changed.</p>';
  }catch(error){
    const uncovered=/postal_code_not_covered|does not cover|outside|not covered|unsupported_city/i.test(error.message);
    planStatus.innerHTML='<p class="sheet-help">'+(uncovered
      ?'GroceryPulse does not currently cover your postal area, so no city-level price was substituted. Open Prices barcode/name searches in each item’s Edit screen may still find individual Canadian observations.'
      :safe(error.message)+'. No changes were made to your list.')+'</p>';
  }finally{planButton.disabled=false;planButton.textContent='Check Canadian online prices';}
});
})();
