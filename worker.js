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
// Approximate centroids of GroceryPulse's 16 supported reference cities.
// These are reference markets, not physical store locations.
const REFERENCE_MARKETS=[
  {name:'Vancouver',province:'BC',lat:49.2827,lon:-123.1207},
  {name:'Victoria',province:'BC',lat:48.4284,lon:-123.3656},
  {name:'Calgary',province:'AB',lat:51.0447,lon:-114.0719},
  {name:'Edmonton',province:'AB',lat:53.5461,lon:-113.4938},
  {name:'Saskatoon',province:'SK',lat:52.1332,lon:-106.6700},
  {name:'Regina',province:'SK',lat:50.4452,lon:-104.6189},
  {name:'Winnipeg',province:'MB',lat:49.8951,lon:-97.1384},
  {name:'Toronto',province:'ON',lat:43.6532,lon:-79.3832},
  {name:'Ottawa',province:'ON',lat:45.4215,lon:-75.6972},
  {name:'Montreal',province:'QC',lat:45.5017,lon:-73.5673},
  {name:'Quebec City',province:'QC',lat:46.8139,lon:-71.2080},
  {name:'Moncton',province:'NB',lat:46.0878,lon:-64.7782},
  {name:'Fredericton',province:'NB',lat:45.9636,lon:-66.6431},
  {name:'Halifax',province:'NS',lat:44.6488,lon:-63.5752},
  {name:'Charlottetown',province:'PE',lat:46.2382,lon:-63.1311},
  {name:"St. John's",province:'NL',lat:47.5615,lon:-52.7126}
];
function greatCircleKm(a,b){
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function marketSlug(name){
  return {'Quebec City':'quebec-city',"St. John's":'st-johns'}[name]||
    name.toLowerCase().replace(/[^a-z]+/g,'-').replace(/^-|-$/g,'');
}
async function rankedReferenceMarkets(postal){
  if(!postal)return [{...referenceCity(null),selectionMethod:'default_without_postal'}];
  // GeoNames via Zippopotam uses Canada's first three postal characters only.
  // Never transmit the full postal code or treat this centroid as an exact address.
  try{
    const fsa=postal.slice(0,3);
    const res=await fetch('https://api.zippopotam.us/CA/'+encodeURIComponent(fsa),{
      headers:{Accept:'application/json'},signal:AbortSignal.timeout(6000)
    });
    if(res.ok){
      const info=await res.json();
      const places=Array.isArray(info.places)?info.places:[];
      const coords=places.map(p=>({lat:Number(p.latitude),lon:Number(p.longitude)}))
        .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=40&&p.lat<=85&&p.lon>=-142&&p.lon<=-52);
      if(coords.length){
        const position=coords[0];
        return REFERENCE_MARKETS.map(city=>({
          name:city.name,province:city.province,distanceKm:Math.round(greatCircleKm(position,city)),
          selectionMethod:'postal_area_centroid'
        })).sort((a,b)=>a.distanceKm-b.distanceKm);
      }
    }
  }catch{}
  // Do not claim closest when the FSA centroid could not be obtained.
  return [{...referenceCity(postal),selectionMethod:'province_fallback_unverified'}];
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
    const candidates=await rankedReferenceMarkets(postal);
    // Query the geographically closest covered city first. If the provider rejects
    // that city, try another; never silently relabel its prices as the shopper's area.
    for(const city of candidates.slice(0,4)){
      const answer=await callPulse({city:marketSlug(city.name),list:lines,language:'en'});
      if(answer.data){
        selected={data:answer.data,scope:city.selectionMethod==='postal_area_centroid'?'nearest_reference_city':
          (city.selectionMethod==='default_without_postal'?'canadian_reference':'province_reference'),
          isFallback:true,referenceMarket:city};
        break;
      }
      if(!['comparison_unavailable','unsupported_city','invalid_location','city_not_covered'].includes(answer.code))return answer.response;
    }
    if(!selected)return responseError('No supported Canadian reference city returned this list.',422,'reference_market_unavailable');
  }
  return json({provider:'GroceryPulse',scope:selected.scope,isFallback:selected.isFallback,
    referenceMarket:selected.referenceMarket||null,
    data:selected.data,sourceUrl:'https://grocerypulse.ca/agents',
    note:selected.isFallback?'Reference city prices are not local prices. Provider only tracks 50 products and selected Canadian cities.':'Covered city chain medians, not individual branch quotes.'});
}

// Published September 2026 Canada-wide averages, not current local checkout quotes.
// Source: Statistics Canada Table 18-10-0245-01, official Food Price Data Hub.
// Snapshot is intentionally dated, rather than fabricated or presented as live.
const STATS_CANADA_SEPTEMBER_2026=[
  {key:'milk',test:/\bmilk\b/i,not:/chocolate|almond|oat|coconut|powder|infant/i,name:'Milk, 2 litres',pack:'2 L',price:5.50},
  {key:'bread',test:/\b(white bread|bread)\b/i,not:/whole wheat|wholemeal|rye|sourdough|gluten.free/i,name:'White bread, 675 grams',pack:'675 g',price:3.58},
  {key:'rice',test:/\b(white rice|rice)\b/i,not:/brown|wild|instant|basmati/i,name:'White rice, 2 kilograms',pack:'2 kg',price:9.35},
  {key:'butter',test:/\bbutter\b/i,not:/peanut|almond|apple|margarine/i,name:'Butter, 454 grams',pack:'454 g',price:5.58},
  {key:'groundbeef',test:/\b(ground beef|minced beef)\b/i,name:'Ground beef, per kilogram',pack:'1 kg',price:16.92},
  {key:'chicken',test:/\bchicken (breast|breasts)\b/i,name:'Chicken breasts, per kilogram',pack:'1 kg',price:14.48},
  {key:'eggs',test:/\b(egg|eggs)\b/i,not:/chocolate|easter|eggplant|noodle/i,name:'Eggs, 1 dozen',pack:'12 ct',price:4.83},
  {key:'apples',test:/\b(apple|apples)\b/i,not:/juice|sauce|cider|pie/i,name:'Apples, per kilogram',pack:'1 kg',price:4.79},
  {key:'bananas',test:/\b(banana|bananas)\b/i,not:/bread|chips|smoothie/i,name:'Bananas, per kilogram',pack:'1 kg',price:1.88},
  {key:'potatoes',test:/\b(potato|potatoes)\b/i,not:/chips|fries|mashed|hash brown/i,name:'Potatoes, per kilogram',pack:'1 kg',price:5.12},
  {key:'tomatoes',test:/\b(tomato|tomatoes)\b/i,not:/canned|diced|paste|sauce|soup/i,name:'Tomatoes, per kilogram',pack:'1 kg',price:4.71},
  {key:'oil',test:/\b(vegetable oil|cooking oil)\b/i,name:'Vegetable oil, 3 litres',pack:'3 L',price:9.24}
];
function normalMeasure(value){
  const m=String(value||'').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?|grams?|ct|count|eggs?)$/);
  if(!m)return '';
  const n=Number(m[1]),u=m[2];
  if(u==='kg')return n*1000+'g';
  if(u==='l'||u.startsWith('litre'))return n*1000+'ml';
  if(u.startsWith('egg')||u==='ct'||u==='count')return n+'ct';
  return n+(u.startsWith('gram')?'g':u);
}
function governmentMatch(name,size){
  const record=STATS_CANADA_SEPTEMBER_2026.find(r=>r.test.test(name)&&!(r.not&&r.not.test(name)));
  if(!record)return null;
  return {
    price:record.price,currency:'CAD',productName:record.name,pack:record.pack,
    matchStatus:!size||normalMeasure(size)===normalMeasure(record.pack)?'reference_size':'different_size',
    requestedSize:size||null,observedAt:'2026-09',sourceMonth:'September 2026',
    city:'Canada',storeName:'Canadian average (all retailers)',
    sourceUrl:'https://www.statcan.gc.ca/en/topics-start/food-price',
    sourceTable:'18-10-0245-01'
  };
}
async function governmentList(request){
  if(request.method!=='POST')return responseError('POST required',405);
  let input;
  try{const text=await request.text();if(text.length>12000)return responseError('Too many items',413);
    input=JSON.parse(text);}catch{return responseError('Invalid JSON');}
  if(!Array.isArray(input?.items)||input.items.length>75)return responseError('Choose up to 75 list items');
  const results=input.items.map(x=>{
    const id=String(x?.id||'').slice(0,100),name=String(x?.name||'').slice(0,110),size=String(x?.size||'').slice(0,40);
    const match=governmentMatch(name,size);
    return id&&name&&match&&match.matchStatus==='reference_size'?{id,reference:match}:null;
  }).filter(Boolean);
  return json({provider:'Statistics Canada',scope:'national_average',results});
}
function governmentReference(request){
  if(request.method!=='GET')return responseError('GET required',405);
  const url=new URL(request.url),name=String(url.searchParams.get('name')||'').trim().slice(0,110);
  const size=String(url.searchParams.get('size')||'').trim().slice(0,40);
  if(name.length<3)return responseError('A product name is required.');
  const reference=governmentMatch(name,size);
  return json({provider:'Statistics Canada',scope:'national_average',results:reference?[reference]:[]});
}
export default {
  async fetch(request,env){
    const {pathname}=new URL(request.url);
    if(pathname==='/api/pricing/status')return json({ready:true,sources:['open-prices-barcode','grocerypulse-reference-cities','statistics-canada-national-averages'],liveStoreFeeds:false});
    if(pathname==='/api/pricing/open-prices')return openPrices(request);
    if(pathname==='/api/pricing/grocerypulse-plan')return groceryPulse(request);
    if(pathname==='/api/pricing/national-reference')return governmentReference(request);
    if(pathname==='/api/pricing/national-reference-list')return governmentList(request);
    if(pathname.startsWith('/api/'))return responseError('Unknown API route',404,'not_found');
    return env.ASSETS.fetch(request);
  }
};
