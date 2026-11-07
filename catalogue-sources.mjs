// Import a small pre-existing, public Canadian grocery URL list using the
// OWNER's already-configured write key. Stores metadata and product links only.
// This adapter does not copy another project's scraper code or historic prices.
export const CURATED_SOURCE_URL =
  'https://raw.githubusercontent.com/JP011098/grocery-price-tracker/main/products.json';
export const NOFRILLS_SOURCE_URL =
  'https://raw.githubusercontent.com/Donny1479/Retail-Price-Scraper/main/data/product_urls.csv';
export const NOFRILLS_METADATA_URL =
  'https://raw.githubusercontent.com/Donny1479/Retail-Price-Scraper/main/data/products.csv';

const RETAILER_HOSTS = Object.freeze({
  walmart: ['walmart.ca','www.walmart.ca'],
  freshco: ['freshco.com','www.freshco.com'],
  costco: ['costco.ca','www.costco.ca'],
  nofrills: ['nofrills.ca','www.nofrills.ca']
});
const MAX_BATCH = 16;
const MAX_SOURCE_BYTES = 256 * 1024;

function clean(value,max=150) {
  return typeof value==='string' ? value.replace(/\s+/g,' ').trim().slice(0,max) : '';
}
function packageSize(name) {
  const match=name.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|lb|lbs|oz|ct|count|pk|pack)\b/i);
  return match ? match[0] : '';
}
export function safeCuratedUrl(value, retailer) {
  if(typeof value!=='string'||!RETAILER_HOSTS[retailer]||value.length>1600)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!RETAILER_HOSTS[retailer].includes(url.hostname.toLowerCase())||
      url.username||url.password||url.port||url.pathname==='/'||
      /^\/(?:search|browse)(?:\/|$)/i.test(url.pathname))return null;
    url.hash='';
    // Search and affiliate tracking parameters do not identify a product.
    url.search='';
    return url.href.slice(0,1200);
  }catch{return null;}
}
export function extractCuratedLinks(data) {
  if(!data||!Array.isArray(data.products))throw Error('Invalid source catalogue');
  if(data.products.length>3000)throw Error('Source catalogue unexpectedly large');
  const entries=[],seen=new Set();
  for(const product of data.products){
    const name=clean(product?.name,150);
    if(!name||!Array.isArray(product?.variants))continue;
    const size=packageSize(name);
    for(const variant of product.variants.slice(0,40)){
      const store=clean(variant?.store,40).toLowerCase();
      const url=safeCuratedUrl(variant?.url,store);
      if(!url||seen.has(store+'|'+url))continue;
      seen.add(store+'|'+url);
      entries.push({retailer:store,url,name,brand:clean(variant?.brand,75),size});
    }
  }
  return entries;
}
function csvRows(text) {
  const rows=[]; let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"'){quoted=false;}
      else field+=ch;
    }else if(ch==='"'){quoted=true;}
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\n'){
      row.push(field.replace(/\r$/,''));field='';
      if(row.some(v=>v!==''))rows.push(row);
      row=[];
    }else field+=ch;
  }
  if(field!==''||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  if(!rows.length)return [];
  const heads=rows.shift().map(x=>x.trim().replace(/^\uFEFF/,''));
  return rows.map(values=>Object.fromEntries(heads.map((head,i)=>[head,values[i]||''])));
}
export function extractMatchedNoFrillsLinks(urlCsv,productCsv) {
  const productById=new Map(csvRows(productCsv).map(p=>[p.product_id,p]));
  const entries=[],seen=new Set();
  for(const row of csvRows(urlCsv)){
    if(row.retailer_id!=='no_frills'||row.url_status!=='matched')continue;
    const url=safeCuratedUrl(row.product_url,'nofrills');
    const product=productById.get(row.product_id);
    const name=clean(row.matched_product_name||product?.item_description,150);
    if(!url||!name||seen.has(url))continue;
    seen.add(url);
    const sizeFromSource=product?.size_qty&&product?.size_uom?
      clean(product.size_qty+' '+product.size_uom,45):'';
    entries.push({retailer:'nofrills',url,name,
      brand:clean(product?.brand,75),size:packageSize(name)||sizeFromSource});
  }
  return entries;
}
async function fetchSourceText(url,fetcher) {
  const response=await fetcher(url,{
    method:'GET',headers:{Accept:'application/json,text/csv'},
    redirect:'error',signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error('Source catalogue temporarily unavailable');
  const len=Number(response.headers.get('content-length'));
  if(Number.isFinite(len)&&len>MAX_SOURCE_BYTES)throw Error('Source catalogue too large');
  const content=await response.text();
  if(content.length>MAX_SOURCE_BYTES)throw Error('Source catalogue too large');
  return content;
}
async function sha24(value) {
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function importCuratedBatch(db,body={},fetcher=fetch) {
  const offset=body?.offset;
  if(!Number.isInteger(offset)||offset<0||offset>20000)throw Error('Invalid import offset');
  const source=body?.source||'curated-grocery-tracker';
  let links;
  if(source==='curated-grocery-tracker'){
    links=extractCuratedLinks(JSON.parse(await fetchSourceText(CURATED_SOURCE_URL,fetcher)));
  }else if(source==='nofrills-matched'){
    const [urlCsv,productsCsv]=await Promise.all([
      fetchSourceText(NOFRILLS_SOURCE_URL,fetcher),
      fetchSourceText(NOFRILLS_METADATA_URL,fetcher)
    ]);
    links=extractMatchedNoFrillsLinks(urlCsv,productsCsv);
  }else{
    throw Error('Unknown curated source');
  }
  const batch=links.slice(offset,offset+MAX_BATCH);
  const statements=[];
  for(const item of batch){
    const hash=await sha24(item.retailer+'|'+item.url);
    const id='curated-'+hash, listingKey=item.retailer+'|online|'+id;
    statements.push(db.prepare(
      'INSERT OR IGNORE INTO catalogue_products '+
      '(id,display_name,search_name,brand,package_size,category,discovered_from) '+
      'VALUES (?,?,?,?,?,?,?)'
    ).bind(id,item.name,item.name.toLowerCase(),item.brand,item.size,'','curated-url-list'));
    // Idempotent; preserves any previously fetched prices and price history.
    statements.push(db.prepare(
      'INSERT INTO catalogue_listings '+
      '(listing_key,master_product_id,retailer,branch_id,retailer_sku,product_url,product_name,brand,package_size) '+
      'VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(listing_key) DO UPDATE SET '+
      'product_url=excluded.product_url,product_name=excluded.product_name,'+
      'brand=excluded.brand,package_size=excluded.package_size'
    ).bind(listingKey,id,item.retailer,'online',id,item.url,item.name,item.brand,item.size));
  }
  if(statements.length)await db.batch(statements);
  const nextOffset=offset+batch.length<links.length?offset+batch.length:null;
  return {source,processed:batch.length,total:links.length,
    nextOffset,finished:nextOffset===null,scope:'online_unverified',pricesImported:0};
}
