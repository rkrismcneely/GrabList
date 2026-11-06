/* GrabList public-price gateway.
   Two explicitly allowlisted providers; no credentials, scraping, analytics, or price database.
   Requests are initiated by the shopper, never scheduled or bulk-crawled. */
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const responseError=(message,status=400,code='invalid_request')=>json({error:{code,message}},status);
async function upstreamJson(url,options={}){
  let response;
  try{
    response=await fetch(url,{...options,headers:{'Accept':'application/json','User-Agent':'GrabList/0.2 (https://github.com/rkrismcneely/GrabList)',...(options.headers||{})},signal:AbortSignal.timeout(12000)});
  }catch{return responseError('The price source could not be reached. Try again later.',503,'source_unavailable');}
  let data;
  try{data=await response.json();}catch{return responseError('The price source returned an unreadable response.',502,'source_response_invalid');}
  if(!response.ok){
    const message=String(data?.error?.message||data?.detail||'Price lookup unavailable.');
    return responseError(message.slice(0,260),response.status===429?429:response.status<500?422:503,String(data?.error?.code||'source_error'));
  }
  return data;
}
function normalizePostal(raw){
  const s=String(raw||'').trim().toUpperCase().replace(/[\s-]/g,'');
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(s)?s:null;
}
async function openPrices(request){
  if(request.method!=='GET')return responseError('GET required',405);
  const url=new URL(request.url),barcode=String(url.searchParams.get('barcode')||'');
  if(!/^\d{8,14}$/.test(barcode))return responseError('An 8–14 digit product barcode is required.');
  const cutoff=new Date(Date.now()-31*86400000).toISOString().slice(0,10);
  const upstream=new URL('https://prices.openfoodfacts.org/api/v1/prices');
  upstream.searchParams.set('product_code',barcode);
  upstream.searchParams.set('currency','CAD');
  upstream.searchParams.set('date__gte',cutoff);
  upstream.searchParams.set('order_by','-date');
  upstream.searchParams.set('size','80');
  const data=await upstreamJson(upstream.toString());
  if(data instanceof Response)return data;
  const records=Array.isArray(data?.items)?data.items:[];
  const matches=records.filter(row=>{
    const loc=row?.location;
    return row.type==='PRODUCT'&&row.product_code===barcode
      &&row.currency==='CAD'&&Number.isFinite(Number(row.price))&&Number(row.price)>=0
      &&loc&&String(loc.osm_address_country_code||'').toUpperCase()==='CA'
      &&typeof row.date==='string'&&row.date>=cutoff
      &&!row.duplicate_of;
  }).slice(0,40).map(row=>({
    price:Number(row.price),currency:'CAD',date:row.date,
    discounted:Boolean(row.price_is_discounted),
    pricePer:String(row.price_per||'UNIT'),
    barcode,
    productName:String(row.product?.product_name||row.product_name||'').slice(0,160),
    productQuantity:String(row.product?.quantity||'').slice(0,40),
    brand:String(row.product?.brands||'').slice(0,100),
    storeName:String(row.location?.osm_brand||row.location?.osm_name||'').slice(0,110),
    storeAddress:String(row.location?.osm_display_name||'').slice(0,200),
    postcode:String(row.location?.osm_address_postcode||'').slice(0,16),
    city:String(row.location?.osm_address_city||'').slice(0,100),
    country:'CA',
    // A price recorded at a particular branch never becomes a provincial/national offer.
    locationScope:'observed_branch',
    sourceUrl:'https://prices.openfoodfacts.org/prices/'+encodeURIComponent(String(row.id))
  }));
  return json({provider:'Open Prices / Open Food Facts',barcode,results:matches,sourceUrl:'https://prices.openfoodfacts.org/',note:'Crowdsourced observations at individual stores, not guaranteed prices at your branch. All prices in CAD. Open Database License (ODbL).',partialPage:Number(data?.pages)>1});
}
async function groceryPulse(request){
  if(request.method!=='POST')return responseError('POST required',405);
  if(Number(request.headers.get('content-length'))>7500)return responseError('List too long',413);
  let raw;
  try{raw=await request.text();}catch{return responseError('Could not read request');}
  if(raw.length>7000)return responseError('List too long',413);
  let body;
  try{body=JSON.parse(raw);}catch{return responseError('Invalid JSON');}
  const postal=normalizePostal(body?.postalCode);
  const lines=String(body?.list||'').trim();
  if(!postal)return responseError('Save a valid Canadian postal code in Settings first.',400,'postal_required');
  if(!lines||lines.length>3000||lines.split(/\r?\n/).length>60)return responseError('Choose up to 60 list items.',400,'list_invalid');
  const storeMap={walmart:'Walmart',nofrills:'No Frills',freshco:'FreshCo',independent:'Your Independent Grocer',gianttiger:'Giant Tiger'};
  // Costco isn't listed in GroceryPulse; do not ask it for an untracked chain.
  const stores=Array.isArray(body.stores)?body.stores.filter(id=>storeMap[id]).map(id=>storeMap[id]).slice(0,10):[];
  const payload={postalCode:postal.slice(0,3),list:lines,language:'en'};
  if(stores.length)payload.stores=stores;
  const data=await upstreamJson('https://grocerypulse.ca/api/shopper/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if(data instanceof Response)return data;
  return json({provider:'GroceryPulse',scope:'city_chain_median',data,sourceUrl:'https://grocerypulse.ca/agents',note:'City-level chain median from sampled online prices, not a branch quote. Review dates, matching and exclusions before acting.'});
}
export default {
  async fetch(request,env){
    const {pathname}=new URL(request.url);
    if(pathname==='/api/pricing/status')return json({ready:true,sources:['open-prices-barcode','grocerypulse-covered-cities'],liveStoreFeeds:false});
    if(pathname==='/api/pricing/open-prices')return openPrices(request);
    if(pathname==='/api/pricing/grocerypulse-plan')return groceryPulse(request);
    if(pathname.startsWith('/api/'))return responseError('Unknown API route',404,'not_found');
    return env.ASSETS.fetch(request);
  }
};
