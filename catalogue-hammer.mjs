// Import pre-matched historical DIRECT product URL metadata from Project Hammer.
// No retailer pages are scraped here. No historical prices, local availability,
// shelf-price claims, or inferred links are imported.
const STORE_HOSTS = {
  walmart: new Set(['www.walmart.ca','walmart.ca']),
  nofrills: new Set(['www.nofrills.ca','nofrills.ca'])
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
      (retailer==='nofrills'&&!u.pathname.toLowerCase().includes('/p/')))return null;
    u.search='';u.hash='';
    return u.href;
  }catch{return null;}
}
const clean=(s,len)=>typeof s==='string'?s.trim().replace(/\s+/g,' ').slice(0,len):'';

export async function importHammerPart(db,assets,origin,part) {
  if(!Number.isInteger(part)||part<0||part>MAX_PART)throw Error('Invalid import page');
  if(!db||!assets||typeof assets.fetch!=='function')throw Error('Catalogue static source is unavailable');
  const name='/data/hammer-parts/'+String(part).padStart(4,'0')+'.json';
  const url=new URL(name,origin);
  const response=await assets.fetch(new Request(url,{method:'GET'}));
  if(!response.ok)throw Error('Product URL catalogue part is unavailable: '+part);
  const content=await response.text();
  if(content.length>MAX_PART_BYTES)throw Error('Product URL catalogue part is too large');
  const data=JSON.parse(content);
  if(data?.source!=='Project Hammer'||data?.scope!=='online_unverified'||
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
      !/^(?:walmart|nofrills)\|online\|hammer-[0-9a-f]{24}$/.test(key)){
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
    source:'Project Hammer',sourceVersion:data.sourceVersion,
    processed:statements.length,rejected,part,totalParts:data.totalParts,
    totalRecords:data.totalRecords,nextPart:part+1<data.totalParts?part+1:null,
    finished:part+1>=data.totalParts,scope:'online_unverified',pricesImported:0,
  };
}
