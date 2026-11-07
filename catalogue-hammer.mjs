// Import pre-matched historical DIRECT product URL metadata from Project Hammer.
// No retailer pages are scraped here. No historical prices, local availability,
// shelf-price claims, or inferred links are imported.
const STORE_HOSTS = {
  walmart: new Set(['www.walmart.ca','walmart.ca']),
  nofrills: new Set(['www.nofrills.ca','nofrills.ca']),
  gianttiger: new Set(['www.gianttiger.com','gianttiger.com']),
  costco: new Set(['www.costco.ca','costco.ca']),
  independent: new Set(['www.yourindependentgrocer.ca','yourindependentgrocer.ca']),
  freshco: new Set(['www.freshco.com','freshco.com'])
};
const MAX_PART=99;
const MAX_PART_BYTES=80000;
const MAX_RECORDS=80;

function safeProductUrl(raw,retailer){
  try{
    if(typeof raw!=='string'||raw.length>1400)return null;
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
      !STORE_HOSTS[retailer]?.has(u.hostname.toLowerCase())||
      (retailer==='walmart'&&!u.pathname.toLowerCase().includes('/ip/'))||
      (retailer==='nofrills'&&!u.pathname.toLowerCase().includes('/p/'))||
      (retailer==='gianttiger'&&!u.pathname.toLowerCase().startsWith('/products/'))||
      (retailer==='costco' && !(/\/p\/-\/[a-z0-9%\-]+\/\d{5,14}\/?$/i.test(u.pathname)||
         /\/[a-z0-9%\-]+\.product\.\d{5,14}\.html$/i.test(u.pathname)))||
      (retailer==='independent'&&!/^\/en\/[a-z0-9_%.-]+\/p\/\d{6,14}_(?:EA|KG)\/?$/i.test(u.pathname))||
      (retailer==='freshco'&&!/^\/products\/[a-z0-9%()._-]+\/?$/i.test(u.pathname)))return null;
    if(retailer!=='gianttiger')u.search='';
    else if(u.search&&!/^\?variant=\d{5,20}$/.test(u.search))return null;
    u.hash='';
    return u.href;
  }catch{return null;}
}
const clean=(s,len)=>typeof s==='string'?s.trim().replace(/\s+/g,' ').slice(0,len):'';

export async function importHammerPart(db,assets,origin,part,kind='hammer') {
  if(!['hammer','gianttiger','costco','independent','freshco'].includes(kind))throw Error('Invalid source');
  if(!Number.isInteger(part)||part<0||part>MAX_PART)throw Error('Invalid import page');
  if(!db||!assets||typeof assets.fetch!=='function')throw Error('Catalogue static source is unavailable');
  const folder={hammer:'hammer-parts',gianttiger:'gianttiger-parts',costco:'costco-parts',
    independent:'independent-parts',freshco:'freshco-parts'}[kind];
  const name='/data/'+folder+'/'+String(part).padStart(4,'0')+'.json';
  const url=new URL(name,origin);
  const response=await assets.fetch(new Request(url,{method:'GET'}));
  if(!response.ok)throw Error('Product URL catalogue part is unavailable: '+part);
  const content=await response.text();
  if(content.length>MAX_PART_BYTES)throw Error('Product URL catalogue part is too large');
  const data=JSON.parse(content);
  const expectedSource={hammer:'Project Hammer',gianttiger:'Giant Tiger public Shopify catalogue',
    costco:'Costco public product sitemap',independent:'Loblaw cross-banner SKU candidate',
    freshco:'FreshCo search-indexed official product pages'}[kind];
  if(data?.source!==expectedSource||data?.scope!=='online_unverified'||
    data?.part!==part||!Array.isArray(data?.records)||
    data.records.length>MAX_RECORDS||
    !Number.isInteger(data.totalParts)||data.totalParts<1||data.totalParts>MAX_PART+1||
    !Number.isInteger(data.totalRecords)||data.totalRecords<1||
    !/^[a-f0-9]{16}$/.test(String(data.sourceVersion||'')))throw Error('Invalid product URL catalogue part');
  const statements=[];
  let rejected=0;
  for(const row of data.records){
    const retailer=clean(row?.retailer,20),url=safeProductUrl(row?.productUrl,retailer);
    const productId=clean(row?.masterProductId,100),sku=clean(row?.retailerSku,140);
    const key=clean(row?.listingKey,180);
    const name=clean(row?.productName,180);
    if(!url||!name||!sku||!key||
      !/^[a-z0-9_-]{1,100}$/i.test(productId)||
      !(kind==='gianttiger'?/^gianttiger\|online\|shopify-[0-9a-f]{24}$/.test(key):
        kind==='costco'?/^costco\|online\|sitemap-[0-9a-f]{24}$/.test(key):
        kind==='independent'?/^independent\|online\|loblaw-[0-9a-f]{24}$/.test(key)&&
          row.discoveryStatus==='shared_loblaw_sku_candidate_unverified'&&
          /^\d{6,14}_(?:EA|KG)$/i.test(sku)&&url.endsWith('/p/'+sku):
        kind==='freshco'?/^freshco\|online\|indexed-[0-9a-f]{24}$/.test(key)&&
          row.discoveryStatus==='search_indexed_page_unverified_at_store':
        /^(?:walmart|nofrills)\|online\|hammer-[0-9a-f]{24}$/.test(key))){
      rejected++;continue;
    }
    statements.push(db.prepare(
      'INSERT INTO catalogue_listings '+
      '(listing_key,master_product_id,retailer,branch_id,retailer_sku,product_url,'+
      'product_name,brand,package_size) '+
      'VALUES (?,?,?,?,?,?,?,?,?) '+
      'ON CONFLICT(listing_key) DO UPDATE SET '+
      'product_url=excluded.product_url,product_name=excluded.product_name,'+
      'brand=excluded.brand,package_size=excluded.package_size'
    ).bind(key,productId,retailer,'online',sku,url,name,
      clean(row.brand,75),clean(row.packageSize,55)));
  }
  if(statements.length)await db.batch(statements);
  return {
    source:expectedSource,sourceVersion:data.sourceVersion,
    processed:statements.length,rejected,part,totalParts:data.totalParts,
    totalRecords:data.totalRecords,nextPart:part+1<data.totalParts?part+1:null,
    finished:part+1>=data.totalParts,scope:'online_unverified',pricesImported:0,
  };
}

export const importGiantTigerPart=(db,assets,origin,part)=>importHammerPart(db,assets,origin,part,'gianttiger');
export const importCostcoPart=(db,assets,origin,part)=>importHammerPart(db,assets,origin,part,'costco');
export const importIndependentPart=(db,assets,origin,part)=>importHammerPart(db,assets,origin,part,'independent');
export const importFreshcoPart=(db,assets,origin,part)=>importHammerPart(db,assets,origin,part,'freshco');
