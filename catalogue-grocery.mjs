// First-party published grocery products from Giant Tiger's allowed Shopify
// collection feeds. Adds NEW canonical product descriptions and official links.
// Does not copy prices, stock, or images.
const MAX_PART=500;
const MAX_BYTES=86000;
const MAX_ROWS=80;
const SOURCE='Giant Tiger official grocery collection';

const clean=(v,n)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
function safeProductUrl(value,sku){
  if(typeof value!=='string'||value.length>1400||!/^shopify-\d{10,20}$/.test(sku))return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!['www.gianttiger.com','gianttiger.com'].includes(url.hostname)||
      url.username||url.password||url.port||
      !/^\/products\/[a-z0-9][a-z0-9-]{1,160}$/.test(url.pathname)||
      (url.search&&!new RegExp('^\\?variant='+sku.slice(8)+'$').test(url.search)))return null;
    url.hash='';
    return url.href;
  }catch{return null;}
}
function placeholders(n,width){
  return Array.from({length:n},()=> '(' + Array(width).fill('?').join(',') + ')').join(',');
}
export async function importGroceryPart(db,assets,origin,part){
  if(!Number.isInteger(part)||part<0||part>MAX_PART)throw Error('Invalid grocery import page');
  if(!assets||typeof assets.fetch!=='function')throw Error('Missing catalogue assets binding');
  const path='/data/gianttiger-grocery/'+String(part).padStart(4,'0')+'.json';
  const response=await assets.fetch(new Request(new URL(path,origin)));
  if(!response.ok)throw Error('Missing grocery product batch '+part);
  const source=await response.text();
  if(source.length>MAX_BYTES)throw Error('Grocery product batch exceeds safety limit');
  const data=JSON.parse(source);
  if(data?.source!==SOURCE||data?.scope!=='online_unverified'||
    data.part!==part||!Array.isArray(data.records)||data.records.length>MAX_ROWS||
    !Number.isInteger(data.totalParts)||data.totalParts<1||data.totalParts>MAX_PART+1||
    !Number.isInteger(data.totalRecords)||data.totalRecords<1||
    !/^[a-f0-9]{16}$/.test(data.sourceVersion||'')){
    throw Error('Invalid grocery product batch metadata');
  }
  const products=[],listings=[];
  let rejected=0;
  for(const r of data.records){
    const name=clean(r?.productName,180);
    const sku=clean(r?.retailerSku,70);
    const url=safeProductUrl(r?.productUrl,sku);
    const productId=clean(r?.masterProductId,100);
    const key=clean(r?.listingKey,150);
    if(r?.retailer!=='gianttiger'||
      r?.discoveryStatus!=='official_grocery_collection_unverified_at_store'||
      !/^[a-z0-9_-]{1,100}$/i.test(productId)||
      !/^gianttiger\|online\|shopify-[a-f0-9]{24}$/.test(key)||
      !name||!url){rejected++;continue;}
    const brand=clean(r?.brand,75),size=clean(r?.packageSize,45),
      category=clean(r?.category,50);
    products.push([productId,name,name.toLowerCase(),brand,size,category||'Grocery',
      'gianttiger-official-grocery-collection']);
    listings.push([key,productId,'gianttiger','online',sku,url,name,brand,size]);
  }
  if(products.length){
    // 80 rows produce 560 bound fields for products and 720 for listings.
    // Each chunk uses two prepared D1 statements rather than 160 requests.
    const productSQL='INSERT OR IGNORE INTO catalogue_products '+
      '(id,display_name,search_name,brand,package_size,category,discovered_from) VALUES '+
      placeholders(products.length,7);
    const listingSQL='INSERT INTO catalogue_listings '+
      '(listing_key,master_product_id,retailer,branch_id,retailer_sku,product_url,'+
      'product_name,brand,package_size) VALUES '+
      placeholders(listings.length,9)+
      ' ON CONFLICT(listing_key) DO UPDATE SET '+
      'product_url=excluded.product_url,product_name=excluded.product_name,'+
      'brand=excluded.brand,package_size=excluded.package_size';
    await db.batch([
      db.prepare(productSQL).bind(...products.flat()),
      db.prepare(listingSQL).bind(...listings.flat()),
    ]);
  }
  const finished=part+1>=data.totalParts;
  return {
    source:SOURCE,part,totalParts:data.totalParts,totalRecords:data.totalRecords,
    processed:listings.length,productsDiscovered:products.length,rejected,
    nextPart:finished?null:part+1,finished,
    scope:'online_unverified',pricesImported:0,
  };
}
