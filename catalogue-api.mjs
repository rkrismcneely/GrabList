import { ensureCatalogueSchema } from "./catalogue-bootstrap.mjs";
import { importCuratedBatch } from "./catalogue-sources.mjs";
import { importHammerPart, importGiantTigerPart, importCostcoPart, importIndependentPart, importFreshcoPart } from "./catalogue-hammer.mjs";
import { importGroceryPart } from "./catalogue-grocery.mjs";
// Single active GrabList pricing API. Requires a Cloudflare D1 binding named CATALOGUE_DB.
// Legacy provider routes are deliberately disabled in worker.js; no optional services run here.
const RETAILERS = new Set(['walmart','nofrills','freshco','independent','costco','gianttiger']);
const ALLOWED_HOSTS = new Set([
  'www.walmart.ca','walmart.ca','www.nofrills.ca','nofrills.ca',
  'www.freshco.com','freshco.com','www.yourindependentgrocer.ca','yourindependentgrocer.ca',
  'www.independentgrocer.ca','independentgrocer.ca','www.gianttiger.com','gianttiger.com',
  'www.costco.ca','costco.ca'
]);
const JSON_HEADERS = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' };
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function error(message,status=400,code='invalid_request'){return json({error:message,code},status);}
function str(value,max=140){return typeof value==='string'?value.trim().slice(0,max):'';}
function nowIso(){return new Date().toISOString();}
function validPriceCents(price){
  const number=typeof price==='number'?price:Number(String(price??'').replace(/[,$ ]/g,''));
  if(!Number.isFinite(number)||number<=0||number>=10000)return null;
  const cents=Math.round(number*100);
  return cents>0&&cents<=999999?cents:null;
}
function findStructuredProducts(data,depth=0){
  if(depth>6||!data||typeof data!=='object')return [];
  if(Array.isArray(data))return data.flatMap(v=>findStructuredProducts(v,depth+1));
  const type=Array.isArray(data['@type'])?data['@type'].join(' '):String(data['@type']||'');
  const own=/\bProduct\b/i.test(type)?[data]:[];
  return [...own,...findStructuredProducts(data['@graph'],depth+1)];
}
function offerPrices(offer,depth=0){
  if(depth>3||!offer||typeof offer!=='object')return [];
  if(Array.isArray(offer))return offer.flatMap(v=>offerPrices(v,depth+1));
  if(offer.priceCurrency&&String(offer.priceCurrency).toUpperCase()!=='CAD')return [];
  const raw=offer.price ?? (offer.lowPrice===offer.highPrice?offer.lowPrice:null);
  const price=validPriceCents(raw);
  const specs=offer.priceSpecification?offerPrices(offer.priceSpecification,depth+1):[];
  return [...(price===null?[]:[price]),...specs];
}
export function extractProductPrice(html){
  if(typeof html!=='string'||!html)return {priceCents:null,reason:'Empty product page'};
  const candidates=[];
  const scripts=html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
  for(const match of scripts){
    if(!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]))continue;
    let data;try{data=JSON.parse(match[2].trim());}catch{continue;}
    for(const product of findStructuredProducts(data)){
      candidates.push(...offerPrices(product.offers));
    }
  }
  // Product metadata fallback. This intentionally does not search for the first '$'
  // on the page (which could be a different product or unrelated advertisement).
  if(!candidates.length){
    const metadata=html.matchAll(/<meta\b[^>]*>/gi);
    for(const [tag] of metadata){
      if(!/(?:property|name)\s*=\s*["'](?:product:price:amount|og:price:amount)["']/i.test(tag))continue;
      const m=tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
      const cents=m?validPriceCents(m[1]):null;
      if(cents!==null)candidates.push(cents);
    }
  }
  const distinct=[...new Set(candidates)];
  if(distinct.length===1)return {priceCents:distinct[0],scope:'online_unverified',source:'public-product-page'};
  return {priceCents:null,reason:distinct.length?'Multiple product prices or variants: no safe selection':'No structured product price'};
}
function permittedProductUrl(raw){
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!ALLOWED_HOSTS.has(url.hostname.toLowerCase()))return null;
    return url.href;
  }catch{return null;}
}
async function readHtml(response,limit=1500000){
  const length=Number(response.headers.get('content-length')||0);
  if(length>limit)throw Error('Page exceeds safe HTML size limit');
  if(!response.body)return '';
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let size=0,out='';
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>limit)throw Error('Page exceeds safe HTML size limit');
      out+=decoder.decode(value,{stream:true});
    }
    return out+decoder.decode();
  }finally{reader.releaseLock();}
}

/**
 * Giant Tiger's public Shopify Ajax product endpoint reports the merchant's
 * online price in cents. Never assume an online price is a local shelf price.
 * A variant query parameter must resolve to the SAME variant: silently taking
 * a default variant could show the price of the wrong size/package.
 */
export function extractShopifyProductPrice(product, rawProductUrl){
  if(!product||typeof product!=='object'||!Array.isArray(product.variants)||!product.variants.length)
    return {priceCents:null,reason:'Product feed has no variants'};
  let variantId;
  try{variantId=new URL(rawProductUrl).searchParams.get('variant');}catch{
    return {priceCents:null,reason:'Invalid product URL'};
  }
  let variants=product.variants;
  if(variantId){
    if(!/^\d{5,24}$/.test(variantId))return {priceCents:null,reason:'Invalid selected variant'};
    const variant=variants.find(v=>String(v.id)===variantId);
    if(!variant)return {priceCents:null,reason:'Selected variant missing from product feed'};
    variants=[variant];
  }
  const prices=[];
  for(const variant of variants){
    if(variant.available===false)continue;
    const cents=Number(variant.price);
    if(!Number.isSafeInteger(cents)||cents<=0||cents>999999)
      return {priceCents:null,reason:'Variant price unavailable'};
    prices.push(cents);
  }
  const unique=[...new Set(prices)];
  if(unique.length!==1)return {priceCents:null,reason:unique.length?'Different variant prices; select a variant':'Product currently unavailable'};
  return {priceCents:unique[0],scope:'online_unverified',source:'gianttiger-shopify-product'};
}
async function getProductPagePrice(raw){
  const url=permittedProductUrl(raw);
  if(!url)return {priceCents:null,reason:'Unapproved or unsafe product URL'};
  const target=new URL(url);
  // Unlike retailer HTML that may not include client-rendered prices, Shopify
  // exposes its own public product data endpoint for the same product handle.
  // This is a GET to the already-allowlisted retailer, not a proxy to other hosts.
  if(['www.gianttiger.com','gianttiger.com'].includes(target.hostname.toLowerCase())&&
     /^\/products\/[a-z0-9%._-]+\/?$/i.test(target.pathname)){
    const productApi=new URL(target.pathname.replace(/\/$/,'')+'.js',target.origin);
    try{
      const response=await fetch(productApi.href,{
        headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)
      });
      if(response.ok&&(response.headers.get('content-type')||'').toLowerCase().includes('json')){
        const product=JSON.parse(await readHtml(response,650000));
        return extractShopifyProductPrice(product,url);
      }
    }catch{
      // Some stores or pages do not support the Ajax endpoint. Try the
      // unmodified published product URL below, without evading any blocks.
    }
  }
  try{
    const response=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return {priceCents:null,reason:'Product request returned HTTP '+response.status};
    const contentType=(response.headers.get('content-type')||'').toLowerCase();
    if(contentType&&!contentType.includes('text/html'))return {priceCents:null,reason:'Product URL did not return HTML'};
    return extractProductPrice(await readHtml(response));
  }catch(ex){return {priceCents:null,reason:String(ex?.message||'Product fetch failed').slice(0,125)};}
}
async function readBody(request,bytes=16000){
  const size=Number(request.headers.get('content-length')||0);
  if(size>bytes)return null;
  try{const raw=await request.text();return raw.length<=bytes?JSON.parse(raw):null;}catch{return null;}
}
function asListing(row){
  const at=row.price_observed_at,age=at?Date.now()-Date.parse(at):Infinity;
  return {
    key:row.listing_key,productId:row.master_product_id,retailer:row.retailer,branchId:row.branch_id,
    productName:row.product_name,masterName:row.display_name,
    brand:row.brand||row.master_brand||'',size:row.package_size||row.master_size||'',
    barcode:row.barcode||row.master_barcode||'',url:row.product_url,
    priceCents:row.last_price_cents,source:row.price_source,scope:row.price_scope,
    observedAt:at,lastAttemptedAt:row.last_attempted_at,lastError:row.last_error,
    status:!Number.isInteger(row.last_price_cents)?'unavailable':age>=0&&age<=36*3600000?'current':'stale'
  };
}
async function compare(db,request){
  if(request.method!=='POST')return error('POST required',405);
  const body=await readBody(request);
  if(!body||!Array.isArray(body.items)||body.items.length>40||!Array.isArray(body.stores))return error('Provide up to 40 list items and selected stores.');
  const stores=[...new Set(body.stores.filter(x=>RETAILERS.has(x)))];
  if(!stores.length)return json({results:[],stores:[]});
  const items=body.items.map(item=>({
    id:str(item?.id,100),name:str(item?.name,110),barcode:str(item?.barcode,14),size:str(item?.size,45),brand:str(item?.brand,75)
  })).filter(x=>x.id&&x.name);
  const placeholders=stores.map(()=>'?').join(',');
  const statements=items.map(item=>{
    const q=item.name.toLowerCase().replace(/[%_]/g,'').replace(/\s+/g,' ').slice(0,85);
    const terms=q.split(' ').filter(Boolean);
    // If name contains multiple words, first try exact phrase but still permit
    // partial grocery searches. Exact product validation happens client-side.
    const term=terms.length?terms.at(-1):q;
    const sql=`SELECT l.*,p.display_name,p.brand AS master_brand,p.package_size AS master_size,p.barcode AS master_barcode
    FROM catalogue_listings l JOIN catalogue_products p ON p.id=l.master_product_id
    WHERE l.retailer IN (${placeholders}) AND
      (p.search_name LIKE ? OR lower(l.product_name) LIKE ? OR (? <> '' AND (p.barcode=? OR l.barcode=?)))
    ORDER BY CASE
      WHEN (? <> '' AND (p.barcode=? OR l.barcode=?)) THEN 0
      WHEN lower(l.product_name)=? OR p.search_name=? THEN 1
      WHEN lower(l.product_name) LIKE ? THEN 2
      WHEN p.search_name LIKE ? THEN 3
      ELSE 4 END,
      CASE WHEN l.price_scope='selected_branch' AND l.last_price_cents IS NOT NULL THEN 0 ELSE 1 END,
      length(l.product_name),l.listing_key
    LIMIT 180`;
    return db.prepare(sql).bind(...stores,'%'+term+'%','%'+term+'%',item.barcode,item.barcode,item.barcode,
      item.barcode,item.barcode,item.barcode,q,q,'%'+q+'%','%'+q+'%');
  });
  try{
    const batches=statements.length?await db.batch(statements):[];
    // Flyer records are only regional product discovery, never local shelf
    // prices. They cannot enter asListing or the savings evaluator.
    const discoveryQueries=items.map(item=>{
      const terms=item.name.toLowerCase().replace(/[%_]/g,'').split(/\s+/).filter(Boolean);
      const last=terms.at(-1)||'';
      return db.prepare(`SELECT p.display_name AS productName,p.package_size AS size,p.brand,
        f.retailer,f.valid_from AS validFrom,f.valid_to AS validTo,
        f.source_url AS sourceUrl,f.market_scope AS scope
        FROM catalogue_flyer_discoveries f
        JOIN catalogue_products p ON p.id=f.master_product_id
        WHERE f.retailer IN (${placeholders})
          AND f.valid_to >= date('now') AND f.valid_from <= date('now')
          AND p.search_name LIKE ? LIMIT 40`
      ).bind(...stores,'%'+last+'%');
    });
    const candidateQueries=items.map(item=>{
      const terms=item.name.toLowerCase().replace(/[%_]/g,'').split(/\s+/).filter(Boolean);
      const last=terms.at(-1)||'';
      const full=item.name.toLowerCase().replace(/[%_]/g,'').replace(/\s+/g,' ').slice(0,85);
      return db.prepare(`SELECT display_name AS productName,package_size AS size,brand
        FROM catalogue_products WHERE search_name LIKE ?
        ORDER BY CASE WHEN search_name=? THEN 0
                      WHEN search_name LIKE ? THEN 1
                      ELSE 2 END,
          length(search_name),id LIMIT 120`
      ).bind('%'+last+'%',full,'%'+full+'%');
    });
    const [flyers,candidates]=await Promise.all([
      discoveryQueries.length?db.batch(discoveryQueries):Promise.resolve([]),
      candidateQueries.length?db.batch(candidateQueries):Promise.resolve([])
    ]);
    return json({stores,results:items.map((item,i)=>({
      id:item.id,
      offers:(batches[i]?.results||[]).map(asListing),
      flyerMatches:flyers[i]?.results||[],
      productCandidates:candidates[i]?.results||[]
    })),scope:'catalogue_only'});
  }catch{return error('Catalogue query failed. Check that D1 migrations were applied.',503,'catalogue_schema_missing');}
}
async function refresh(db,env,request){
  if(request.method!=='POST')return error('POST required',405);
  // Read access is public; write/refresh requires the owner's server-side secret.
  if(!env.CATALOGUE_WRITE_KEY)return error('Owner refresh key has not been configured.',503,'refresh_not_configured');
  const supplied=str(request.headers.get('x-grablist-key'),256);
  if(!supplied||supplied!==env.CATALOGUE_WRITE_KEY)return error('Invalid catalogue refresh key.',401,'unauthorized');
  const body=await readBody(request);
  if(!body||!Array.isArray(body.keys)||body.keys.length>12)return error('Request up to 12 saved listing keys at a time.');
  const keys=[...new Set(body.keys.map(x=>str(x,220)).filter(Boolean))];
  const results=[];
  for(const key of keys){
    const row=await db.prepare('SELECT * FROM catalogue_listings WHERE listing_key=?').bind(key).first();
    if(!row){results.push({key,status:'missing'});continue;}
    const previous=Date.parse(row.last_attempted_at||'');
    if(Number.isFinite(previous)&&Date.now()-previous<120000){
      results.push({key,status:'throttled',note:'Recently checked'});continue;
    }
    const attemptedAt=nowIso();
    // This generic HTML parser cannot prove which branch's price was returned.
    // Never downgrade a previously verified branch-specific quote to online scope.
    if(row.price_scope==='selected_branch'){
      await db.prepare('UPDATE catalogue_listings SET last_attempted_at=?,last_error=? WHERE listing_key=?')
        .bind(attemptedAt,'Store-specific adapter required to refresh this branch',key).run();
      results.push({key,status:'skipped',reason:'Store-specific adapter required'});continue;
    }
    const result=await getProductPagePrice(row.product_url);
    if(result.priceCents===null){
      await db.prepare('UPDATE catalogue_listings SET last_attempted_at=?,last_error=? WHERE listing_key=?')
        .bind(attemptedAt,str(result.reason,145),key).run();
      results.push({key,status:'unavailable',reason:result.reason});continue;
    }
    // Generic web product prices are never promoted to local store prices.
    await db.prepare(`UPDATE catalogue_listings SET last_price_cents=?,price_source=?,price_scope='online_unverified',
      price_observed_at=?,last_attempted_at=?,last_error=NULL
      WHERE listing_key=? AND (price_observed_at IS NULL OR price_observed_at<=?)`)
      .bind(result.priceCents,result.source,attemptedAt,attemptedAt,key,attemptedAt).run();
    await db.prepare(`INSERT OR IGNORE INTO catalogue_price_history
      (listing_key,price_cents,observed_at,price_source,price_scope) VALUES (?,?,?,?,'online_unverified')`)
      .bind(key,result.priceCents,attemptedAt,result.source).run();
    results.push({key,status:'saved',priceCents:result.priceCents,scope:'online_unverified'});
  }
  return json({results,source:'saved_product_urls',notes:'Generic product-page prices are not verified at a selected branch.'});
}

/**
 * Public, READ-ONLY quotes for existing allowlisted catalogue product URLs.
 * No user-supplied URL is fetched; no DB mutations, auth secrets, or upstream
 * credentials are exposed. Cache each listing to avoid repeated retailer hits.
 * These prices are online_unverified and NEVER count as local shelf prices.
 */
export async function quoteSavedUrls(db,request){
  if(request.method!=='POST')return error('POST required',405);
  const body=await readBody(request);
  if(!body||!Array.isArray(body.keys)||body.keys.length>8)
    return error('Provide up to 8 catalogue listing keys.');
  const keys=[...new Set(body.keys.map(x=>str(x,220)).filter(Boolean))];
  const results=[];
  // Bound concurrent connections and upstream load on a public route.
  for(let offset=0;offset<keys.length;offset+=2){
    const pair=await Promise.all(keys.slice(offset,offset+2).map(async key=>{
      const row=await db.prepare('SELECT * FROM catalogue_listings WHERE listing_key=?').bind(key).first();
      if(!row)return {key,status:'missing'};
      if(row.price_scope==='selected_branch')
        return {key,status:'skipped',reason:'Verified local price is not replaced'};
      const cache=new URL('/api/catalogue/quote-cache/'+encodeURIComponent(key),request.url);
      const cacheRequest=new Request(cache.href);
      try{
        const saved=await globalThis.caches?.default?.match(cacheRequest);
        if(saved)return {key,...await saved.json(),cached:true};
      }catch{
        // Cache is optional in local tests and unsupported preview runtimes.
      }
      const price=await getProductPagePrice(row.product_url);
      const output=price.priceCents===null?
        {status:'unavailable',reason:price.reason||'Price unavailable'}:
        {status:'priced',priceCents:price.priceCents,source:price.source,
          observedAt:nowIso(),scope:'online_unverified'};
      try{
        const ttl=output.status==='priced'?7200:900;
        await globalThis.caches?.default?.put(cacheRequest,new Response(JSON.stringify(output),{
          headers:{'cache-control':'public, max-age='+ttl,'content-type':'application/json'}
        }));
      }catch{}
      return {key,...output};
    }));
    results.push(...pair);
  }
  return json({results,scope:'online_unverified',source:'saved_product_urls'});
}

async function importExistingUrlBatch(db,env,request){
  if(request.method!=='POST')return error('POST required',405);
  if(!env.CATALOGUE_WRITE_KEY)return error('Owner import key has not been configured.',503,'import_not_configured');
  const supplied=str(request.headers.get('x-grablist-key'),256);
  if(!supplied||supplied!==env.CATALOGUE_WRITE_KEY)return error('Invalid catalogue refresh key.',401,'unauthorized');
  const body=await readBody(request,2000);
  if(!body||!Number.isInteger(body.offset)||body.offset<0)return error('A valid import offset is required.');
  try{
    return json(await importCuratedBatch(db,body));
  }catch(cause){
    console.error('Curated retailer URL import failed',cause);
    return error('Existing product URL source is temporarily unavailable or could not be imported.',502,'catalogue_import_failed');
  }
}
async function importHammerUrlBatch(db,env,request,source='hammer'){
  if(request.method!=='POST')return error('POST required',405);
  if(!env.CATALOGUE_WRITE_KEY)return error('Owner import key has not been configured.',503,'import_not_configured');
  const supplied=str(request.headers.get('x-grablist-key'),256);
  if(!supplied||supplied!==env.CATALOGUE_WRITE_KEY)return error('Invalid catalogue refresh key.',401,'unauthorized');
  const body=await readBody(request,2000);
  if(!body||!Number.isInteger(body.part)||body.part<0)return error('A valid product URL batch is required.');
  try{
    return json(source==='gianttiger' ? await importGiantTigerPart(db,env.ASSETS,request.url,body.part) :
      source==='costco' ? await importCostcoPart(db,env.ASSETS,request.url,body.part) :
      source==='independent' ? await importIndependentPart(db,env.ASSETS,request.url,body.part) :
      source==='freshco' ? await importFreshcoPart(db,env.ASSETS,request.url,body.part) :
      source==='gtgrocery' ? await importGroceryPart(db,env.ASSETS,request.url,body.part) :
      await importHammerPart(db,env.ASSETS,request.url,body.part));
  }catch(cause){
    console.error('Project Hammer URL metadata import failed',cause);
    return error('Product URL batch unavailable or could not be imported.',502,'catalogue_hammer_import_failed');
  }
}
export async function handleCatalogueApi(request,env){
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/catalogue/'))return null;
  const db=env.CATALOGUE_DB;
  if(db){
    try { await ensureCatalogueSchema(db); }
    catch (cause) {
      // Only return a safe SQLite/D1 diagnostic code; never expose SQL or credentials.
      const message=String(cause?.message||'');
      const reason=/no such table/i.test(message)?'Database schema is incomplete':
        /SQLITE_CONSTRAINT/i.test(message)?'Database constraint failed during setup':
        /SQLITE_ERROR/i.test(message)?'Database rejected a schema statement':
        /D1_ERROR/i.test(message)?'Cloudflare D1 rejected the setup operation':
        'Database initialization failed';
      console.error('Catalogue D1 bootstrap failed',cause);
      return json({ready:false,refreshReady:false,reason,products:0,listings:0},503);
    }
  }
  if(path==='/api/catalogue/status'){
    if(!db)return json({ready:false,refreshReady:false,reason:'Connect the CATALOGUE_DB D1 binding and apply migrations.',products:0,listings:0});
    try{
      const count=await db.prepare(`SELECT
        (SELECT count(*) FROM catalogue_products) AS products,
        (SELECT count(*) FROM catalogue_listings) AS listings,
        (SELECT count(*) FROM catalogue_flyer_discoveries) AS flyerDiscoveries,
        (SELECT count(*) FROM catalogue_flyer_discoveries
          WHERE valid_from <= date('now') AND valid_to >= date('now')) AS currentFlyerDiscoveries`).first();
      return json({ready:true,refreshReady:Boolean(env.CATALOGUE_WRITE_KEY),products:count.products,
        listings:count.listings,flyerDiscoveries:count.flyerDiscoveries,
        currentFlyerDiscoveries:count.currentFlyerDiscoveries,
        flyerScope:'regional_unverified',priceScope:'product_urls_only'});
    }catch{return json({ready:false,refreshReady:false,reason:'Apply the catalogue database migration first.',products:0,listings:0});}
  }
  if(!db)return error('Catalogue D1 database has not been connected.',503,'catalogue_not_configured');
  if(path==='/api/catalogue/import-curated')return importExistingUrlBatch(db,env,request);
  if(path==='/api/catalogue/import-hammer')return importHammerUrlBatch(db,env,request);
  if(path==='/api/catalogue/import-gianttiger')return importHammerUrlBatch(db,env,request,'gianttiger');
  if(path==='/api/catalogue/import-costco')return importHammerUrlBatch(db,env,request,'costco');
  if(path==='/api/catalogue/import-independent')return importHammerUrlBatch(db,env,request,'independent');
  if(path==='/api/catalogue/import-freshco')return importHammerUrlBatch(db,env,request,'freshco');
  if(path==='/api/catalogue/import-gt-grocery')return importHammerUrlBatch(db,env,request,'gtgrocery');
  if(path==='/api/catalogue/compare')return compare(db,request);
  if(path==='/api/catalogue/quote')return quoteSavedUrls(db,request);
  if(path==='/api/catalogue/refresh')return refresh(db,env,request);
  return error('Unknown catalogue endpoint',404,'not_found');
}
