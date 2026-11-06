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
  const url=new URL(request.url),barcode=String(url.searchParams.get('barcode')||''),name=String(url.searchParams.get('name')||'').trim();
  const byBarcode=/^\d{8,14}$/.test(barcode);
  if(!byBarcode&&!(name.length>=3&&name.length<=70&&/^[\p{L}\p{N} .,'&()-]+$/u.test(name)))
    return responseError('Enter a product name (3–70 characters) or an 8–14 digit barcode.');
  const cutoff=new Date(Date.now()-730*86400000).toISOString().slice(0,10);
  const upstream=new URL('https://prices.openfoodfacts.org/api/v1/prices');
  upstream.searchParams.set(byBarcode?'product_code':'product_name',byBarcode?barcode:name);
  upstream.searchParams.set('currency','CAD');
  upstream.searchParams.set('date__gte',cutoff);
  upstream.searchParams.set('order_by','-date');
  upstream.searchParams.set('size','100');
  const data=await upstreamJson(upstream.toString());
  if(data instanceof Response)return data;
  const records=Array.isArray(data?.items)?data.items:[];
  const matches=records.filter(row=>{
    const loc=row?.location;
    return (row.type==='PRODUCT'||(!byBarcode&&row.type==='CATEGORY'))&&(!byBarcode||row.product_code===barcode)
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
    matchType:row.type==='CATEGORY'?'category':'product',
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
  return json({provider:'Open Prices / Open Food Facts',barcode:byBarcode?barcode:null,searchName:byBarcode?null:name,results:matches,sourceUrl:'https://prices.openfoodfacts.org/',note:'Historical Canadian store observations (up to two years old), not checkout quotes. Older prices can be stale. Data: Open Food Facts contributors, ODbL.',partialPage:Number(data?.pages)>1});
}
// These are reference markets with public coverage, not inferred coordinates or a
// claim that any one store is physically closest. The shopper can see the real city.
const CANADIAN_MARKETS={ON:['Toronto','Ottawa'],QC:['Montreal','Quebec City'],BC:['Vancouver','Victoria'],AB:['Calgary','Edmonton'],SK:['Saskatoon','Regina'],MB:['Winnipeg'],NS:['Halifax'],NB:['Moncton','Fredericton'],PE:['Charlottetown'],NL:["St. John's"]};
function referenceCity(postal){
  if(!postal)return {name:'Toronto',province:'ON',fallback:'canadian_reference'};
  const letter=postal[0],fsa=postal.slice(0,3);
  const province=letter==='K'||letter==='L'||letter==='M'||letter==='N'||letter==='P'?'ON':
    letter==='G'||letter==='H'||letter==='J'?'QC':letter==='V'?'BC':letter==='T'?'AB':
    letter==='S'?'SK':letter==='R'?'MB':letter==='B'?'NS':letter==='E'?'NB':
    letter==='C'?'PE':letter==='A'?'NL':null;
  const markets=CANADIAN_MARKETS[province];
  if(!markets)return {name:'Toronto',province:'ON',fallback:'canadian_reference'};
  let name=markets[0];
  if(province==='ON'&&(fsa.startsWith('K0')||fsa.startsWith('K1')||fsa.startsWith('K2')||fsa.startsWith('K4')))name='Ottawa';
  if(province==='QC'&&fsa.startsWith('G'))name='Quebec City';
  if(province==='BC'&&/^V[89]/.test(fsa))name='Victoria';
  if(province==='AB'&&/^T[456789]/.test(fsa))name='Edmonton';
  if(province==='SK'&&fsa.startsWith('S4'))name='Regina';
  if(province==='NB'&&fsa.startsWith('E3'))name='Fredericton';
  return {name,province,fallback:'province_reference'};
}
async function callPulse(payload){
  const data=await upstreamJson('https://grocerypulse.ca/api/shopper/plan',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  });
  if(!(data instanceof Response))return {data};
  let error;
  try{error=await data.clone().json();}catch{error=null;}
  return {response:data,code:String(error?.error?.code||'')};
}
async function groceryPulse(request){
  if(request.method!=='POST')return responseError('POST required',405);
  if(Number(request.headers.get('content-length'))>7500)return responseError('List too long',413);
  let raw;
  try{raw=await request.text();}catch{return responseError('Could not read request');}
  if(raw.length>7000)return responseError('List too long',413);
  let body;
  try{body=JSON.parse(raw);}catch{return responseError('Invalid JSON');}
  const supplied=String(body?.postalCode||'').trim();
  const postal=supplied?normalizePostal(supplied):null;
  if(supplied&&!postal)return responseError('Invalid Canadian postal code.',400,'invalid_postal_code');
  const lines=String(body?.list||'').trim();
  if(!lines||lines.length>3000||lines.split(/\r?\n/).length>60)return responseError('Choose up to 60 list items.',400,'list_invalid');
  let selected=null;
  if(postal){
    const local=await callPulse({postalCode:postal.slice(0,3),list:lines,language:'en'});
    if(local.data)selected={data:local.data,scope:'covered_postal_area',isFallback:false};
    else if(!['postal_code_not_covered','unsupported_city','invalid_location','invalid_postal_code'].includes(local.code))return local.response;
  }
  if(!selected){
    const fallback=referenceCity(postal);
    const city=await callPulse({city:fallback.name,list:lines,language:'en'});
    if(city.data)selected={data:city.data,scope:fallback.fallback,isFallback:true,referenceMarket:fallback};
    else if(fallback.name!=='Toronto'&&['comparison_unavailable','unsupported_city'].includes(city.code)){
      // No Ontario/other province report currently available. Last resort:
      // Canadian reference market, without pretending it covers the shopper's area.
      const national=await callPulse({city:'Toronto',list:lines,language:'en'});
      if(national.data)selected={data:national.data,scope:'canadian_reference',isFallback:true,referenceMarket:{name:'Toronto',province:'ON'}};
      else return national.response;
    }else return city.response;
  }
  return json({provider:'GroceryPulse',scope:selected.scope,isFallback:selected.isFallback,
    referenceMarket:selected.referenceMarket||null,
    data:selected.data,sourceUrl:'https://grocerypulse.ca/agents',
    note:selected.isFallback?'Reference city prices are not local prices. Provider only tracks 50 products and selected Canadian cities.':'Covered city chain medians, not individual branch quotes.'});
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
