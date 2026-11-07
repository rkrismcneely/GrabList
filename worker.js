/* GrabList price gateway: public sources plus optional user-keyed providers.
   Fixed upstream destinations; no platform API keys or shared provider caches.
   User-funded searches are explicit or require the shopper's opt-in. */
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
  if(!byBarcode&&!(name.length>=3&&name.length<=70&&/^[\p{L}\p{N} %.,'&()/-]+$/u.test(name)))
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

// A public catalogue is useful for resolving product variants and barcodes,
// but catalogue records DO NOT contain live prices.
const CATALOG_CACHE=new Map();
let catalogLastSearch=0;
async function catalogSearch(request){
  if(request.method!=='GET')return responseError('GET required',405);
  const url=new URL(request.url),term=String(url.searchParams.get('name')||'').trim();
  if(term.length<3||term.length>80||!(/^[\p{L}\p{N} %,.'()&/-]+$/u.test(term)))
    return responseError('Enter a product name between 3 and 80 characters.');
  const key=term.toLowerCase().replace(/\s+/g,' ');
  const cached=CATALOG_CACHE.get(key);
  if(cached&&cached.expires>Date.now())return json(cached.data);
  // Open Food Facts: 10 search queries/min/IP. This in-isolate limiter is an
  // additional courtesy, not an infrastructure-wide guarantee.
  if(Date.now()-catalogLastSearch<7500)
    return responseError('Catalogue search is cooling down. Try again shortly.',429,'catalog_cooldown');
  catalogLastSearch=Date.now();
  const upstream=new URL('https://world.openfoodfacts.org/cgi/search.pl');
  upstream.searchParams.set('search_terms',term);
  upstream.searchParams.set('search_simple','1');
  upstream.searchParams.set('action','process');
  upstream.searchParams.set('json','1');
  upstream.searchParams.set('page_size','24');
  upstream.searchParams.set('fields','code,product_name,product_name_en,brands,quantity,countries_tags');
  const data=await upstreamJson(upstream.toString());
  if(data instanceof Response)return data;
  const products=Array.isArray(data?.products)?data.products:[];
  const tokens=key.toLowerCase().split(/\s+/).filter(x=>x.length>2);
  const candidates=products.filter(p=>
    /^\d{8,14}$/.test(String(p?.code||''))&&
    (p.product_name||p.product_name_en)&&
    tokens.some(t=>String(p.product_name||p.product_name_en).toLowerCase().includes(t))
  ).map(p=>{
    const countries=Array.isArray(p.countries_tags)?p.countries_tags:[];
    return {
      barcode:String(p.code),productName:String(p.product_name_en||p.product_name).slice(0,140),
      brand:String(p.brands||'').split(',')[0].trim().slice(0,75),
      packageSize:String(p.quantity||'').slice(0,45),
      countryCoverage:countries.some(v=>v==='en:canada')?'canada':
        countries.length?'other_countries':'unknown',
      source:'Open Food Facts catalogue',
      sourceUrl:'https://world.openfoodfacts.org/product/'+String(p.code)
    };
  });
  candidates.sort((a,b)=>
    (a.countryCoverage==='canada'?0:1)-(b.countryCoverage==='canada'?0:1)||
    tokens.filter(t=>b.productName.toLowerCase().includes(t)).length-
      tokens.filter(t=>a.productName.toLowerCase().includes(t)).length
  );
  const result={provider:'Open Food Facts',priceSource:false,results:candidates.slice(0,16),
    note:'Product catalogue only. Barcodes, labels and package sizes are crowdsourced; they are not store availability or price evidence. Data © Open Food Facts contributors, ODbL.'};
  CATALOG_CACHE.set(key,{data:result,expires:Date.now()+10*60000});
  if(CATALOG_CACHE.size>80)CATALOG_CACHE.delete(CATALOG_CACHE.keys().next().value);
  return json(result);
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
    matchStatus:!size?'size_unspecified':normalMeasure(size)===normalMeasure(record.pack)?'reference_size':'different_size',
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
// Optional Savvi/Apify integration. Every request is user-initiated and charged to
// the shopper's own Apify account, never to the GrabList site owner. The token is
// not saved on the Worker or sent back to the browser.
async function savviLookup(request){
  if(request.method!=='POST')return responseError('POST required',405);
  let raw;
  try{raw=await request.text();}catch{return responseError('Unreadable request',400);}
  if(raw.length>5500)return responseError('Request too long',413);
  let body;
  try{body=JSON.parse(raw);}catch{return responseError('Invalid JSON',400);}
  const token=String(body?.apiToken||'').trim(),query=String(body?.query||'').trim();
  const postal=body?.postalCode?normalizePostal(body.postalCode):null;
  if(token.length<20||token.length>500||!(/^[A-Za-z0-9_~.-]+$/).test(token))
    return responseError('Connect your own Apify API token in Settings.',400,'apify_token_required');
  if(query.length<2||query.length>100)return responseError('Enter a product name between 2 and 100 characters.',400);
  if(body.postalCode&&!postal)return responseError('Invalid Canadian postal code',400);
  // Savvi supports these GrabList stores; Walmart/FreshCo/Giant Tiger are not
  // included by this actor. Costco uses a separate actor and is not requested.
  const storeMap={nofrills:'nofrills',independent:'independent'};
  const retailers=[...new Set((Array.isArray(body.retailers)?body.retailers:[])
    .filter(id=>storeMap[id]).map(id=>storeMap[id]))];
  if(!retailers.length)return responseError('Enable No Frills or Independent to search Savvi.',422,'no_supported_stores');
  const input={queries:[query],retailers,outputMode:'comparison',
    maxResultsPerQueryPerRetailer:5,minMatchConfidence:'low',includeSummaries:false};
  if(postal)input.postal_code=postal;
  let response;
  try{
    response=await fetch('https://api.apify.com/v2/acts/sunny_eternity~canada-grocery-price-comparison/run-sync-get-dataset-items',{
      method:'POST',headers:{Accept:'application/json','content-type':'application/json',
        Authorization:'Bearer '+token},
      body:JSON.stringify(input),signal:AbortSignal.timeout(65000)
    });
  }catch{return responseError('Savvi timed out or could not be reached. Check your Apify account for run costs before trying again.',503,'savvi_unavailable');}
  if(!response.ok){
    // Never expose upstream response text: it might contain token details.
    return responseError(response.status===401||response.status===403?
      'Apify rejected the token or has insufficient permissions.':
      response.status===402||response.status===429?'Apify usage quota or spending limit reached.':
      'Savvi was not available; check Apify run history and usage.',response.status===401?401:503,'savvi_source_error');
  }
  let data;
  try{data=await response.json();}catch{return responseError('Savvi returned an unreadable response',502);}
  const rows=Array.isArray(data)?data:[];
  const prices=rows.filter(row=>row&&row._type==='comparison'&&retailers.includes(String(row.retailer||''))
    &&Number.isFinite(Number(row.price))&&Number(row.price)>0
    &&String(row.currency||'CAD').toUpperCase()==='CAD')
    .slice(0,40).map(row=>{
      const source=String(row.source_url||'');
      const allowedUrl=/^https:\/\/(?:www\.)?(?:nofrills\.ca|independentgrocer\.ca|yourindependentgrocer\.ca|realcanadiansuperstore\.ca|loblaws\.ca)\//i.test(source)?source.slice(0,500):null;
      const when=String(row.scraped_at||'');
      return {price:Number(row.price),storeId:row.retailer,storeName:String(row.banner||row.retailer||'').slice(0,70),
        branch:String(row.store||'').slice(0,90),branchId:String(row.store_id||'').slice(0,70),
        productName:String(row.matched_product||'').slice(0,140),
        packageSize:String(row.package_size||'').slice(0,50),
        comparableUnitPrice:Number.isFinite(Number(row.comparable_unit_price))?Number(row.comparable_unit_price):null,
        comparableBasis:String(row.comparable_unit_basis||'').slice(0,15),
        isComparable:Boolean(row.is_comparable_unit_price),
        confidence:['high','medium','low'].includes(row.match_confidence)?row.match_confidence:'unrated',
        score:Number.isFinite(Number(row.match_score))?Number(row.match_score):null,
        matchReasons:Array.isArray(row.match_reasons)?row.match_reasons.slice(0,6).map(x=>String(x).slice(0,50)):[],
        mismatchReasons:Array.isArray(row.mismatch_reasons)?row.mismatch_reasons.slice(0,6).map(x=>String(x).slice(0,50)):[],
        observedAt:/^\d{4}-\d{2}-\d{2}/.test(when)?when.slice(0,10):null,
        sale:Boolean(row.is_on_sale),availability:String(row.availability||'unknown').slice(0,30),
        sourceUrl:allowedUrl,scope:'retailer_search',currency:'CAD'};
    });
  return json({provider:'Savvi via Apify',chargedTo:'user_apify_account',results:prices,
    searchedStores:retailers,location:postal||'unspecified',note:'User-funded lookup, product matching is not guaranteed. Confirm variant, package, location and observed date before choosing.'});
}

// User-owned price-source adapters. No site-owner keys, shared cache, or
// background polling. Credentials only travel in explicit POST bodies from the
// user's session to the fixed allowlisted upstream and never enter logs/output.
const API_PROVINCES={A:'NL',B:'NS',C:'PE',E:'NB',G:'QC',H:'QC',J:'QC',K:'ON',L:'ON',M:'ON',N:'ON',P:'ON',R:'MB',S:'SK',T:'AB',V:'BC',Y:'YT'};
function provinceForPostal(value){
  const postal=normalizePostal(value);
  return postal?API_PROVINCES[postal[0]]||null:null;
}
function plain(value,max=160){return String(value??'').trim().slice(0,max);}
function validKey(token){
  return token.length>=20&&token.length<=500&&/^[A-Za-z0-9._~-]+$/.test(token);
}
async function readSmallJson(request,max=4000){
  let raw;
  try{raw=await request.text();}catch{return null;}
  if(raw.length>max)return null;
  try{return JSON.parse(raw);}catch{return null;}
}
function dated(value){
  const str=plain(value,32);
  return /^\d{4}-\d{2}-\d{2}/.test(str)?str.slice(0,10):null;
}
function nameToGrabListStore(banner){
  const key=plain(banner,100).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(key.includes('nofrills'))return 'nofrills';
  if(key.includes('independentgrocer')||key==='independent')return 'independent';
  if(key.includes('walmart'))return 'walmart';
  if(key.includes('freshco'))return 'freshco';
  if(key.includes('costco'))return 'costco';
  if(key.includes('gianttiger'))return 'gianttiger';
  return null;
}
function findRows(source,keys){
  if(Array.isArray(source))return source;
  for(const key of keys)if(Array.isArray(source?.[key]))return source[key];
  if(source?.data&&source.data!==source)return findRows(source.data,keys);
  return [];
}
function vynnResults(data,searchType,query,requestedProvince){
  const products=findRows(data,['products','results','items','matches']);
  const entries=products.length?products:[data?.data&&typeof data.data==='object'?data.data:data];
  const rows=[];
  for(const entry of entries.slice(0,24)){
    if(!entry||typeof entry!=='object')continue;
    const product=entry.canonical_product||entry.product||entry;
    const name=plain(product.display_name||product.product_name||product.name||entry.title,150);
    const barcode=plain(product.upc||product.gtin||product.barcode||entry.upc,20);
    const size=plain(product.size||product.quantity||product.package_size||entry.package_size,45);
    const brand=plain(product.brand||product.brands||entry.brand,65);
    const nested=findRows(entry,['offers','latest_offers','prices','observations']);
    const offers=nested.length?nested:(entry.current_price!=null?[entry]:[]);
    // A catalogue-only row cannot be used as a price. Show only priced offers.
    for(const offer of offers.slice(0,30)){
      if(!offer||typeof offer!=='object')continue;
      const price=Number(offer.current_price??offer.effective_price??offer.price);
      if(!Number.isFinite(price)||price<=0||price>10000)continue;
      if(offer.currency&&String(offer.currency).toUpperCase()!=='CAD')continue;
      const offerProvince=plain(offer.province||offer.store?.province,2).toUpperCase();
      if(offerProvince&&offerProvince!==requestedProvince)continue;
      const banner=plain(offer.banner||offer.retailer||offer.retailer_name||offer.chain,100);
      const store=offer.store&&typeof offer.store==='object'?offer.store:{};
      const oBarcode=plain(offer.upc||offer.gtin||barcode,20);
      const oSize=plain(offer.size||offer.package_size||size,45);
      rows.push({
        price,source:'VynnAI',storeId:nameToGrabListStore(banner),storeName:banner||'Canadian reference retailer',
        storeIdentifier:plain(offer.store_id||store.id,80),
        storeAddress:plain(offer.store_address||store.address,150),
        city:plain(offer.city||store.city,90),
        province:plain(offer.province||store.province,2),
        productName:plain(offer.product_name||name,150),
        brand,barcode:oBarcode,packageSize:oSize,
        observedAt:dated(offer.observed_at||offer.last_observed_at||offer.collected_at||offer.last_updated||offer.date),
        sale:Boolean(offer.is_on_sale||offer.on_sale),
        currency:'CAD',scope:'province_reference',
        matchType:searchType==='barcode'&&oBarcode===query?'barcode':'name',
        confidence:searchType==='barcode'&&oBarcode===query?'high':'unverified',
        sourceUrl:'https://vynn.ai/'
      });
    }
  }
  return rows.slice(0,50);
}
async function vynnLookup(request){
  if(request.method!=='POST')return responseError('POST required',405);
  const body=await readSmallJson(request,4000);
  if(!body)return responseError('Invalid request',400);
  const token=plain(body.apiToken,500);
  if(!validKey(token))return responseError('Connect your own VynnAI API key in Settings.',400,'vynn_key_required');
  const barcode=plain(body.barcode,20);
  const query=plain(body.query,100);
  if(!(/^\d{8,14}$/.test(barcode))&&(query.length<3||query.length>100))
    return responseError('Enter a product name or barcode.',400);
  if(body.postalCode&&!normalizePostal(body.postalCode))return responseError('Invalid Canadian postal code.',400);
  const province=provinceForPostal(body.postalCode);
  if(!province)return responseError('Save a Canadian postal code with an identifiable province in Settings first.',400,'province_required');
  const byBarcode=/^\d{8,14}$/.test(barcode);
  const endpoint=new URL('https://vynn.ai/v1/products/'+(byBarcode?'lookup':'search'));
  endpoint.searchParams.set(byBarcode?'upc':'q',byBarcode?barcode:query);
  endpoint.searchParams.set('limit','20');
  if(province)endpoint.searchParams.set('province',province);
  let response;
  try{response=await fetch(endpoint.toString(),{
    headers:{Accept:'application/json',Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(14000),redirect:'manual'
  });}catch{return responseError('VynnAI could not be reached. No prices were changed.',503,'vynn_unavailable');}
  if(response.status===404)return json({provider:'VynnAI',results:[],province,sourceUrl:'https://vynn.ai/',note:'No matching product recorded.'});
  if(response.status===401||response.status===403)return responseError('VynnAI rejected this API key. Verify it in your account.',401,'vynn_key_invalid');
  if(response.status===429)return responseError('VynnAI rate or monthly quota limit reached. Check your account before retrying.',429,'vynn_quota');
  if(!response.ok)return responseError('VynnAI could not return a price search right now.',503,'vynn_unavailable');
  let data;
  try{data=await response.json();}catch{return responseError('VynnAI returned unreadable JSON.',502,'vynn_invalid_response');}
  const results=vynnResults(data,byBarcode?'barcode':'name',byBarcode?barcode:query,province);
  return json({provider:'VynnAI',results,province,chargedTo:'user_vynn_account',
    sourceUrl:'https://vynn.ai/',note:'Province-scoped reference store offers, not guaranteed prices at your own nearest branch. Undated or unverified matches require review.'});
}
const REEF_BANNERS={nofrills:'nofrills',independent:'independent'};
function reefBranchRows(data,storeId){
  const rows=findRows(data,['stores','results','items','locations']);
  return rows.slice(0,40).map(v=>{
    const lat=Number(v.lat??v.latitude??v.coordinates?.latitude);
    const lon=Number(v.lon??v.lng??v.longitude??v.coordinates?.longitude);
    return {
      id:plain(v.store_id||v.id||v.storeNumber,75),
      name:plain(v.name||v.store_name||v.display_name,100),
      address:plain(v.address||v.street_address||v.full_address,160),
      city:plain(v.city,70),
      postalCode:plain(v.postal_code||v.postalCode,16),
      lat:Number.isFinite(lat)&&lat>=40&&lat<=85?lat:null,
      lon:Number.isFinite(lon)&&lon>=-142&&lon<=-52?lon:null,
      distanceKm:v.distance_km!==null&&v.distance_km!==undefined&&Number.isFinite(Number(v.distance_km))?Number(v.distance_km):null,
      storeId
    };
  }).filter(v=>v.id);
}
function reefSearchRows(data,storeId,branchId){
  const rows=findRows(data,['products','results','items','listings']);
  return rows.slice(0,40).map(row=>{
    const price=Number(row.price?.value??row.price?.amount??row.price);
    const name=plain(row.name||row.product_name||row.title||row.display_name,150);
    const barcode=plain(row.gtin||row.upc||row.ean||row.barcode,20);
    const date=dated(row.price_date||row.last_updated||row.observed_at);
    return {
      price,source:'ReefAPI Loblaw',storeId,
      storeName:storeId==='nofrills'?'No Frills':'Your Independent Grocer',
      branchId,productName:name,brand:plain(row.brand,70),
      packageSize:plain(row.pack_size||row.package_size||row.size||row.quantity,45),
      barcode,date,observedAt:date,
      currentPriceIsEstimate:Boolean(row.price_is_estimate),
      priceScope:'selected_branch',scope:'selected_branch',
      originalPrice:row.original_price!=null&&Number.isFinite(Number(row.original_price))?Number(row.original_price):null,
      memberPrice:row.member_price!=null&&Number.isFinite(Number(row.member_price))?Number(row.member_price):null,
      sale:Boolean(row.deal?.type==='sale'||row.sale),
      stock:plain(row.stock_status,35),
      sourceUrl:(()=>{
        const candidate=plain(row.url||row.product_url,250);
        try{
          const u=new URL(candidate);
          return u.protocol==='https:'&&['www.nofrills.ca','nofrills.ca',
            'www.yourindependentgrocer.ca','yourindependentgrocer.ca',
            'www.independentgrocer.ca','independentgrocer.ca'].includes(u.hostname)?u.href:'';
        }catch{return '';}
      })(),
      currency:'CAD',
      confidence:'unverified',sizeEvidence:'retailer_catalogue'
    };
  }).filter(r=>r.productName&&Number.isFinite(r.price)&&r.price>0&&r.price<10000);
}
async function reefLookup(request,mode){
  if(request.method!=='POST')return responseError('POST required',405);
  const body=await readSmallJson(request,4000);
  if(!body)return responseError('Invalid request',400);
  const token=plain(body.apiToken,500),storeId=plain(body.storeId,40);
  if(!validKey(token))return responseError('Connect your own ReefAPI key in Settings.',400,'reef_key_required');
  if(!REEF_BANNERS[storeId])return responseError('Select No Frills or Independent.',400,'reef_store_invalid');
  const query=plain(body.query,100),branchId=plain(body.branchId,70);
  if(mode==='search'&&(query.length<2||!branchId||!/^[A-Za-z0-9_-]{1,70}$/.test(branchId)))
    return responseError('Select a specific retailer branch in Settings and enter an item.',400,'reef_branch_required');
  const postal=plain(body.postalCode,9);
  if(mode==='stores'&&!normalizePostal(postal))return responseError('Save a valid Canadian postal code first.',400,'reef_postal_required');
  const input=mode==='stores'?{
    banner:REEF_BANNERS[storeId],postal_code:normalizePostal(postal).slice(0,3),limit:16
  }:{
    banner:REEF_BANNERS[storeId],store_id:branchId,query,page:1,page_size:24
  };
  let response;
  try{response=await fetch('https://api.reefapi.com/loblaws/v1/'+mode,{
    method:'POST',redirect:'manual',headers:{
      Accept:'application/json','Content-Type':'application/json','x-api-key':token
    },body:JSON.stringify(input),signal:AbortSignal.timeout(14000)
  });}catch{return responseError('ReefAPI could not be reached. Check your account before retrying.',503,'reef_unavailable');}
  if(response.status===401||response.status===403)return responseError('ReefAPI rejected the API key.',401,'reef_key_invalid');
  if(response.status===402||response.status===429)return responseError('ReefAPI credits or rate limit reached. Check your account.',429,'reef_quota');
  if(!response.ok)return responseError('Retailer lookup unavailable at ReefAPI.',503,'reef_unavailable');
  let data;try{data=await response.json();}catch{return responseError('ReefAPI returned unreadable JSON.',502);}
  if(data?.ok===false)return responseError('ReefAPI did not return usable retailer data.',422,'reef_provider_error');
  const cost=Number(data?.meta?.charged_credits);
  return json({provider:'ReefAPI',storeId,branchId:mode==='search'?branchId:null,
    branches:mode==='stores'?reefBranchRows(data.data??data,storeId):undefined,
    results:mode==='search'?reefSearchRows(data.data??data,storeId,branchId):undefined,
    chargedCredits:Number.isFinite(cost)?cost:null,sourceUrl:'https://reefapi.com/loblaws-api',
    note:mode==='stores'?'Select the correct branch before looking up prices.':'Live selected-branch retailer search. Confirm product variants, weight-price estimates and promotions.'});
}


// Free, attributed Québec price-reference search. This is deliberately a
// benchmark, not an Ontario branch price. Public, no-key, documented API.
// Keep traffic modest: short in-isolate cache and at most one detail lookup
// per query, rather than crawling an entire retailer catalogue.
const EPICERIES_CACHE=new Map();
const FR_TERMS=[
 [/^mini\s+marshmallows?$/i,'mini guimauves','guimauv'],
 [/marshmallows?/i,'guimauves','guimauv'],
 [/peanut butter/i,"beurre d'arachide",'arachide'],
 [/orange juice/i,"jus d'orange",'orange'],
 [/potato chips/i,'croustilles','croustill'],
 [/\boat milk\b/i,'avoine','avoine'],
 [/\balmond milk\b/i,'amande','amand'],
 [/\bsoy milk\b/i,'soya','soya'],
 [/\bchocolate milk\b/i,'chocolat','chocolat'],
 [/\bmilk\b/i,'lait','lait'],
 [/\bbutter\b/i,'beurre','beurre'],
 [/\beggs?\b/i,'oeufs','oeuf'],
 [/\bcheese\b/i,'fromage','fromag'],
 [/\bbread\b/i,'pain','pain'],
 [/\byogur?t\b/i,'yogourt','yogourt'],
 [/\bbananas?\b/i,'bananes','banan'],
 [/\bapples?\b/i,'pommes','pomm'],
 [/\bflour\b/i,'farine','farin'],
 [/\bsugar\b/i,'sucre','sucr'],
 [/\bcoffee\b/i,'café','caf'],
 [/\bchicken\b/i,'poulet','poulet'],
 [/ground beef/i,'boeuf haché','boeuf hach'],
 [/\bbeef\b/i,'boeuf','boeuf'],
 [/pasta sauce/i,'sauce pour pâtes','sauce pour pat'],
 [/\bpasta\b/i,'pâtes','pât'],
 [/\brice\b/i,'riz','riz'],
 [/\bpotatoes?\b/i,'pommes de terre','pomme de terre'],
 [/ground beef/i,'boeuf haché','boeuf hach'],
 [/\bsausages?\b/i,'saucisses','sauciss'],
 [/\bbacon\b/i,'bacon','bacon'],
 [/\btomatoes?\b/i,'tomates','tomat'],
 [/\bonions?\b/i,'oignons','oignon'],
 [/\bcarrots?\b/i,'carottes','carott'],
 [/\bbroccoli\b/i,'brocoli','brocol'],
 [/\bcucumbers?\b/i,'concombres','concomb'],
 [/\bgrapes?\b/i,'raisins','raisin'],
 [/\bstrawberries?\b/i,'fraises','frais'],
 [/\bblueberries?\b/i,'bleuets','bleuet'],
 [/\bras?pberries\b/i,'framboises','frambois'],
 [/\bcereals?\b/i,'céréales','cereal'],
 [/\bcookies?\b/i,'biscuits','biscuit'],
 [/\bcrackers?\b/i,'craquelins','craquelin'],
 [/\bchips\b/i,'croustilles','croustill'],
 [/\bice cream\b/i,'crème glacée','creme glac'],
 [/\bcoffee\b/i,'café','caf'],
 [/\bjuice\b/i,'jus','jus'],
 [/\bfrozen pizza\b/i,'pizza surgelée','pizza'],
 [/\bpizza\b/i,'pizza','pizza'],
 [/\bpasta sauce\b/i,'sauce pour pâtes','sauce pour pat'],
 [/\bspaghetti\b/i,'spaghetti','spaghetti'],
 [/\bketchup\b/i,'ketchup','ketchup'],
 [/\bmayonnaise\b/i,'mayonnaise','mayonn'],
 [/\bpaper towels?\b/i,'essuie-tout','essuie'],
 [/\btoilet paper\b/i,'papier hygiénique','papier hygien']
];
function epiceriesTerm(name){
 const nameText=String(name||'').trim().toLowerCase();
 for(const [test,term,stem] of FR_TERMS)if(test.test(nameText))return {term,stem};
 return {term:nameText,stem:nameText.slice(0,Math.max(3,nameText.length-1))};
}
function stripAccents(value){
 return String(value||'').toLowerCase().replace(/œ/g,'oe').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function epiceriesMatchesProduct(name,stem,brand,requested=''){
 const product=stripAccents(name),root=stripAccents(stem);
 if(!root||!product.includes(root))return false;
 if(brand&&!product.includes(stripAccents(brand)))return false;
 // Broad catalogue searches for simple generic groceries can return cheap
 // but fundamentally different derivatives. Never treat those as equivalents.
 const request=stripAccents(requested).trim();
 // The French catalogue can return the wrong food type even if one broad
 // keyword matches. Explicit variants must survive translation and matching.
 const requiredVariants=[
  [/\boat milk\b/,/avoine/,/\b(lait|boisson|breuvage)\b/],
  [/\balmond milk\b/,/amand/,/\b(lait|boisson|breuvage)\b/],
  [/\bsoy milk\b/,/soya|soja/,/\b(lait|boisson|breuvage)\b/],
  [/\bchocolate milk\b/,/chocolat/,/\blait\b/],
  [/\bwhole[ -]?wheat bread\b/,/ble entier|complet/,/\bpain\b/],
  [/\bground coffee\b/,/moulu/,/\bcafe\b/],
  [/\bchicken breasts?\b/,/poitrine/,/\bpoulet\b/]
 ];
 for(const [when,variant,kind] of requiredVariants)
  if(when.test(request)&&(!variant.test(product)||!kind.test(product)))return false;
 const milkPercent=request.match(/\b(0|1|2|3[.]25)\s*%\s*milk\b/);
 if(milkPercent&&!new RegExp('\\b'+milkPercent[1].replace('.','[.]')+'\\s*%').test(product))
  return false;
 const exclusions=[
  [/^milk$/,/(chocolat|amande|avoine|soya|coco|condense|evapore|lait de)/],
  [/^butter$/,/(arachide|amande|noisette|beurre de|beurre d')/],
  [/^tomatoes?$/,/(sauce|conserve|pate|jus|soupe|ketchup)/],
  [/^potatoes?$/,/(croustille|frite|puree|poudre|chips)/],
  [/^marshmallows?$/,/(tartinade|fluff|creme de guimauve)/],
  [/^bread$/,/(chapelure|crouton|pouding)/],
  [/^carrots?$/,/(jus|gateau|soupe)/]
 ];
 return !exclusions.some(([when,bad])=>when.test(request)&&bad.test(product));
}
async function epiceriesSearch(request){
 if(request.method!=='GET')return responseError('GET required',405);
 const u=new URL(request.url);
 const name=String(u.searchParams.get('name')||'').trim().slice(0,90);
 const brand=String(u.searchParams.get('brand')||'').trim().slice(0,55);
 const barcode=String(u.searchParams.get('barcode')||'').trim();
 const size=String(u.searchParams.get('size')||'').trim().slice(0,40);
 const byBarcode=/^\d{8,14}$/.test(barcode);
 if(!byBarcode&&(name.length<3||name.length>90||!/^[\p{L}\p{N} %.,'&()/-]+$/u.test(name)))
  return responseError('Enter a product name or valid UPC.',400);
 const key=[name.toLowerCase(),brand.toLowerCase(),size,barcode].join('|');
 const cached=EPICERIES_CACHE.get(key);
 if(cached?.expires>Date.now())return json(cached.value);
 const translated=epiceriesTerm(name);
 const target=new URL('https://epiceries.ca/api');
 target.searchParams.set('endpoint',byBarcode?'barcode':'search');
 if(byBarcode)target.searchParams.set('code',barcode);
 else{
  target.searchParams.set('q',translated.term);
  target.searchParams.set('limit','60');
  target.searchParams.set('sort','updated_desc');
 }
 const data=await upstreamJson(target.toString());
 if(data instanceof Response)return data;
 if(data?.ok!==true)return responseError('Épiceries.ca search returned no usable data.',502,'epiceries_invalid');
 let entries=[];
 if(byBarcode){
  const p=data.data?.product;
  if(p?.id)entries=[p];
 }else entries=Array.isArray(data.data?.results)?data.data.results:[];
 const matching=entries.filter(p=>{
  if(!p?.id||!p.name)return false;
  if(byBarcode)return !brand||stripAccents(p.name+' '+(p.brand||'')).includes(stripAccents(brand));
  return epiceriesMatchesProduct(p.name+' '+(p.brand||''),translated.stem,brand,name);
 });
 // Choose a product with matching package first; if no specified package,
 // pick the source's best current match but retain its actual pack size.
 const normalized=normalMeasure(size);
 const ordered=matching.slice().sort((a,b)=>{
  const ax=normalized&&normalMeasure(a.size)===normalized?0:1;
  const bx=normalized&&normalMeasure(b.size)===normalized?0:1;
  return ax-bx||(Number(a.price)||Infinity)-(Number(b.price)||Infinity);
 });
 const match=ordered[0];
 let rows=[];
 if(match){
  const detailUrl=new URL('https://epiceries.ca/api');
  detailUrl.searchParams.set('endpoint','product');
  detailUrl.searchParams.set('id',String(match.id).slice(0,55));
  const detail=await upstreamJson(detailUrl.toString());
  // Search results themselves carry a dated product price. If the optional
  // detail endpoint is temporarily unavailable, keep that one genuine
  // observation rather than declaring the whole item unpriced.
  const p=!(detail instanceof Response)&&detail?.ok?detail.data:match;
  const productName=String(p?.name||match.name).slice(0,135);
  const productBrand=String(p?.brand||match.brand||'').slice(0,70);
  const packageSize=String(p?.size||match.size||'').slice(0,40);
  const observations=Array.isArray(p?.prices)&&p.prices.length?p.prices:
    [{store:p?.store||match.store,price:p?.price??match.price,
      size:packageSize,date:p?.updated||match.updated}];
  rows=observations.filter(r=>{
    const price=Number(r.price);
    return Number.isFinite(price)&&price>0&&price<10000&&
      (!size||normalMeasure(r.size||packageSize)===normalized);
  }).map(r=>{
    const store=String(r.store||'').toLowerCase();
    const iso=String(r.date||p.updated||match.updated||'');
    const date=/^\d{4}-\d{2}-\d{2}/.test(iso)?iso.slice(0,10):null;
    const href='https://epiceries.ca/view?i='+encodeURIComponent(String(p.id));
    return {price:Number(r.price),currency:'CAD',date,
      source:'Épiceries.ca',storeId:null, // Never claim that a Québec Walmart quote applies in Ontario.
      storeName:store==='walmart'?'Walmart (Québec reference)':(store||'Québec grocery')+' (Québec reference)',
      priceStore:store,productName:productName+(productBrand?' · '+productBrand:''),
      brand:productBrand,packageSize:String(r.size||packageSize).slice(0,40),
      scope:'quebec_reference',city:'Québec, not your local branch',
      sourceUrl:href,confidence:'high',matchType:byBarcode?'barcode':'verified_search',
      barcode:byBarcode?barcode:'',sizeEvidence:'catalogue_reported',
      observedAt:date};
  }).filter(r=>Boolean(r.date));
 }
 const result={provider:'Épiceries.ca',results:rows.slice(0,7),
  sourceUrl:'https://epiceries.ca/developers',country:'CA',province:'QC',
  note:'Prices observed at Québec chains. NOT verified at an Ontario branch. Source: épiceries.ca (free public API); observations are indicative.'};
 EPICERIES_CACHE.set(key,{value:result,expires:Date.now()+10*60000});
 if(EPICERIES_CACHE.size>150)EPICERIES_CACHE.delete(EPICERIES_CACHE.keys().next().value);
 return json(result);
}

export default {
  async fetch(request,env){
    const {pathname}=new URL(request.url);
    if(pathname==='/api/pricing/status')return json({ready:true,sources:['open-prices-barcode','grocerypulse-reference-cities','statistics-canada-national-averages'],optionalSources:['vynn-ai-user-key','reefapi-selected-branch-user-key','savvi-apify-user-key'],secondaryReferenceSources:['epiceries-quebec-budget-benchmarks'],liveStoreFeeds:false,userConnectedStoreFeeds:true});
    if(pathname==='/api/pricing/open-prices')return openPrices(request);
    if(pathname==='/api/pricing/catalog-search')return catalogSearch(request);
    if(pathname==='/api/pricing/epiceries')return epiceriesSearch(request);
    if(pathname==='/api/pricing/grocerypulse-plan')return groceryPulse(request);
    if(pathname==='/api/pricing/savvi')return savviLookup(request);
    if(pathname==='/api/pricing/vynn')return vynnLookup(request);
    if(pathname==='/api/pricing/reef-stores')return reefLookup(request,'stores');
    if(pathname==='/api/pricing/reef-search')return reefLookup(request,'search');
    if(pathname==='/api/pricing/national-reference')return governmentReference(request);
    if(pathname==='/api/pricing/national-reference-list')return governmentList(request);
    if(pathname.startsWith('/api/'))return responseError('Unknown API route',404,'not_found');
    return env.ASSETS.fetch(request);
  }
};
