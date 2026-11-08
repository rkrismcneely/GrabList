// Optional, server-side Canadian price fallback.
// No external URLs, credentials, arbitrary API parameters or provider JSON are
// accepted from a caller. Provider responses are private/no-store and never
// put in Cloudflare's shared cache or D1.
const PROVIDER='https://vynn.ai';
export const VYNN_DAILY_CAP=12;
export const VYNN_MONTHLY_CAP=240;
const STORES=new Set(['nofrills','walmart','freshco','independent','gianttiger']);
const str=(x,n=120)=>typeof x==='string'?x.trim().slice(0,n):'';
const list=(data,keys)=>{
  if(Array.isArray(data))return data;
  for(const key of keys)if(Array.isArray(data?.[key]))return data[key];
  if(data?.data&&data.data!==data)return list(data.data,keys);
  return [];
};
function retailer(value){
  const v=str(value).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(v.includes('nofrills'))return 'nofrills';
  if(v.includes('walmart'))return 'walmart';
  if(v.includes('freshco'))return 'freshco';
  if(v.includes('independentgrocer'))return 'independent';
  if(v.includes('gianttiger'))return 'gianttiger';
  return null;
}
function date(value){
  if(typeof value==='number'&&value>1_000_000_000&&value<4_000_000_000)
    return new Date(value*1000).toISOString();
  const d=Date.parse(str(value,40));
  return Number.isFinite(d)?new Date(d).toISOString():null;
}
function isFresh(timestamp,now){
  const d=Date.parse(timestamp||'');
  return Number.isFinite(d)&&d<=now+5*60*1000&&now-d<=8*86400000;
}
export function parseOntarioStoreCoverage(data,now=Date.now()){
  const stores=list(data,['stores','results','items']);
  const found=[],local=[];
  for(const entry of stores.slice(0,120)){
    const store=entry?.store||entry;
    if(!store||typeof store!=='object')continue;
    if(str(store.province,2).toUpperCase()!=='ON')continue;
    const banner=retailer(store.banner||store.retailer||store.chain);
    if(!banner||!STORES.has(banner))continue;
    const count=Number(store.observations_30d);
    const computed=date(store.observations_computed_at);
    // No count means the store is listed, not that it has usable current data.
    const current=Number.isFinite(count)&&count>0&&computed&&
      now-Date.parse(computed)<=35*86400000;
    const city=str(store.city||store.municipality||'',100);
    const address=str(store.address||store.street_address||'',180);
    const record={retailer:banner,storeId:str(store.store_id||store.id,80),
      city,province:'ON',address,hasRecentObservations:Boolean(current)};
    found.push(record);
    if(/\bpeterborough\b/i.test(city)||(!city&&/\bpeterborough\b/i.test(address)))
      local.push(record);
  }
  return {totalOntarioStores:found.length,peterboroughStores:local,
    peterboroughWithObservations:local.filter(x=>x.hasRecentObservations),
    referenceStores:found};
}
export function parseVynnProductOffers(data,requested,selectedStores,coverage,now=Date.now()){
  const products=list(data,['products','results','items','matches']);
  const nested=data?.data&&typeof data.data==='object'?data.data:data;
  const entries=products.length?products:[nested];
  const result=[];
  for(const entry of entries.slice(0,30)){
    if(!entry||typeof entry!=='object')continue;
    const product=entry.canonical_product||entry.product||entry;
    const name=str(product.display_name||product.product_name||product.name||entry.title,160);
    const productBrand=str(product.brand||product.brands||entry.brand,70);
    const size=str(product.size||product.quantity||product.package_size||entry.package_size,55);
    const barcode=str(product.upc||product.gtin||product.barcode||entry.upc,20);
    let offers=list(entry,['offers','latest_offers','prices']);
    if(!offers.length&&entry.current_price!=null)offers=[entry];
    for(const offer of offers.slice(0,45)){
      if(!offer||typeof offer!=='object')continue;
      const store=offer.store&&typeof offer.store==='object'?offer.store:{};
      const banner=retailer(offer.banner||offer.retailer||offer.retailer_name||offer.chain||store.banner);
      if(!banner||!selectedStores.includes(banner))continue;
      const province=str(offer.province||store.province||'',2).toUpperCase();
      if(province!=='ON')continue;
      const price=Number(offer.current_price??offer.effective_price??offer.price);
      if(!Number.isFinite(price)||price<=0||price>=1000)continue;
      if(offer.currency&&String(offer.currency).toUpperCase()!=='CAD')continue;
      if(/out.of.stock|discontinued|unavailable/i.test(str(offer.availability||offer.stock_status,70)))continue;
      const observedAt=date(offer.observed_at||offer.last_observed_at||offer.collected_at||offer.last_updated||offer.date);
      if(!isFresh(observedAt,now))continue;
      const storeId=str(offer.store_id||store.store_id||store.id,80);
      const knownLocal=coverage?.peterboroughWithObservations?.some(x=>
        x.retailer===banner&&x.storeId&&x.storeId===storeId);
      const productName=str(offer.product_name||name,160);
      const packageSize=str(offer.size||offer.package_size||size,55);
      if(!productName||!packageSize)continue;
      const cents=Math.round(price*100);
      // Stable only within the current lookup; do not treat a provider SKU as
      // a barcode or a cross-retailer product identifier.
      const sku=str(offer.product_id||offer.external_sku||offer.sku||entry.product_id,85);
      const identity=(sku||productName.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,65));
      const key=banner+'|vynn|'+identity+'|'+(storeId||'unknown');
      result.push({key,retailer:banner,branchId:storeId||'reference',
        productName,brand:productBrand,size:packageSize,barcode,
        priceCents:cents,source:'VynnAI reference',scope:knownLocal?'city_reference':'province_reference',
        status:'current',observedAt,lastError:null,url:null,
        storeContext:'',referenceCity:knownLocal?'Peterborough':str(offer.city||store.city,80),
        sourceUrl:'https://vynn.ai/',isProviderReference:true});
    }
  }
  // Only exact product matches in the browser become shown prices. Do not
  // infer type/size, local stock, or brand substitutions on the server.
  return result.slice(0,45);
}
export async function reserveVynnCall(db,now=new Date()){
  const day='vynn-day-'+now.toISOString().slice(0,10);
  const month='vynn-month-'+now.toISOString().slice(0,7);
  await db.prepare('CREATE TABLE IF NOT EXISTS catalogue_provider_budget (bucket TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)').run();
  for(const [bucket,limit] of [[day,VYNN_DAILY_CAP],[month,VYNN_MONTHLY_CAP]]){
    await db.prepare('INSERT OR IGNORE INTO catalogue_provider_budget (bucket,used) VALUES (?,0)').bind(bucket).run();
    const update=await db.prepare('UPDATE catalogue_provider_budget SET used=used+1 WHERE bucket=? AND used<?').bind(bucket,limit).run();
    if(!update?.meta||Number(update.meta.changes)!==1)return false;
  }
  return true;
}
async function providerJson(env,db,url){
  if(!await reserveVynnCall(db))return {error:'free_budget_exhausted'};
  let response;
  try{
    response=await fetch(url,{
      headers:{Accept:'application/json',Authorization:'Bearer '+env.VYNN_API_KEY},
      redirect:'manual',signal:AbortSignal.timeout(12000)
    });
  }catch{return {error:'provider_unreachable'};}
  if(response.status===429)return {error:'provider_quota_exhausted'};
  if(response.status===401||response.status===403)return {error:'provider_key_invalid'};
  if(response.status===404)return {data:{products:[]}};
  if(!response.ok)return {error:'provider_unavailable'};
  if(Number(response.headers.get('content-length'))>300000)return {error:'provider_response_too_large'};
  try{
    const raw=await response.text();
    return raw.length<=300000?{data:JSON.parse(raw)}:{error:'provider_response_too_large'};
  }catch{return {error:'provider_response_invalid'};}
}
export async function vynnFallback(db,env,request){
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'};
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(request.method!=='POST')return json({error:'POST required'},405);
  if(!env.VYNN_API_KEY)return json({configured:false,provider:'VynnAI',results:[],
    reason:'Optional VynnAI API secret has not been configured.'});
  let body;try{const raw=await request.text();body=raw.length<=3500?JSON.parse(raw):null;}catch{}
  if(!body||!Array.isArray(body.items)||body.items.length>3||
     !Array.isArray(body.stores)||body.stores.length>6)
    return json({error:'Provide up to three items and selected stores.'},400);
  const stores=[...new Set(body.stores.filter(s=>STORES.has(s)))];
  const items=body.items.map(x=>({
    id:str(x?.id,100),name:str(x?.name,110),size:str(x?.size,45),
    brand:str(x?.brand,75),barcode:str(x?.barcode,14)
  })).filter(x=>x.id&&x.name.length>=2);
  if(!items.length||!stores.length)return json({configured:true,provider:'VynnAI',results:[],coverage:'no_items'});
  const directory=await providerJson(env,db,PROVIDER+'/v1/stores?province=ON&limit=100&offset=0');
  if(directory.error)return json({configured:true,provider:'VynnAI',results:[],reason:directory.error});
  const coverage=parseOntarioStoreCoverage(directory.data);
  const results=[];
  for(const item of items){
    const barcode=/^\d{8,14}$/.test(item.barcode)?item.barcode:null;
    const endpoint=new URL(PROVIDER+'/v1/products/'+(barcode?'lookup':'search'));
    endpoint.searchParams.set(barcode?'upc':'q',barcode||[item.brand,item.name,item.size].filter(Boolean).join(' ').slice(0,100));
    endpoint.searchParams.set('province','ON');
    endpoint.searchParams.set('limit','20');
    const answer=await providerJson(env,db,endpoint.href);
    results.push({id:item.id,offers:answer.data?
      parseVynnProductOffers(answer.data,item,stores,coverage):[],
      reason:answer.error||null});
    if(answer.error==='provider_quota_exhausted'||answer.error==='free_budget_exhausted')break;
  }
  return json({configured:true,provider:'VynnAI',results,
    coverage:{province:'ON',peterboroughReferenceStores:coverage.peterboroughStores.map(x=>({
      retailer:x.retailer,city:x.city,hasRecentObservations:x.hasRecentObservations
    })),hasPeterboroughCoverage:coverage.peterboroughWithObservations.length>0},
    note:'Reference observations only; not confirmed branch prices or stock. Items without a matching size/variant or date are omitted.'});
}